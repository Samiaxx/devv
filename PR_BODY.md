## Assessment: Scoring Module, Endorsement Flow, and Architecture Review

This pull request addresses the three assessment tasks within a focused scope. All changes are additive where possible and preserve the existing API surface.

---

### Task 1: Deterministic Reputation-Score Module

**Changes:** `lib/core/scoring.ts`, `lib/core/__tests__/scoring.test.ts`, `vitest.config.ts`

#### Input Sanitization

Added three validation functions that sit between raw input and the scoring engine:

- **`sanitizeNumber(value, max?)`** — Coerces any input to a finite, non-negative integer. NaN, Infinity, negative values, and non-numeric types return 0. Values above `max` are clamped.
- **`sanitizeContracts(contracts)`** — Accepts a raw array (or anything), filters out entries without a valid `contractAddress`, and sanitizes all numeric fields (`blockNumber`, `timestamp`) to prevent NaN propagation.
- **`sanitizeENS(ens)`** — Accepts a raw object (or anything), normalizes empty strings to `null`, and returns a safe `ENSProfile`.

These are applied inside `computeReputationScore()`, so callers can pass unvalidated data safely. The function signature now accepts `unknown` for both parameters, making the contract explicit: **the scoring engine handles garbage input gracefully.**

#### 0–100 Normalization

Raw scores are normalized to [0, 100] via linear scaling:

```
normalized = Math.round((rawScore / THEORETICAL_MAX_SCORE) * 100)
THEORETICAL_MAX_SCORE = 200
```

**Why linear normalization instead of hard capping?** A hard cap (`Math.min(100, raw)`) would collapse all high-activity profiles to the same value, losing relative differences. Linear normalization preserves the distribution: a profile with half the theoretical maximum activity gets ~50, not 100.

**Why 200 as the theoretical max?** The actual maximum raw score is 191 (10 verified deployments at 1.2x multiplier + full ENS). Rounding to 200 gives a clean scale factor and a small buffer for edge cases.

`getScoreTier()` now accepts a normalized score in [0, 100] and uses `sanitizeNumber(score, 100)` for safe lookup.

#### Weighting Decisions

| Factor | Weight | Rationale |
|---|---|---|
| Contract deployment | +5 per (cap 10) | Base activity signal; capped to prevent spam |
| Verified contract | +10 per (cap 10) | Verification requires effort (source code + constructor args); stronger signal |
| ENS ownership | +2 (flat) | Identity signal; low weight because ENS is cheap and not developer-specific |
| ENS metadata | +3 per field | Shows active ENS usage; 3 fields (avatar, url, github) = max +9 |
| Time (established) | 1.2x multiplier | Rewards sustained activity over time |
| Time (recent) | 0.8x multiplier | Devalues recent bursts that may be artificial |
| Burst penalty | additional 0.8x | 3+ deployments within 7 days suggests automated/scripted activity |

#### Tests

50 unit tests covering:
- `sanitizeNumber`: NaN, Infinity, negative, overflow, non-numeric types, decimals, clamping
- `sanitizeContracts`: null/undefined, missing fields, NaN timestamps, empty array
- `sanitizeENS`: null/undefined, empty strings, partial objects, valid data
- `normalizeScore`: boundary cases, range [0, 100], half-max proportionality
- `getTimeMultiplier`: established vs recent, unknown timestamp, invalid input
- `detectBurstContracts`: below threshold, within window, spread over time, empty
- `getScoreTier`: all tier boundaries, clamping, NaN/overflow
- `computeReputationScore` (integration): empty input, null input, determinism, score range, verified vs unverified, ENS vs no-ENS, cap behavior, invalid entries, NaN timestamps

Run with: `npm test`

---

### Task 2: Web3 Transaction-State Experience

**Changes:** `components/EndorseButton.tsx`, `components/AttestButton.tsx`, `lib/types.ts`, `contracts/ProofOfDev.sol`, `lib/contract.ts`, `hardhat.config.cjs`, `scripts/deploy.ts`, `.env.example`

#### Smart Contract: `endorse()` Function

Added to `contracts/ProofOfDev.sol`:

