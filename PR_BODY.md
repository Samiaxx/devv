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

**Changes:** `components/EndorseButton.tsx`, `lib/types.ts`

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

#### Error Classification

The `classifyError()` function parses error messages into 4 categories:

- **`user_rejected`** — EIP-1193 code 4001 / "user denied" / "action_rejected" → Shows "Try Again" (no penalty)
- **`rpc_failure`** — "insufficient funds" / network timeout → Suggests network check or Sepolia switch
- **`contract_error`** — "execution reverted" / contract not deployed → Suggests contacting maintainer
- **`network_error`** — fetch failures, 502/503/504 → Suggests connection check

Each category renders a different help message and recovery action, rather than a generic "something went wrong" error.

#### State Management

Uses wagmi v2 hooks (`useWriteContract`, `useWaitForTransactionReceipt`) with `useEffect` hooks that synchronize wagmi's async state with the explicit `EndorsementState` machine. This ensures:
- No state can be skipped (e.g., can't jump from idle to confirmed)
- Error states always include a category for programmatic handling
- The component recovers cleanly from any error via `resetWrite()`

#### Types Added

```typescript
type EndorsementStatus = "notConnected" | "idle" | "awaitingConfirmation" | "submitted" | "confirmed" | "rejected" | "error";

interface EndorsementState {
  status: EndorsementStatus;
  txHash: string | null;
  blockNumber: number | null;
  error: string | null;
  errorCategory: "user_rejected" | "rpc_failure" | "contract_error" | "network_error" | null;
}
```

---

### Task 3: Architecture and Security Review

#### On-chain vs Off-chain Data

| On-chain (EAS Attestation) | Off-chain (Computed) |
|---|---|
| Score snapshot | Deployment detection logic |
| Contract count | Burst detection |
| Verified contract count | Time-weight multipliers |
| ENS ownership flag | Normalization and filtering |
| Analysis timestamp | Etherscan verification enrichment |
| Tier label | Full reputation profile construction |

**Rationale:** The attestation stores a point-in-time snapshot of the score and key metrics. The computation pipeline (which APIs to call, how to weight, how to filter) remains off-chain so it can be iterated without redeploying contracts or changing schemas. This also means the attestation is verifiable: anyone can re-run the same pipeline against the same block and verify the score was honest.

#### Anti-Sybil and Anti-Inflation Measures

| Threat | Current Mitigation | Improvement for Production |
|---|---|---|
| **Duplicate endorsements** | Soulbound NFT: `mapping(address => uint256)` enforces 1-per-wallet | Add cooldown period between re-endorsements |
| **Sybil manipulation** | Score derived from on-chain contract deployments (costs gas); ENS adds identity signal | Require minimum contract age; weight by unique interactors; cross-reference with on-chain social graphs |
| **Score inflation** | Deployment cap (10), verification cap (10), burst penalty (0.8x), time devaluation (0.8x for recent) | Add diminishing returns; weight by contract complexity (bytecode size); penalize similar bytecode patterns |
| **Attestation replay** | EAS schema UID + recipient address + deadline in signed payload | Add nonce per recipient; track attested scores server-side |
| **Server key compromise** | ATTESTER_PRIVATE_KEY in env var (single key) | Migrate to HSM or multi-sig attestation; rotate keys periodically |

#### Production Readiness Checklist

1. **Secret management** — Move `ATTESTER_PRIVATE_KEY` to HSM/KMS (AWS KMS, HashiCorp Vault). Never in `.env` for production.
2. **Rate limiting** — Add rate limits to `/api/analyze` and `/api/attest` to prevent abuse.
3. **Caching** — Cache Alchemy/Etherscan responses (e.g., 5-minute TTL) to reduce API costs and latency.
4. **Error monitoring** — Integrate Sentry or equivalent for production error tracking.
5. **Database indexing** — Add MongoDB indexes on frequently queried fields (address, timestamp).
6. **Network migration** — Update EAS contract addresses and schema UID for mainnet.
7. **Test coverage** — Current 50 tests cover the scoring module; add integration tests for the full pipeline and E2E tests for the endorsement flow.
8. **ZeroMQ security** — Add TLS and authentication to the worker queue for production.
9. **Input rate limiting on scoring** — Prevent repeated expensive analyses of the same address within a short window.
10. **Frontend error boundaries** — Add React error boundaries around the endorsement flow to prevent full-page crashes.

---

### Setup and Testing

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Dev server
npm run dev
```

No private keys, API credentials, or paid service credentials are included in this PR.
