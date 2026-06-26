/**
 * Scoring engine — Node.js port of lib/core/scoring.ts.
 *
 * Pure functions, no side effects. Mirrors the TypeScript implementation
 * exactly so scores are consistent between the Next.js frontend and the
 * async worker backend.
 *
 * Now includes:
 *   - Input sanitization (NaN, Infinity, negative, non-numeric)
 *   - 0-100 normalization (same THEORETICAL_MAX_SCORE as frontend)
 *   - Tier thresholds aligned with normalized scores
 */

// ─── Constants (mirrors lib/core/constants.ts) ────────────────────────────────

export const POINTS = {
  CONTRACT_DEPLOYMENT: 5,
  VERIFIED_CONTRACT:   10,
  ENDORSEMENT_RECEIVED: 3, // per unique endorsement received (social signal)
  ENS_OWNERSHIP:       2,
  ENS_METADATA:        3, // per field: avatar, url, github
};

export const CAPS = {
  MAX_DEPLOYMENTS_SCORED: 10,
  MAX_VERIFIED_SCORED:    10,
  MAX_ENDORSEMENTS_SCORED: 10,
  BURST_WINDOW_SECONDS:   7 * 24 * 60 * 60, // 7 days
  BURST_THRESHOLD:        3,
};

export const TIME_CONFIG = {
  ESTABLISHED_THRESHOLD_SECONDS: 30 * 24 * 60 * 60, // 30 days
  ESTABLISHED_MULTIPLIER:        1.2,
  RECENT_BURST_MULTIPLIER:       0.8,
};

/**
 * Theoretical maximum raw score — same as frontend.
 * 10 verified deployments × (5+10) × 1.2 + 10 endorsements × 3 + ENS full (2+3×3)
 *   = 60 + 120 + 30 + 2 + 9 = 221, rounded to 230.
 */
export const THEORETICAL_MAX_SCORE = 230;

/**
 * Tier thresholds use normalized scores (0–100).
 * Matches the frontend getScoreTier() thresholds exactly.
 */
export const TIERS = [
  [0,  "No Activity",    "No developer activity detected on-chain"],
  [1,  "Early Activity", "Early on-chain deployment activity"],
  [15, "Active Builder", "Regular smart contract deployment activity"],
  [35, "Established",    "Consistent on-chain deployment history"],
  [55, "Prolific",       "High volume of verified on-chain activity"],
  [80, "Extensive",      "Extensive on-chain deployment history"],
];

// ─── Input sanitization ──────────────────────────────────────────────────────

/**
 * Sanitizes a numeric input to ensure it is a finite, non-negative integer.
 * Handles NaN, Infinity, negative values, and non-numeric types safely.
 *
 * @param {unknown} value — the raw input to sanitize
 * @param {number}  max   — optional upper bound (values above are clamped)
 * @returns {number} a safe, finite, non-negative integer
 */
export function sanitizeNumber(value, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.floor(value);
  if (rounded < 0) return 0;
  if (rounded > max) return max;
  return rounded;
}

/**
 * Sanitizes a contract timestamp.
 * Returns 0 for invalid/missing timestamps (neutral weight in getTimeMultiplier).
 */
function sanitizeTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Validates and sanitizes a contract array before scoring.
 * Filters out entries that are not objects or have no contract_address.
 * Sanitizes numeric fields to prevent NaN/Infinity propagation.
 *
 * @param {unknown} contracts — raw input (may be anything)
 * @returns {Array} sanitized contract array
 */
export function sanitizeContracts(contracts) {
  if (!Array.isArray(contracts)) return [];

  return contracts
    .filter((c) => {
      // Use contract_address (snake_case) for server-side compatibility
      const addr = c?.contract_address ?? c?.contractAddress;
      return c !== null && typeof c === "object" && typeof addr === "string" && addr.length > 0;
    })
    .map((c) => {
      const addr = c.contract_address ?? c.contractAddress;
      return {
        contract_address: addr,
        contractAddress: addr, // support both naming conventions
        transaction_hash: c.transaction_hash ?? c.transactionHash ?? "",
        block_number: sanitizeNumber(c.block_number ?? c.blockNumber),
        timestamp: sanitizeTimestamp(c.timestamp),
        is_verified: Boolean(c.is_verified ?? c.isVerified),
        isVerified: Boolean(c.is_verified ?? c.isVerified),
      };
    });
}

/**
 * Validates and sanitizes an ENS profile before scoring.
 * Ensures all fields are either null or non-empty strings.
 *
 * @param {unknown} ens — raw input (may be anything)
 * @returns {{ name: string|null, avatar: string|null, url: string|null, github: string|null }}
 */
