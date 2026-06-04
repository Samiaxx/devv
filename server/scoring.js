/**
 * Scoring engine — Node.js port of lib/core/scoring.ts (and scoring.py).
 *
 * Pure functions, no side effects. Mirrors the TypeScript implementation
 * exactly so scores are consistent between the Next.js frontend and the
 * async worker backend.
 */

// ─── Constants (mirrors lib/core/constants.ts) ────────────────────────────────

export const POINTS = {
  CONTRACT_DEPLOYMENT: 5,
  VERIFIED_CONTRACT:   10,
  ENS_OWNERSHIP:       2,
  ENS_METADATA:        3, // per field: avatar, url, github
};

export const CAPS = {
  MAX_DEPLOYMENTS_SCORED: 10,
  MAX_VERIFIED_SCORED:    10,
  BURST_WINDOW_SECONDS:   7 * 24 * 60 * 60, // 7 days
  BURST_THRESHOLD:        3,
};

export const TIME_CONFIG = {
  ESTABLISHED_THRESHOLD_SECONDS: 30 * 24 * 60 * 60, // 30 days
  ESTABLISHED_MULTIPLIER:        1.2,
  RECENT_BURST_MULTIPLIER:       0.8,
};

export const TIERS = [
  [0,   "No Activity",    "No developer activity detected on-chain"],
  [1,   "Early Activity", "Early on-chain deployment activity"],
  [10,  "Active Builder", "Regular smart contract deployment activity"],
  [30,  "Established",    "Consistent on-chain deployment history"],
  [60,  "Prolific",       "High volume of verified on-chain activity"],
  [100, "Extensive",      "Extensive on-chain deployment history"],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {number} timestamp  Unix timestamp (0 = unknown)
 * @returns {number}
 */
export function getTimeMultiplier(timestamp) {
  if (timestamp === 0) return 1.0;
  const ageSeconds = Math.floor(Date.now() / 1000) - timestamp;
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
 * @param {number} score
 * @returns {{ tier: string, tierDescription: string }}
 */
export function getTier(score) {
  let tier = TIERS[0][1];
  let tierDescription = TIERS[0][2];
  for (const [minScore, label, desc] of TIERS) {
    if (score >= minScore) {
      tier = label;
      tierDescription = desc;
    }
  }
  return { tier, tierDescription };
}

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Computes the full reputation score from normalized on-chain data.
 * Mirrors computeReputationScore() in lib/core/scoring.ts exactly.
 *
 * @param {Array<{contract_address: string, timestamp: number, is_verified: boolean, transaction_hash?: string, block_number?: number}>} contracts
 * @param {{ name?: string|null, avatar?: string|null, url?: string|null, github?: string|null }} ens
 * @param {number} [uniqueInteractors=0]
 * @returns {{
 *   total: number,
 *   breakdown: object,
 *   contractCount: number,
 *   verifiedContractCount: number,
 *   hasEns: boolean,
 *   cappedAt: number|null,
 *   tier: string,
 *   tierDescription: string
 * }}
 */
export function computeReputationScore(contracts, ens, uniqueInteractors = 0) {
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

  const total = deployPts + verifiedPts + ensOwnership + ensMetadata;
  const { tier, tierDescription } = getTier(total);

  return {
    total,
    breakdown: {
      contract_deployments:  deployPts,
      verified_contracts:    verifiedPts,
      ens_ownership:         ensOwnership,
      ens_metadata:          ensMetadata,
      time_multiplier_bonus: Math.round(timeBonus),
      unique_interactors:    uniqueInteractors,
    },
    contractCount:         contracts.length,
    verifiedContractCount: contracts.filter((c) => c.is_verified).length,
    hasEns:                Boolean(ens.name),
    cappedAt:              wasCapped ? CAPS.MAX_DEPLOYMENTS_SCORED : null,
    tier,
    tierDescription,
  };
}