```solidity
function endorse(address endorsed, uint256 score) external {
    require(endorsed != address(0), "Zero address");
    require(endorsed != msg.sender, "Cannot self-endorse");
    require(!endorsements[msg.sender][endorsed], "Already endorsed");

    endorsements[msg.sender][endorsed] = true;
    endorsementCount[endorsed]++;

    emit Endorsed(msg.sender, endorsed, score);
}
```

Supporting state: `endorsements` (mapping: endorser → endorsed → bool), `endorsementCount` (mapping: address → uint256), `hasEndorsed()` view function, and `Endorsed` event.

The ABI in `lib/contract.ts` includes all four new entries: `endorse`, `hasEndorsed`, `endorsementCount`, and `Endorsed` event.

#### Deployment Setup

- **`hardhat.config.cjs`** — Hardhat configuration for Sepolia deployment (CommonJS format for ESM project compatibility)
- **`scripts/deploy.ts`** — Rewritten for Hardhat native deployment (`npx hardhat run scripts/deploy.ts --network sepolia`)
- **`.env.example`** — Updated with `DEPLOYER_PRIVATE_KEY`, `NEXT_PUBLIC_ALCHEMY_API_KEY`, and demo mode variables

#### EndorseButton Component

Implements a user-facing endorsement flow with 6 explicit transaction states:

| State | UI | Recovery |
|---|---|---|
| **notConnected** | Wallet icon, feature summary, "Connect Wallet" button | Connect via injected provider |
| **awaitingConfirmation** | Spinner + "Confirm in wallet" message | Wait or reject in wallet |
| **submitted** | Spinner + tx hash link to Etherscan | Wait for block confirmation |
| **confirmed** | Green success card, tx hash, block number, Etherscan link | — |
| **rejected** | Yellow warning, "no funds charged" message, "Try Again" button | Retry immediately |
| **error** | Red error card, classified error message, context-specific help, Retry | Depends on error category |

#### AttestButton Component

Implements a user-facing EAS delegated attestation flow with the same 6 transaction states:

| State | UI | Recovery |
|---|---|---|
| **notConnected** | Wallet icon, feature summary, "Connect Wallet" button | Connect via injected provider |
| **awaitingConfirmation** | Spinner + "Server is signing attestation" message | Wait or reject in wallet |
| **submitted** | Spinner + tx hash, "Waiting for blockchain confirmation" | Wait for block confirmation |
| **confirmed** | Green success card, attestation UID, tx hash, EAS Explorer link | — |
| **rejected** | Yellow warning, "no funds charged" message, "Try Again" button | Retry immediately |
| **error** | Red error card, classified error message (server/rpc/network), Retry | Depends on error category |

The attestation flow is: (1) Browser sends profile to server via `POST /api/attest`, (2) Server signs delegated attestation with `ATTESTER_PRIVATE_KEY`, (3) Browser submits signed payload to EAS contract on Sepolia (user pays gas), (4) Attestation is permanently on-chain.

#### Error Classification

Both buttons use `classifyError()` to parse errors into user-facing categories:

**EndorseButton categories:**
- **`user_rejected`** — EIP-1193 code 4001 / "user denied" / "action_rejected" → Shows "Try Again" (no penalty)
- **`rpc_failure`** — "insufficient funds" / network timeout → Suggests network check or Sepolia switch
- **`contract_error`** — "execution reverted" / contract not deployed → Suggests contacting maintainer
- **`network_error`** — fetch failures, 502/503/504 → Suggests connection check

**AttestButton categories:**
- **`user_rejected`** — Same as above
- **`rpc_failure`** — "insufficient funds" → Suggests Sepolia ETH
- **`server_error`** — "ATTESTER_PRIVATE_KEY not set" / "schema UID not configured" / 500 errors → Suggests contacting maintainer
- **`network_error`** — Same as above

Each category renders a different help message and recovery action, rather than a generic "something went wrong" error.

#### Demo Mode

Both buttons support a demo mode that simulates all 6 states without hitting the blockchain. This allows reviewers to test the full UI flow without deploying contracts or spending testnet ETH.

