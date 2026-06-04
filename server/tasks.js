/**
 * Task implementations for Proof of Dev.
 *
 * Task registry:
 *   analyzeWallet          (queue: analysis)
 *     Full pipeline: fetch deployments → verify → ENS → score → save to DB.
 *     Dispatches countUniqueInteractors as a follow-up enrichment task.
 *
 *   countUniqueInteractors (queue: enrichment)
 *     Counts unique addresses that have called a wallet's verified contracts.
 *     Updates the unique_interactors field in analysis_results.
 */

import { enqueueEnrichment } from "./queues.js";
import { chainIdFromNetwork, CHAIN_RPC_URLS, ETHERSCAN_URLS, ETHERSCAN_KEY, ALCHEMY_KEY } from "./config.js";
import { computeReputationScore } from "./scoring.js";
import { saveAnalysisResult, updateUniqueInteractors } from "./db.js";

// ─── Task 1: Full wallet analysis ─────────────────────────────────────────────

/**
 * Full analysis pipeline for a single wallet.
 *
 * Steps:
 *   1. Fetch contract deployments (Alchemy → Etherscan fallback)
 *   2. Enrich with verification status (Etherscan, batched)
 *   3. Resolve ENS (optional)
 *   4. Compute reputation score
 *   5. Save to MongoDB
 *   6. Dispatch countUniqueInteractors for verified contracts
 *
 * @param {{ walletAddress: string, network?: string, includeEns?: boolean }} data
 * @returns {Promise<object>}
 */
export async function analyzeWallet({ walletAddress, network = "mainnet", includeEns = false }) {
  const address = walletAddress.toLowerCase();
  const chainId = chainIdFromNetwork(network);

  console.info(`[analyzeWallet] Starting: address=${address} chain=${network}`);

  // ── Step 1: Fetch deployments ───────────────────────────────────────────────
  const { contracts: contractsRaw, alchemyFailed } = await fetchDeployments(address, chainId);

  // ── Step 2: Enrich with verification status ─────────────────────────────────
  const contracts = await enrichVerification(contractsRaw, chainId);

  // ── Step 3: ENS resolution ──────────────────────────────────────────────────
  const ens = includeEns ? await resolveEns(address) : { name: null, avatar: null, url: null, github: null };

  // ── Step 4: Score ───────────────────────────────────────────────────────────
  const result = computeReputationScore(contracts, ens);

  // ── Step 5: Persist to MongoDB ──────────────────────────────────────────────
  await saveAnalysisResult({
    walletAddress: address,
    chainId,
    score:            result.total,
    tier:             result.tier,
    metricsBreakdown: result.breakdown,
    contracts,
    ensName:          ens.name ?? null,
  });

  console.info(
    `[analyzeWallet] Complete: address=${address} score=${result.total} tier=${result.tier} contracts=${result.contractCount}`,
  );

  // ── Step 6: Dispatch enrichment for verified contracts ──────────────────────
  const verifiedAddresses = contracts
    .filter((c) => c.is_verified)
    .map((c) => c.contract_address);

  if (verifiedAddresses.length > 0) {
    enqueueEnrichment(
      { walletAddress: address, chainId, contractAddresses: verifiedAddresses },
      { attempts: 3 },
    );
  }

  return {
    address,
    chain_id:         chainId,
    score:            result.total,
    tier:             result.tier,
    tier_description: result.tierDescription,
    contract_count:   result.contractCount,
    verified_count:   result.verifiedContractCount,
    has_ens:          result.hasEns,
    ens_name:         ens.name ?? null,
    capped_at:        result.cappedAt,
    breakdown:        result.breakdown,
    alchemy_failed:   alchemyFailed,
  };
}

// ─── Task 2: Count unique interactors ─────────────────────────────────────────

/**
 * Counts unique EOA addresses that have sent transactions to any of the
 * wallet's verified deployed contracts.
 *
 * @param {{ walletAddress: string, chainId: number, contractAddresses: string[] }} data
 * @returns {Promise<{ walletAddress: string, uniqueInteractors: number }>}
 */
