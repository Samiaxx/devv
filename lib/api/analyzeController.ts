/**
 * Analysis Controller — orchestrates the full analysis pipeline.
 *
 * Flow:
 *   POST /api/analyze
 *     → runPipeline(body)
 *     → AnalysisResponse returned to client
 */

import { getContractDeployments } from "@/lib/services/blockchain";
import { enrichWithVerification, getDeploymentsFromEtherscan } from "@/lib/services/etherscan";
import { getENSData } from "@/lib/services/ens";
import { validateAnalysisRequest } from "@/lib/core/validation";
import { normalizeContracts, deduplicateContracts, normalizeENS } from "@/lib/normalizers";
import { consentFromRequest, ConsentConfig } from "@/lib/privacy/consent";
import { filterContracts, filterENS } from "@/lib/privacy/filters";
import { buildReputationProfile } from "@/lib/core/reputation";
import { AppError } from "@/lib/errors/AppError";
import { logger } from "@/lib/logger";
import { AnalysisResponse, ENSProfile } from "@/lib/types";

// ─── Pipeline ─────────────────────────────────────────────────────────────────

interface DataFlags {
  alchemyFailed: boolean;
  etherscanFailed: boolean;
  ensFailed: boolean;
  includesENS: boolean;
}

async function fetchContracts(
  address: string,
  network: "mainnet" | "sepolia"
): Promise<{ contracts: Awaited<ReturnType<typeof getContractDeployments>>; alchemyFailed: boolean }> {
  const alchemyResult = await getContractDeployments(address, network).catch((err) => {
    logger.warn("[pipeline] Alchemy fetch failed", err?.message);
    return null;
  });

  if (alchemyResult && alchemyResult.length > 0) {
    return { contracts: alchemyResult, alchemyFailed: false };
  }

  logger.info("[pipeline] Falling back to Etherscan for deployments");
  const etherscanResult = await getDeploymentsFromEtherscan(address, network).catch((err) => {
    logger.warn("[pipeline] Etherscan fallback also failed", err?.message);
    return [];
  });

  return { contracts: etherscanResult, alchemyFailed: alchemyResult === null };
}

async function fetchENS(
  address: string,
  consent: ConsentConfig
): Promise<{ ens: ENSProfile; ensFailed: boolean }> {
  if (!consent.includeENS) {
    return { ens: { name: null, avatar: null, url: null, github: null }, ensFailed: false };
  }
  try {
    const raw = await getENSData(address);
    return { ens: normalizeENS(raw), ensFailed: false };
  } catch (err) {
    logger.warn("[pipeline] ENS fetch failed", (err as Error)?.message);
    return { ens: { name: null, avatar: null, url: null, github: null }, ensFailed: true };
  }
}

async function runPipeline(body: unknown): Promise<AnalysisResponse> {
  // Step 1 — Validate
  let request;
  try {
    request = validateAnalysisRequest(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid request";
    if (msg.startsWith("INVALID_ADDRESS")) throw AppError.invalidAddress(msg);
    throw AppError.invalidRequest(msg);
  }

  const { address, network, includeENS } = request;
  const consent = consentFromRequest({ includeENS });

  logger.info("[pipeline] Starting", { address, network, includeENS });

  // Step 2 — Fetch (parallel)
  const [contractFetch, ensFetch] = await Promise.all([
    fetchContracts(address, network),
    fetchENS(address, consent),
  ]);

  // Step 3 — Enrich + normalize
  let etherscanFailed = false;
  let enriched;
  try {
    enriched = await enrichWithVerification(contractFetch.contracts, network);
  } catch (err) {
    logger.warn("[pipeline] Verification enrichment failed", (err as Error)?.message);
    enriched = contractFetch.contracts;
    etherscanFailed = true;
  }

  const normalizedContracts = deduplicateContracts(normalizeContracts(enriched));

  const dataFlags: DataFlags = {
    alchemyFailed: contractFetch.alchemyFailed,
    etherscanFailed,
    ensFailed: ensFetch.ensFailed,
    includesENS: includeENS,
  };

  // Step 4 — Privacy filters
  const filteredContracts = filterContracts(normalizedContracts);
  const filteredENS = filterENS(ensFetch.ens, consent);

  // Step 5 — Score
  const profile = buildReputationProfile(filteredContracts, filteredENS, dataFlags);

  logger.info("[pipeline] Complete", {
    address,
    score: profile.score,
    contracts: filteredContracts.length,
  });

  // Step 6 — Return
  return {
    address,
    ens: filteredENS,
    contracts: filteredContracts,
    profile,
    analyzedAt: Math.floor(Date.now() / 1000),
    includesENS: includeENS,
  };
}

export async function enqueueAnalysis(body: unknown): Promise<AnalysisResponse> {
  return runPipeline(body);
}