export function sanitizeENS(ens) {
  if (!ens || typeof ens !== "object") {
    return { name: null, avatar: null, url: null, github: null };
  }
  return {
    name:   typeof ens.name   === "string" && ens.name.length   > 0 ? ens.name   : null,
    avatar: typeof ens.avatar === "string" && ens.avatar.length > 0 ? ens.avatar : null,
    url:    typeof ens.url    === "string" && ens.url.length    > 0 ? ens.url    : null,
    github: typeof ens.github === "string" && ens.github.length > 0 ? ens.github : null,
  };
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalizes a raw score to the 0–100 range.
 *
 * Why normalize instead of hard-capping?
 * A hard cap (Math.min(100, raw)) would compress all high-activity profiles
 * into the same value, losing relative differences. Linear normalization
 * preserves the distribution: a profile with half the activity of the
 * theoretical max gets ~50, not 100.
 *
 * @param {number} rawScore — the computed score (can exceed 100)
 * @returns {number} integer in [0, 100]
 */
export function normalizeScore(rawScore) {
  if (!Number.isFinite(rawScore) || rawScore < 0) return 0;
  const normalized = Math.round((rawScore / THEORETICAL_MAX_SCORE) * 100);
  return Math.min(100, Math.max(0, normalized));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {number} timestamp  Unix timestamp (0 = unknown)
 * @returns {number}
 */
export function getTimeMultiplier(timestamp) {
  const safe = sanitizeTimestamp(timestamp);
  if (safe === 0) return 1.0;
  const ageSeconds = Math.floor(Date.now() / 1000) - safe;
  return ageSeconds > TIME_CONFIG.ESTABLISHED_THRESHOLD_SECONDS
    ? TIME_CONFIG.ESTABLISHED_MULTIPLIER
    : TIME_CONFIG.RECENT_BURST_MULTIPLIER;
}

/**
 * @param {Array<{contract_address: string, timestamp: number}>} contracts
 * @returns {Set<string>}
 */
export function detectBurstContracts(contracts) {
  const burst = new Set();
  const timestamped = contracts
    .filter((c) => c.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const threshold = CAPS.BURST_THRESHOLD;
  const window    = CAPS.BURST_WINDOW_SECONDS;

  for (let i = 0; i <= timestamped.length - threshold; i++) {
    if (timestamped[i + threshold - 1].timestamp - timestamped[i].timestamp <= window) {
      for (let j = i; j < i + threshold; j++) {
        burst.add(timestamped[j].contract_address);
      }
    }
  }
  return burst;
}

/**
 * Returns tier info based on normalized score (0–100).
 *
 * @param {number} normalizedScore — score in [0, 100]
 * @returns {{ tier: string, tierDescription: string }}
 */
export function getTier(normalizedScore) {
  const safe = sanitizeNumber(normalizedScore, 100);
  let tier = TIERS[0][1];
  let tierDescription = TIERS[0][2];
  for (const [minScore, label, desc] of TIERS) {
    if (safe >= minScore) {
      tier = label;
      tierDescription = desc;
    }
  }
  return { tier, tierDescription };
}

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Computes the full reputation score from on-chain data.
 * Mirrors computeReputationScore() in lib/core/scoring.ts exactly.
 *
 * Input safety: accepts raw (unvalidated) arrays and sanitizes them internally.
 * The same inputs will always produce the same output (deterministic).
 * The returned total is normalized to [0, 100].
 *
 * @param {unknown} rawContracts — contract list (will be sanitized)
 * @param {unknown} rawENS       — ENS profile (will be sanitized)
 * @param {number}  [endorsementCount=0] — number of endorsements received
 * @param {number}  [uniqueInteractors=0]
 * @returns {{
 *   total: number,
 *   breakdown: object,
 *   contractCount: number,
 *   verifiedContractCount: number,
 *   endorsementCount: number,
 *   hasEns: boolean,
 *   cappedAt: number|null,
 *   tier: string,
 *   tierDescription: string
 * }}
 */
export function computeReputationScore(rawContracts, rawENS, endorsementCount = 0, uniqueInteractors = 0) {
  const contracts = sanitizeContracts(rawContracts);
  const ens = sanitizeENS(rawENS);
  const safeEndorsementCount = sanitizeNumber(endorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED);

  const capped    = contracts.slice(0, CAPS.MAX_DEPLOYMENTS_SCORED);
  const wasCapped = contracts.length > CAPS.MAX_DEPLOYMENTS_SCORED;
  const burstAddresses = detectBurstContracts(capped);

  let deployPts    = 0;
  let verifiedPts  = 0;
  let timeBonus    = 0;
  let verifiedCount = 0;

  for (const c of capped) {
    const isBurst    = burstAddresses.has(c.contract_address);
    const multiplier = getTimeMultiplier(c.timestamp) * (isBurst ? TIME_CONFIG.RECENT_BURST_MULTIPLIER : 1.0);

    const baseD = POINTS.CONTRACT_DEPLOYMENT;
    const dPts  = Math.round(baseD * multiplier);
    deployPts  += dPts;
    timeBonus  += dPts - baseD;

    if (c.is_verified && verifiedCount < CAPS.MAX_VERIFIED_SCORED) {
      const baseV = POINTS.VERIFIED_CONTRACT;
      const vPts  = Math.round(baseV * multiplier);
      verifiedPts  += vPts;
      timeBonus    += vPts - baseV;
      verifiedCount++;
    }
  }

  const ensOwnership = ens.name ? POINTS.ENS_OWNERSHIP : 0;
  let ensMetadata = 0;
  if (ens.name) {
    for (const val of [ens.avatar, ens.url, ens.github]) {
      if (val) ensMetadata += POINTS.ENS_METADATA;
    }
  }

  // Endorsement scoring (capped to prevent farming)
  const endorsementPts = Math.min(safeEndorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED) * POINTS.ENDORSEMENT_RECEIVED;

  const rawTotal = deployPts + verifiedPts + endorsementPts + ensOwnership + ensMetadata;
  const total = normalizeScore(rawTotal);
  const { tier, tierDescription } = getTier(total);

  return {
    total,
    breakdown: {
      contract_deployments:  deployPts,
      verified_contracts:    verifiedPts,
      endorsement_points:    endorsementPts,
      ens_ownership:         ensOwnership,
      ens_metadata:          ensMetadata,
      time_multiplier_bonus: Math.round(timeBonus),
      unique_interactors:    uniqueInteractors,
    },
    contractCount:         contracts.length,
    verifiedContractCount: contracts.filter((c) => c.is_verified).length,
    endorsementCount:      Math.min(safeEndorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED),
    hasEns:                Boolean(ens.name),
    cappedAt:              wasCapped ? CAPS.MAX_DEPLOYMENTS_SCORED : null,
    tier,
    tierDescription,
  };
}