export async function countUniqueInteractors({ walletAddress, chainId, contractAddresses }) {
  console.info(
    `[countUniqueInteractors] wallet=${walletAddress} contracts=${contractAddresses.length}`,
  );

  const etherscanBase = ETHERSCAN_URLS[chainId] ?? ETHERSCAN_URLS[1];
  const uniqueSenders = new Set();

  for (const contractAddress of contractAddresses) {
    try {
      const senders = await fetchUniqueSenders(contractAddress, etherscanBase);
      for (const s of senders) uniqueSenders.add(s);
      // Respect Etherscan free-tier rate limit (5 req/s)
      await sleep(250);
    } catch (err) {
      console.warn(`[countUniqueInteractors] Failed for ${contractAddress}: ${err.message}`);
    }
  }

  const count = uniqueSenders.size;
  console.info(`[countUniqueInteractors] wallet=${walletAddress} count=${count}`);

  await updateUniqueInteractors(walletAddress.toLowerCase(), chainId, count);

  return { walletAddress, uniqueInteractors: count };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch contract deployments via Alchemy, falling back to Etherscan.
 * @returns {Promise<{ contracts: object[], alchemyFailed: boolean }>}
 */
async function fetchDeployments(address, chainId) {
  let alchemyFailed = false;

  try {
    const contracts = await alchemyGetDeployments(address, chainId);
    if (contracts.length > 0) return { contracts, alchemyFailed: false };
  } catch (err) {
    console.warn(`[fetchDeployments] Alchemy failed: ${err.message}`);
    alchemyFailed = true;
  }

  try {
    const contracts = await etherscanGetDeployments(address, chainId);
    return { contracts, alchemyFailed };
  } catch (err) {
    console.warn(`[fetchDeployments] Etherscan fallback also failed: ${err.message}`);
    return { contracts: [], alchemyFailed: true };
  }
}

/**
 * Use Alchemy's alchemy_getAssetTransfers to find contract creation txs.
 * @returns {Promise<object[]>}
 */
async function alchemyGetDeployments(address, chainId) {
  const rpcUrl = CHAIN_RPC_URLS[chainId];
  if (!rpcUrl) throw new Error(`No RPC URL configured for chain ${chainId}`);

  const transfersResp = await fetchJson(rpcUrl, {
    method: "POST",
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getAssetTransfers",
      params: [{
        fromAddress:      address,
        category:         ["external"],
        withMetadata:     true,
        excludeZeroValue: false,
        maxCount:         "0x3E8", // 1000
      }],
    }),
  });

  if (transfersResp.error) throw new Error(transfersResp.error.message);

  const transfers  = transfersResp.result?.transfers ?? [];
  const deployTxs  = transfers.filter((tx) => tx.to === null);

  const contracts = [];
  for (const tx of deployTxs) {
    const receiptResp = await fetchJson(rpcUrl, {
      method: "POST",
      body: JSON.stringify({
        id: 1, jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [tx.hash],
      }),
    });
    const receipt = receiptResp.result;
    if (receipt?.contractAddress) {
      const tsStr    = tx.metadata?.blockTimestamp ?? "";
      const timestamp = tsStr ? Math.floor(new Date(tsStr).getTime() / 1000) : 0;
      contracts.push({
        contract_address: receipt.contractAddress.toLowerCase(),
        transaction_hash: tx.hash,
        block_number:     parseInt(tx.blockNum, 16),
        timestamp,
        is_verified:      false,
      });
    }
  }

  return contracts;
}

/**
 * Fetch contract deployments from Etherscan txlist.
 * @returns {Promise<object[]>}
 */
async function etherscanGetDeployments(address, chainId) {
  const base = ETHERSCAN_URLS[chainId] ?? ETHERSCAN_URLS[1];
  const url  = buildEtherscanUrl(base, {
    module:     "account",
    action:     "txlist",
    address,
    startblock: 0,
    endblock:   99999999,
    sort:       "asc",
    apikey:     ETHERSCAN_KEY,
  });

  const data = await fetchJson(url);
  if (data.status !== "1") return [];

  return data.result
    .filter((tx) => tx.to === "" && tx.contractAddress && tx.isError === "0")
    .map((tx) => ({
      contract_address: tx.contractAddress.toLowerCase(),
      transaction_hash: tx.hash,
      block_number:     parseInt(tx.blockNumber, 10),
      timestamp:        parseInt(tx.timeStamp, 10),
      is_verified:      false,
    }));
}