**Activation:** Set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local`. The EndorseButton also auto-detects demo mode when `CONTRACT_ADDRESS` is the zero address (contract not deployed).

**Demo scenarios** via `NEXT_PUBLIC_DEMO_SCENARIO`:
- `success` — Always shows the happy path (State 2 → 3 → 4)
- `reject` — Always shows user rejection (State 2 → 5)
- `error` — Always shows contract/server error (State 2 → 3 → 6)
- `cycle` — Alternates through success → reject → error on each click

In cycle mode, each terminal state (confirmed, rejected, error) shows a "🎭 Try Next Scenario →" button that automatically advances to the next scenario with a 300ms transition delay.

Each state displays an amber "🎭 Demo Mode" banner indicating which state (e.g., "State 4/6: Confirmed") and which scenario is active.

#### State Management

Both buttons use wagmi v2 hooks with `useEffect` hooks that synchronize wagmi's async state with explicit state machines. This ensures:
- No state can be skipped (e.g., can't jump from idle to confirmed)
- Error states always include a category for programmatic handling
- The component recovers cleanly from any error via `resetWrite()`

EndorseButton's `hasEndorsed()` read contract hook pre-checks repeat visitors so they see "Already Endorsed" without a wasted gas attempt.

#### Types Updated

```typescript
// Endorsement (unchanged)
type EndorsementStatus =
  | "notConnected" | "idle" | "awaitingConfirmation"
  | "submitted" | "confirmed" | "rejected" | "error";

interface EndorsementState {
  status: EndorsementStatus;
  txHash: string | null;
  blockNumber: number | null;
  error: string | null;
  errorCategory:
    | "user_rejected" | "rpc_failure"
    | "contract_error" | "network_error" | null;
}

// Attestation (expanded from 5 to 9 statuses + errorCategory)
interface AttestationState {
  status:
    | "notConnected" | "idle" | "signing"
    | "awaitingConfirmation" | "pending"
    | "submitted" | "confirmed"
    | "rejected" | "error";
  uid: string | null;
  txHash: string | null;
  error: string | null;
  errorCategory:
    | "user_rejected" | "rpc_failure"
    | "server_error" | "network_error" | null;
}
```

---

### Task 3: Architecture and Security Review

#### System Architecture

The application has three distinct runtime tiers:

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js 16)                                          │
│  Runs in browser / Vercel edge                                  │
│                                                                 │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ page.tsx │  │ ScoreCard  │  │ MintBtn  │  │ EndorseBtn   │  │
│  └────┬─────┘  └────────────┘  └─────┬────┘  └──────┬───────┘  │
│       │                               │              │          │
│  ┌────┴───────────────────┐     ┌─────┴──────────────┴───────┐  │
│  │ app/api/analyze/route  │     │ wagmi + RainbowKit         │  │
│  │ (Next.js API route)    │     │ (wallet connection + tx)   │  │
│  └────────────┬───────────┘     └────────────────────────────┘  │
│               │                                                  │
├───────────────┼──────────────────────────────────────────────────┤
│               ▼                                                  │
│  Backend (Express API server + Worker)                           │
│  Runs on Vercel serverless / dedicated Node.js                   │
│                                                                 │
│  ┌──────────────┐    ZeroMQ     ┌──────────────┐                │
│  │ server/api.js│──── push ────▶│server/worker │                │
│  │ (HTTP API)   │   TCP:5000    │  .js (pull)  │                │
│  └──────────────┘               └──────┬───────┘                │
│                                        │                        │
│                                 ┌──────┴───────┐                │
│                                 │ server/tasks │                │
│                                 │    .js       │                │
│                                 └──────┬───────┘                │
│                                        │                        │
│                              ┌─────────┼─────────┐              │
│                              ▼         ▼         ▼              │
│                         Alchemy   Etherscan   The Graph         │
│                         (RPC)     (API)       (ENS subgraph)    │
│                                                                 │
│                              ┌─────────────┐                    │
│                              │  MongoDB    │                    │
│                              │  (optional) │                    │
│                              └─────────────┘                    │
├──────────────────────────────────────────────────────────────────┤
│  On-chain (Ethereum Sepolia)                                     │
│                                                                 │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ ProofOfDev.sol│  │ EAS Contract │  │ ENS Public Resolver  │  │
│  │ (Soulbound    │  │ (Attestation)│  │ (name resolution)    │  │
│  │  ERC-721)     │  │              │  │                      │  │
│  └───────────────┘  └──────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

#### Data Flow: End-to-End Analysis Pipeline

1. **User connects wallet** → RainbowKit / wagmi (`page.tsx` L108)
2. **User clicks "Analyze"** → `POST /api/analyze` with `{address, network, includeENS}` (`page.tsx` L44)
3. **API route** calls `runPipeline()` (`lib/api/analyzeController.ts`)
4. **Pipeline** (Step 2) fetches contracts and ENS in parallel via `Promise.all`:
   - `fetchContracts()` → tries Alchemy `alchemy_getAssetTransfers` first, falls back to Etherscan `txlist` (`lib/services/blockchain.ts`, `lib/api/analyzeController.ts` L48-70)
   - `fetchENS()` → gated by `ConsentConfig.includeENS`; resolves via The Graph ENS subgraph + Alchemy `eth_call` to ENS resolver (`server/tasks.js` L194-235)
5. **Pipeline** (Step 3) enriches contracts with Etherscan verification status via `getsourcecode` API, batched 5-at-a-time with 250ms delay (`server/tasks.js` L186-216, `lib/api/analyzeController.ts` L82-91)
6. **Pipeline** (Step 4) applies privacy filters — `filterENS()` strips ENS data if consent is missing; `filterContracts()` is a pass-through placeholder for future per-contract controls (`lib/privacy/filters.ts`)
7. **Pipeline** (Step 5) computes score via `buildReputationProfile()` which calls `computeReputationScore()` → tier assignment → burst detection → explanation generation → warning generation (`lib/core/reputation.ts`)
8. **Pipeline** (Step 6) returns `AnalysisResponse` to the frontend
9. **Frontend renders** ScoreCard, ContractList, ENSCard, and action buttons (Attest, Endorse, Mint)

**Parallel worker path** (server-side):
- `server/api.js` binds a ZeroMQ push socket on `tcp://127.0.0.1:5000`
- `server/worker.js` connects a pull socket to the same endpoint
- Jobs are sent as JSON strings, processed by `analyzeWallet()` in `server/tasks.js`
- Results stored in MongoDB via `saveJobResult()` with TTL 1h on `job_results` collection
- Enrichment (unique interactor counting) dispatched as a secondary in-process async queue via `server/queues.js`