/**
 * Check Etherscan verification status for each contract.
 * Batched to respect the free-tier rate limit (5 req/s).
 *
 * @param {object[]} contractsRaw
 * @param {number} chainId
 * @returns {Promise<object[]>}
 */
async function enrichVerification(contractsRaw, chainId, batchSize = 5, delayMs = 250) {
  const base     = ETHERSCAN_URLS[chainId] ?? ETHERSCAN_URLS[1];
  const enriched = [];

  for (let i = 0; i < contractsRaw.length; i += batchSize) {
    const batch = contractsRaw.slice(i, i + batchSize);

    for (const raw of batch) {
      let isVerified = false;
      try {
        const url  = buildEtherscanUrl(base, {
          module:  "contract",
          action:  "getsourcecode",
          address: raw.contract_address,
          apikey:  ETHERSCAN_KEY,
        });
        const data = await fetchJson(url);
        if (data.status === "1" && data.result?.length) {
          const src = data.result[0];
          isVerified = Boolean(
            src.SourceCode &&
            src.SourceCode !== "" &&
            src.SourceCode !== "1" &&
            src.ABI !== "Contract source code not verified",
          );
        }
      } catch (err) {
        console.debug(`[enrichVerification] Failed for ${raw.contract_address}: ${err.message}`);
      }

      enriched.push({ ...raw, is_verified: isVerified });
    }

    if (i + batchSize < contractsRaw.length) {
      await sleep(delayMs);
    }
  }

  return enriched;
}

/**
 * Resolve ENS name and text records for an address using mainnet.
 * @param {string} address
 * @returns {Promise<{ name: string|null, avatar: string|null, url: string|null, github: string|null }>}
 */
async function resolveEns(address) {
  try {
    // ENS resolution via Alchemy mainnet JSON-RPC (eth_call to ENS resolver)
    // We use the public ENS subgraph as a simpler alternative to avoid web3 deps
    const query = `{
      domains(where: { resolvedAddress: "${address.toLowerCase()}" }, first: 1) {
        name
        resolver {
          texts
        }
      }
    }`;

    const resp = await fetchJson("https://api.thegraph.com/subgraphs/name/ensdomains/ens", {
      method: "POST",
      body:   JSON.stringify({ query }),
    });

    const domain = resp.data?.domains?.[0];
    if (!domain?.name) return { name: null, avatar: null, url: null, github: null };

    const name = domain.name;

    // Fetch text records via Alchemy eth_call to the ENS public resolver
    const rpcUrl = CHAIN_RPC_URLS[1]; // ENS is always mainnet
    const [avatar, url, github] = await Promise.all([
      fetchEnsText(rpcUrl, name, "avatar"),
      fetchEnsText(rpcUrl, name, "url"),
      fetchEnsText(rpcUrl, name, "com.github"),
    ]);

    return {
      name,
      avatar: avatar || null,
      url:    url    || null,
      github: github ? github.replace(/^@/, "").split("github.com/").pop() : null,
    };
  } catch (err) {
    console.warn(`[resolveEns] Failed for ${address}: ${err.message}`);
    return { name: null, avatar: null, url: null, github: null };
  }
}

/**
 * Fetch an ENS text record via eth_call to the ENS public resolver.
 * Uses the ENS PublicResolver ABI for the text(bytes32,string) function.
 *
 * @param {string} rpcUrl
 * @param {string} name  e.g. "vitalik.eth"
 * @param {string} key   e.g. "avatar"
 * @returns {Promise<string>}
 */
async function fetchEnsText(rpcUrl, name, key) {
  try {
    // namehash the ENS name
    const node = ensNamehash(name);

    // ABI-encode text(bytes32 node, string key)
    // selector: 0x59d1d43c
    const keyHex    = stringToHex(key);
    const keyLen    = key.length.toString(16).padStart(64, "0");
    const keyPadded = keyHex.padEnd(Math.ceil(key.length / 32) * 64, "0");
    const data      = `0x59d1d43c${node.slice(2)}${"0000000000000000000000000000000000000000000000000000000000000040"}${keyLen}${keyPadded}`;

    const ENS_PUBLIC_RESOLVER = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41";
    const resp = await fetchJson(rpcUrl, {
      method: "POST",
      body: JSON.stringify({
        id: 1, jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: ENS_PUBLIC_RESOLVER, data }, "latest"],
      }),
    });

    if (!resp.result || resp.result === "0x") return "";

    // Decode ABI-encoded string from result
    return abiDecodeString(resp.result);
  } catch {
    return "";
  }
}