#### On-chain vs Off-chain Data Split

| On-chain (EAS Attestation) | Off-chain (Computed) |
|---|---|
| Score snapshot | Deployment detection logic |
| Contract count | Burst detection algorithms |
| Verified contract count | Time-weight multipliers |
| ENS ownership flag | Normalization and filtering |
| Analysis timestamp | Etherscan verification enrichment |
| Tier label | Full reputation profile construction |

**Rationale:** The attestation stores a point-in-time snapshot of the score and key metrics. The computation pipeline (which APIs to call, how to weight, how to filter) remains off-chain so it can be iterated without redeploying contracts or changing schemas. The attestation is verifiable: anyone can re-run the same pipeline against the same block and verify the score was honest.

**What's NOT on-chain:** The endorsement system (`endorse()`) is separate from attestations. An endorsement is a social signal ("I vouch for this developer") while an attestation is a data snapshot ("this score was computed at this time"). They serve different purposes and can be used independently.

#### Code-Level Security Review

##### 1. Smart Contract Security (`contracts/ProofOfDev.sol`)

**Soulbound enforcement** — `_update()` override prevents all transfers, approvals, and mints to non-zero recipients. This is the correct pattern: if `to != address(0)`, the function reverts, meaning `_mint()` only works when called internally (since `_mint` passes `to` as the recipient). The override at L83-89 effectively makes the token non-transferable.

```solidity
function _update(address to, uint256 tokenId, address auth)
    internal override(ERC721) returns (address)
{
    address owner = super._update(to, tokenId, auth);
    if (to != address(0)) revert("Soulbound: non-transferable");
    return owner;
}
```

**Minting guards** — `mint()` checks: (1) caller has no existing token (`_addressToTokenId[sender] == 0`), (2) contract is initialized, (3) score > 0. The `getTokenId()` revert "No token minted" prevents re-minting. However, there is a subtle issue: `_addressToTokenId[sender] == 0` is the check, but token ID 0 is the default for unset mappings. If a user's first token ID were somehow 0, the check would fail. In practice, `_nextTokenId` starts at 1, so this is safe, but a more robust pattern would use a separate `hasMinted` mapping.