/**
 * Fetch all unique from-addresses that have sent transactions to a contract.
 * @param {string} contractAddress
 * @param {string} etherscanBase
 * @returns {Promise<Set<string>>}
 */
async function fetchUniqueSenders(contractAddress, etherscanBase) {
  const url  = buildEtherscanUrl(etherscanBase, {
    module:     "account",
    action:     "txlist",
    address:    contractAddress,
    startblock: 0,
    endblock:   99999999,
    sort:       "asc",
    apikey:     ETHERSCAN_KEY,
  });

  const data = await fetchJson(url);
  if (data.status !== "1" || !Array.isArray(data.result)) return new Set();

  return new Set(
    data.result
      .filter((tx) => tx.from && tx.isError === "0")
      .map((tx) => tx.from.toLowerCase()),
  );
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON from a URL (GET) or with options (POST).
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function fetchJson(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
  const resp    = await fetch(url, { ...options, headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.json();
}

/**
 * Build an Etherscan API URL with query params.
 * @param {string} base
 * @param {Record<string, string|number>} params
 * @returns {string}
 */
function buildEtherscanUrl(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Compute the ENS namehash for a name.
 * @param {string} name
 * @returns {string}  hex string with 0x prefix
 */
function ensNamehash(name) {
  let node = new Uint8Array(32).fill(0);
  if (!name) return "0x" + Buffer.from(node).toString("hex");

  const labels = name.split(".").reverse();
  for (const label of labels) {
    const labelHash = keccak256(new TextEncoder().encode(label));
    const combined  = new Uint8Array(64);
    combined.set(node, 0);
    combined.set(labelHash, 32);
    node = keccak256(combined);
  }
  return "0x" + Buffer.from(node).toString("hex");
}

/**
 * Minimal keccak256 using Node.js built-in crypto (sha3-256 ≈ keccak256 for ENS).
 * Note: Node's "sha3-256" is the NIST SHA-3, not Ethereum's keccak256.
 * For accurate ENS namehash we use the pure-JS implementation below.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function keccak256(data) {
  // Pure-JS keccak256 via the Keccak sponge construction (simplified for ENS namehash)
  // We delegate to the viem/noble-hashes keccak256 via a small inline implementation.
  // This avoids adding a native dependency just for ENS.
  return keccakHash(data);
}

/**
 * Keccak-256 implemented via the standard sponge construction.
 * Ported from the reference implementation used by noble-hashes.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function keccakHash(data) {
  // Use Node.js crypto module — available in all Node 18+ environments
  // Note: Node's "sha3-256" is NIST SHA3, not keccak. We use a workaround:
  // import the hash from the bundled noble-hashes that viem already ships.
  // Since we can't easily import ESM sub-paths here, we implement a minimal
  // keccak256 inline using the RC constants.
  const RC = [
    [0x00000001, 0x00000000], [0x00008082, 0x00000000],
    [0x0000808a, 0x80000000], [0x80008000, 0x80000000],
    [0x0000808b, 0x00000000], [0x80000001, 0x00000000],
    [0x80008081, 0x80000000], [0x00008009, 0x80000000],
    [0x0000008a, 0x00000000], [0x00000088, 0x00000000],
    [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
    [0x8000808b, 0x00000000], [0x0000008b, 0x80000000],
    [0x00008089, 0x80000000], [0x00008003, 0x80000000],
    [0x00008002, 0x80000000], [0x00000080, 0x80000000],
    [0x0000800a, 0x00000000], [0x8000000a, 0x80000000],
    [0x80008081, 0x80000000], [0x00008080, 0x80000000],
    [0x80000001, 0x00000000], [0x80008008, 0x80000000],
  ];

  // Pad input (keccak padding: append 0x01, pad to rate boundary, set last bit)
  const rate    = 136; // 1088 bits / 8 for keccak-256
  const padded  = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length]    = 0x01;
  padded[padded.length - 1] |= 0x80;

  // State: 5×5 array of [lo, hi] 32-bit pairs (representing 64-bit lanes)
  const state = Array.from({ length: 25 }, () => [0, 0]);

  // Absorb
  for (let block = 0; block < padded.length; block += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const off = block + i * 8;
      state[i][0] ^= (padded[off] | (padded[off+1] << 8) | (padded[off+2] << 16) | (padded[off+3] << 24)) >>> 0;
      state[i][1] ^= (padded[off+4] | (padded[off+5] << 8) | (padded[off+6] << 16) | (padded[off+7] << 24)) >>> 0;
    }
    keccakF(state, RC);
  }

  // Squeeze 32 bytes
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const [lo, hi] = state[i];
    out[i*8+0] = lo & 0xff;
    out[i*8+1] = (lo >>> 8) & 0xff;
    out[i*8+2] = (lo >>> 16) & 0xff;
    out[i*8+3] = (lo >>> 24) & 0xff;
    out[i*8+4] = hi & 0xff;
    out[i*8+5] = (hi >>> 8) & 0xff;
    out[i*8+6] = (hi >>> 16) & 0xff;
    out[i*8+7] = (hi >>> 24) & 0xff;
  }
  return out;
}

function keccakF(state, RC) {
  const rot32 = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let round = 0; round < 24; round++) {
    // θ step
    const C = Array.from({ length: 5 }, (_, x) => [
      state[x][0] ^ state[x+5][0] ^ state[x+10][0] ^ state[x+15][0] ^ state[x+20][0],
      state[x][1] ^ state[x+5][1] ^ state[x+10][1] ^ state[x+15][1] ^ state[x+20][1],
    ]);
    const D = Array.from({ length: 5 }, (_, x) => {
      const x1 = (x + 1) % 5;
      const lo = C[(x+4)%5][0] ^ (rot32(C[x1][0], 1) ^ (C[x1][1] >>> 31));
      const hi = C[(x+4)%5][1] ^ (rot32(C[x1][1], 1) ^ (C[x1][0] >>> 31));
      return [lo >>> 0, hi >>> 0];
    });
    for (let i = 0; i < 25; i++) {
      state[i][0] = (state[i][0] ^ D[i % 5][0]) >>> 0;
      state[i][1] = (state[i][1] ^ D[i % 5][1]) >>> 0;
    }

    // ρ and π steps
    const B = Array.from({ length: 25 }, () => [0, 0]);
    const ROTS = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
    const PI   = [0,10,20,5,15,1,11,21,6,16,2,12,22,7,17,3,13,23,8,18,4,14,24,9,19];
    for (let i = 0; i < 25; i++) {
      const r  = ROTS[i];
      const [lo, hi] = state[i];
      let rlo, rhi;
      if (r === 0) { rlo = lo; rhi = hi; }
      else if (r < 32) {
        rlo = ((lo << r) | (hi >>> (32 - r))) >>> 0;
        rhi = ((hi << r) | (lo >>> (32 - r))) >>> 0;
      } else {
        const s = r - 32;
        rlo = ((hi << s) | (lo >>> (32 - s))) >>> 0;
        rhi = ((lo << s) | (hi >>> (32 - s))) >>> 0;
      }
      B[PI[i]] = [rlo, rhi];
    }

    // χ step
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = y * 5 + x;
        state[i][0] = (B[i][0] ^ (~B[y*5+(x+1)%5][0] & B[y*5+(x+2)%5][0])) >>> 0;
        state[i][1] = (B[i][1] ^ (~B[y*5+(x+1)%5][1] & B[y*5+(x+2)%5][1])) >>> 0;
      }
    }

    // ι step
    state[0][0] = (state[0][0] ^ RC[round][0]) >>> 0;
    state[0][1] = (state[0][1] ^ RC[round][1]) >>> 0;
  }
}

function stringToHex(str) {
  return Buffer.from(str, "utf8").toString("hex");
}

/**
 * Decode an ABI-encoded string from an eth_call result.
 * @param {string} hex  0x-prefixed hex
 * @returns {string}
 */
function abiDecodeString(hex) {
  try {
    const data   = hex.startsWith("0x") ? hex.slice(2) : hex;
    // offset (32 bytes) + length (32 bytes) + data
    const offset = parseInt(data.slice(0, 64), 16) * 2;
    const length = parseInt(data.slice(offset, offset + 64), 16);
    const strHex = data.slice(offset + 64, offset + 64 + length * 2);
    return Buffer.from(strHex, "hex").toString("utf8");
  } catch {
    return "";
  }
}