**Endorsement guards** — `endorse()` checks: (1) `endorsed != address(0)`, (2) `endorsed != msg.sender` (no self-endorsement), (3) `!endorsements[msg.sender][endorsed]` (no duplicates). The `score` parameter is stored only in the event for off-chain indexing — it's not validated on-chain. This means a caller could endorse with an arbitrary score value. For the current use case (social signal), this is acceptable since the endorsement is about the relationship, not the score accuracy. If score accuracy mattered, the contract would need a server-signed attestation to verify the score.

**Ownership** — `onlyOwner` modifier uses a simple `require`. No two-step ownership transfer pattern (like OpenZeppelin's `Ownable2Step`). If `transferOwnership()` is called with a wrong address, ownership is irreversibly lost. For a testnet deployment, this is acceptable; for mainnet, use `Ownable2Step`.

##### 2. API Security (`server/api.js`)

**Input validation** — `ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/` validates addresses before processing. Network names are checked against `ALLOWED_NETWORKS` allowlist. This prevents injection of arbitrary network names or malformed addresses.

**Missing rate limiting** — The Express API has no rate limiting on any endpoint. `POST /analyze` triggers external API calls (Alchemy, Etherscan) which have usage quotas. A malicious user could exhaust the Alchemy API key's rate limit or run up costs. **Production fix:** Add `express-rate-limit` or equivalent, at minimum on `/analyze`.

**Missing request size limit** — `express.json()` uses the default 100KB limit, which is reasonable. However, there's no explicit configuration, so a future Express upgrade could change the default. **Production fix:** Explicitly set `app.use(express.json({ limit: "16kb" }))`.

**No authentication** — All endpoints are publicly accessible. The `/profile/:address` endpoint returns stored analysis data without any auth. For a public tool this is acceptable, but the `/analyze` endpoint (which costs API calls) should be rate-limited or require a simple auth token in production.

**Error handling** — Each endpoint catches exceptions and returns `500` with a generic error message. Error details are logged server-side only. This is correct — internal errors should not leak to clients.

##### 3. Worker Security (`server/worker.js`, `server/tasks.js`)

**ZeroMQ transport** — The push/pull socket is bound on `tcp://127.0.0.1:5000`. This is localhost-only, so no external access. However, there's no authentication on the socket — any process on the same machine can inject jobs. For production with shared hosting, add ZeroMQ PLAIN authentication or use Unix domain sockets.

**Job parsing** — `JSON.parse(raw.toString())` with no schema validation. A malformed job message would cause the worker to throw and log the error, but the `continue` statement at L41 ensures the worker doesn't crash. This is safe but could be hardened with a JSON schema validator (e.g., Zod) at the entry point.

**External API calls** — `tasks.js` makes unbounded concurrent requests to Alchemy (via `Promise.all` in `alchemyGetDeployments`) and sequential requests to Etherscan with 250ms delays. The Alchemy calls are bounded by the `maxCount: "0x3E8"` (1000) limit on the API side. The Etherscan calls use a 5-batch, 250ms-delay pattern in `enrichVerification()`. This respects the free-tier rate limit (5 req/s) but doesn't handle API key rotation or exponential backoff on 429 responses.

**Keccak256 implementation** — `tasks.js` includes a pure-JS keccak256 implementation (~100 lines) for ENS namehash computation. This avoids adding a native dependency but introduces a potential correctness risk: the implementation is a manual port of the Keccak sponge construction with hardcoded round constants. If there's a bug in the rotation constants or the padding scheme, ENS namehashes would be silently wrong. **Production fix:** Use `viem`'s `keccak256` or `@noble/hashes` which are well-tested and audited.

**ENS resolution** — Uses The Graph's public ENS subgraph (`api.thegraph.com/subgraphs/name/ensdomains/ens`) for name lookup, then Alchemy `eth_call` for text records. The subgraph query uses string interpolation for the address (`"${address.toLowerCase()}"`), which is safe because the address is already validated upstream. However, if the address were user-supplied without validation, this would be a GraphQL injection risk.

##### 4. Privacy Architecture (`lib/privacy/`)

**Consent model** — `ConsentConfig` has two flags: `includeENS` (set at analysis time) and `allowMint` (set at mint time, never at analysis time). The default is everything off. `consentFromRequest()` only sets `includeENS` to `true` when the user explicitly checks the box. This is a good pattern — opt-in, not opt-out.

**Filter layer** — `filterENS()` strips all ENS data when consent is missing. `filterContracts()` is a pass-through. The separation between consent config and filter functions is clean and extensible: adding a new data category (e.g., GitHub profile) would require adding a consent flag, a filter function, and wiring it into the pipeline.

**Data minimization** — The frontend sends only `{address, network, includeENS}`. No IP, no user agent, no session ID. The backend stores `{wallet_address, chain_id, score, tier, metrics_breakdown, contract_count, verified_count, ens_name, analyzed_at}` in MongoDB. The `ens_name` storage is the only PII-adjacent data (ENS names can be personal identifiers). **Production fix:** Consider hashing the ENS name at rest or making it opt-in for storage.

##### 5. Frontend Security (`components/`, `app/`)

**Wallet connection** — Uses RainbowKit with wagmi, which handles WalletConnect and injected providers. RainbowKit shows a clear connection dialog and supports hardware wallets (explicit `HardwareWalletNotice` component). No custom wallet connection code that could leak keys.

**Transaction safety** — Both `EndorseButton` and `AttestButton` show the exact action before signing: the user sees the target address and score before confirming. The contract ABI is hardcoded (not fetched from an external source), preventing ABI manipulation attacks.

**Input sanitization in scoring** — `computeReputationScore()` accepts `unknown` inputs and sanitizes everything internally. This means even if the API returns malformed data, the scoring engine won't crash or produce NaN scores. The 50-test suite verifies this exhaustively.

**XSS prevention** — All user-facing data (addresses, ENS names, scores) is rendered through React's default JSX escaping. No `dangerouslySetInnerHTML` usage found. ENS names could contain Unicode characters; React handles this safely.

##### 6. Attestation Security (`lib/eas/attestationService.ts`)

**Delegated attestation pattern** — The server signs an EIP-712 attestation using `ATTESTER_PRIVATE_KEY`, but the client submits the transaction (user pays gas). This means:
- The server never holds user funds
- The user controls when/if the attestation goes on-chain
- The server's signature is the proof of data integrity

**Key management** — `ATTESTER_PRIVATE_KEY` is read from `process.env` at runtime. It's loaded only when `getAttesterSigner()` is called (lazy initialization). The key is never logged or returned to the client. **Production fix:** Migrate to an HSM or KMS (AWS KMS, HashiCorp Vault) so the private key is never in process memory.

**No replay protection** — The attestation uses `NO_EXPIRATION` for both the attestation itself and the delegated signature deadline. There's no nonce per recipient. This means the same attestation could theoretically be submitted multiple times (though EAS may deduplicate on schema+recipient+data). **Production fix:** Add a nonce or short-lived deadline to prevent replay.

**Schema rigidity** — The schema string `"uint256 score, uint256 contractCount, uint256 verifiedContractCount, bool hasENS, string tier, uint256 analyzedAt"` is fixed at registration time. Adding fields requires registering a new schema and updating the UID. This is by design — it prevents the server from silently changing what's being attested.

#### Anti-Sybil and Anti-Inflation Analysis

| Threat | Current Mitigation | Effectiveness | Production Enhancement |
|---|---|---|---|
| **Self-endorsement** | `require(endorsed != msg.sender)` in Solidity | Strong — enforced at contract level | N/A |
| **Duplicate endorsement** | `endorsements[endorser][endorsed]` mapping | Strong — O(1) check, immutable once set | N/A |
| **Score inflation via deployment spam** | Cap of 10 deployments + 0.8x burst penalty | Medium — a determined attacker can still hit the cap cheaply | Weight by contract bytecode uniqueness; penalize similar bytecode patterns |
| **Sybil wallets** | Each wallet needs gas to deploy contracts | Medium — deploying 10 contracts costs ~0.01-0.1 ETH on mainnet | Require minimum contract age (e.g., 30 days); weight by unique interactors |
| **ENS gaming** | ENS ownership = +2, metadata = +9 max | Low risk — ENS costs $5+/year and is identity-linked | Add diminishing returns for ENS metadata |
| **Attestation replay** | None (NO_EXPIRATION, no nonce) | Weak | Add per-recipient nonce; 24h deadline |
| **API abuse** | None (no rate limiting) | Weak | Rate limit per IP and per address |

#### Production Readiness Checklist

1. **Rate limiting** — Add to `server/api.js`: `express-rate-limit` on `/analyze` (e.g., 10 req/min per IP) and per-address cooldown (e.g., 1 analysis per 5 minutes). Without this, the Alchemy API key can be exhausted.

2. **Secret management** — Move `ATTESTER_PRIVATE_KEY` and `ALCHEMY_API_KEY` to a KMS (AWS Secrets Manager, HashiCorp Vault). Current `.env.local` pattern is fine for development but leaks easily in logs, Docker layers, or process listings.

3. **ZeroMQ authentication** — Add PLAIN or CURVE authentication to the push/pull socket for multi-tenant deployments. Current localhost-only binding is safe for single-server deployments.

4. **Keccak256 correctness** — Replace the inline pure-JS keccak256 in `server/tasks.js` with `viem`'s `keccak256` or `@noble/hashes`. The current implementation has hardcoded round constants and no test vector validation. ENS namehashes computed with a buggy hash function would be silently wrong.

5. **Worker error recovery** — Add exponential backoff on 429 responses from Etherscan. Current `sleep(250)` is a fixed delay that doesn't adapt to rate limit headers.

6. **Database indexes** — `ensureIndexes()` creates `uq_wallet_chain` and `idx_score_desc` but doesn't create an index on `analyzed_at`. For profile freshness queries, add `{ analyzed_at: -1 }`.

7. **Schema validation** — Add Zod or similar to validate job payloads in `server/worker.js`. Current `JSON.parse()` with no schema means malformed jobs silently fail and are logged but not retried.

8. **Frontend error boundaries** — Add React error boundaries around `AnalysisDashboard` and `EndorseButton` to prevent a scoring or contract error from crashing the entire page.

9. **ENS name privacy** — `ens_name` is stored in MongoDB (`server/db.js` L84). ENS names can be personal identifiers (e.g., `vitalik.eth`). Consider hashing at rest or making storage opt-in.

10. **Attestation deadline** — Change `NO_EXPIRATION` to a 24-hour deadline in `attestationService.ts`. This prevents stale delegated attestations from being submitted days later with outdated scores.

11. **Contract ownership** — Replace `transferOwnership()` with OpenZeppelin's `Ownable2Step` for mainnet deployment. Single-step ownership transfer is irreversible if the target address is wrong.

12. **Monitoring** — Add structured logging (pino/winston) and error tracking (Sentry) for production. Current `console.info/warn/error` is sufficient for development but doesn't aggregate or alert.

---

### Setup and Testing

```bash
# Install dependencies
npm install

# Run tests (112 tests across 3 files)
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Dev server (starts Next.js + API + Worker)
npm run dev
```

#### Demo Mode Testing

To test the EndorseButton and AttestButton without deploying contracts or spending testnet ETH:

1. Copy `.env.example` to `.env.local` and set:
   ```
   NEXT_PUBLIC_DEMO_MODE=true
   NEXT_PUBLIC_DEMO_SCENARIO=cycle
   ```
2. Run `npm run dev` and connect any wallet
3. Click "Endorse (Demo)" or "Get Attestation (Demo)" to cycle through all 6 states:
   - Click 1 → Confirmed (success path)
   - Click 2 → Rejected (user denial)
   - Click 3 → Error (contract/server failure)
   - Click 4+ → Repeats the cycle

Each state shows an amber "🎭 Demo Mode" banner indicating the current state number.

#### Contract Deployment (Optional)

To test with real on-chain transactions:

1. Get Sepolia ETH from https://sepoliafaucet.com
2. Add to `.env.local`:
   ```
   DEPLOYER_PRIVATE_KEY=0x...
   NEXT_PUBLIC_ALCHEMY_API_KEY=...
   ```
3. Deploy:
   ```bash
   npx hardhat run scripts/deploy.ts --network sepolia --config hardhat.config.cjs
   ```
4. Add the deployed address to `.env.local`:
   ```
   NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
   ```

No private keys, API credentials, or paid service credentials are included in this PR.
