/**
 * Reputation Scoring Engine
 *
 * Pure functions — no side effects, no API calls.
 * All logic is transparent, deterministic, and testable.
 *
 * Scoring rules (fully disclosed to users):
 *   +5  per contract deployment (capped at MAX_DEPLOYMENTS_SCORED)
 *   +10 per verified contract   (capped at MAX_VERIFIED_SCORED)
 *   +2  ENS name ownership
 *   +3  per ENS metadata field (avatar, url, github)
 *
 * Time weighting:
 *   Activity older than 30 days → 1.2× multiplier
 *   Activity within last 30 days → 0.8× multiplier
 *
 * Anti-spam:
 *   BURST_THRESHOLD+ deployments within BURST_WINDOW_SECONDS → 0.8× on all burst contracts
 *
 * Normalization:
 *   Raw scores are normalized to a 0–100 range using a theoretical maximum.
 *   Theoretical max assumes all deployments are verified, established (>30 days),
 *   non-burst, with full ENS metadata: 10×5×1.2 + 10×10×1.2 + 2 + 3×3 = 191.
 *   We round up to 200 for a clean scale factor.
 *
 * This profile reflects on-chain activity only.
 * It does NOT measure developer skill or code quality.
 */

import { NormalizedContract, ENSProfile, ReputationScore } from "@/lib/types";
import { POINTS, CAPS, TIME } from "./constants";

// Re-export for backwards compatibility and UI use
export { POINTS as SCORING_RULES };

/**
 * Theoretical maximum raw score.
 * Assumes: 10 verified deployments × (5+10) × 1.2 + 10 endorsements × 3 + ENS full (2+3×3)
 *   = 60 + 120 + 30 + 2 + 9 = 221.
 * Rounded to 230 for a clean normalization factor.
 */
export const THEORETICAL_MAX_SCORE = 230;

// ─── Input sanitization ──────────────────────────────────────────────────────

/**
 * Sanitizes a numeric input to ensure it is a finite, non-negative integer.
 * Handles NaN, Infinity, negative values, and non-numeric types safely.
 *
 * @param value  — the raw input to sanitize
 * @param max    — optional upper bound (values above are clamped)
 * @returns a safe, finite, non-negative integer
 */
export function sanitizeNumber(value: unknown, max: number = Number.MAX_SAFE_INTEGER): number {
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
function sanitizeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

/**
 * Validates and sanitizes a contract array before scoring.
 * Filters out entries that are not objects or have no contractAddress.
 * Sanitizes numeric fields to prevent NaN/Infinity propagation.
 */
export function sanitizeContracts(contracts: unknown): NormalizedContract[] {
  if (!Array.isArray(contracts)) return [];

  return contracts
    .filter(
      (c): c is NormalizedContract =>
        c !== null &&
        typeof c === "object" &&
        typeof (c as NormalizedContract).contractAddress === "string" &&
        (c as NormalizedContract).contractAddress.length > 0
    )
    .map((c) => ({
      contractAddress: c.contractAddress,
      transactionHash: c.transactionHash ?? "",
      blockNumber: sanitizeNumber(c.blockNumber),
      timestamp: sanitizeTimestamp(c.timestamp),
      isVerified: Boolean(c.isVerified),
    }));
}

/**
 * Validates and sanitizes an ENS profile before scoring.
 * Ensures all fields are either null or non-empty strings.
 */
export function sanitizeENS(ens: unknown): ENSProfile {
  if (!ens || typeof ens !== "object") {
    return { name: null, avatar: null, url: null, github: null };
  }
  const e = ens as Record<string, unknown>;
  return {
    name: typeof e.name === "string" && e.name.length > 0 ? e.name : null,
    avatar: typeof e.avatar === "string" && e.avatar.length > 0 ? e.avatar : null,
    url: typeof e.url === "string" && e.url.length > 0 ? e.url : null,
    github: typeof e.github === "string" && e.github.length > 0 ? e.github : null,
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
 * @param rawScore — the computed score (can exceed 100)
 * @returns integer in [0, 100]
 */
export function normalizeScore(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore < 0) return 0;
  const normalized = Math.round((rawScore / THEORETICAL_MAX_SCORE) * 100);
  return Math.min(100, Math.max(0, normalized));
}

// ─── Time multiplier ─────────────────────────────────────────────────────────

/**
 * Returns a time-based weight multiplier for a contract deployment.
 * Older activity = more weight. Recent burst = less weight.
 */
export function getTimeMultiplier(timestamp: number): number {
  const safe = sanitizeTimestamp(timestamp);
  if (safe === 0) return 1; // unknown timestamp — neutral

  const ageSeconds = Math.floor(Date.now() / 1000) - safe;

  if (ageSeconds > TIME.ESTABLISHED_THRESHOLD_SECONDS) {
    return TIME.ESTABLISHED_MULTIPLIER;
  }
  return TIME.RECENT_BURST_MULTIPLIER;
}

// ─── Burst detection ─────────────────────────────────────────────────────────

/**
 * Returns a set of contract addresses that are part of a deployment burst.
 * A burst is BURST_THRESHOLD+ deployments within BURST_WINDOW_SECONDS.
 * Burst contracts receive an additional penalty multiplier.
 */
export function detectBurstContracts(contracts: NormalizedContract[]): Set<string> {
  const burstAddresses = new Set<string>();

  const timestamped = contracts
    .filter((c) => c.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i <= timestamped.length - CAPS.BURST_THRESHOLD; i++) {
    const window =
      timestamped[i + CAPS.BURST_THRESHOLD - 1].timestamp - timestamped[i].timestamp;

    if (window <= CAPS.BURST_WINDOW_SECONDS) {
      // Mark all contracts in this window as burst
      for (let j = i; j < i + CAPS.BURST_THRESHOLD; j++) {
        burstAddresses.add(timestamped[j].contractAddress);
      }
    }
  }

  return burstAddresses;
}

// ─── Main scoring function ───────────────────────────────────────────────────

/**
 * Computes the full reputation score from normalized on-chain data.
 * Returns a breakdown so the UI can explain every point.
 *
 * Input safety: accepts raw (unvalidated) arrays and sanitizes them internally.
 * The same inputs will always produce the same output (deterministic).
 * The returned total is normalized to [0, 100].
 *
 * @param rawContracts — contract list (will be sanitized)
 * @param rawENS       — ENS profile (will be sanitized)
 * @param rawEndorsementCount — number of endorsements received (will be sanitized)
 */
export function computeReputationScore(
  rawContracts: unknown,
  rawENS: unknown,
  rawEndorsementCount: unknown = 0
): ReputationScore {
  const contracts = sanitizeContracts(rawContracts);
  const ens = sanitizeENS(rawENS);
  const endorsementCount = sanitizeNumber(rawEndorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED);

  // Apply cap to prevent spam boosting
  const cappedContracts = contracts.slice(0, CAPS.MAX_DEPLOYMENTS_SCORED);
  const wasCapped = contracts.length > CAPS.MAX_DEPLOYMENTS_SCORED;

  // Detect burst deployments within the capped set
  const burstAddresses = detectBurstContracts(cappedContracts);

  let contractDeploymentPoints = 0;
  let verifiedContractPoints = 0;
  let timeMultiplierBonus = 0;
  let verifiedCount = 0;

  for (const contract of cappedContracts) {
    const isBurst = burstAddresses.has(contract.contractAddress);
    // Burst contracts get an additional 0.8x on top of the time multiplier
    const multiplier =
      getTimeMultiplier(contract.timestamp) * (isBurst ? TIME.RECENT_BURST_MULTIPLIER : 1);

    const baseDeployPoints = POINTS.CONTRACT_DEPLOYMENT;
    const deployPoints = Math.round(baseDeployPoints * multiplier);

    contractDeploymentPoints += deployPoints;
    timeMultiplierBonus += deployPoints - baseDeployPoints;

    if (contract.isVerified && verifiedCount < CAPS.MAX_VERIFIED_SCORED) {
      const baseVerifiedPoints = POINTS.VERIFIED_CONTRACT;
      const verifiedPoints = Math.round(baseVerifiedPoints * multiplier);
      verifiedContractPoints += verifiedPoints;
      timeMultiplierBonus += verifiedPoints - baseVerifiedPoints;
      verifiedCount++;
    }
  }

  // ENS scoring (only if user opted in — ens.name will be null otherwise)
  const ensOwnershipPoints = ens.name ? POINTS.ENS_OWNERSHIP : 0;

  let ensMetadataPoints = 0;
  if (ens.name) {
    if (ens.avatar) ensMetadataPoints += POINTS.ENS_METADATA;
    if (ens.url) ensMetadataPoints += POINTS.ENS_METADATA;
    if (ens.github) ensMetadataPoints += POINTS.ENS_METADATA;
  }

  // Endorsement scoring (capped to prevent farming)
  const endorsementPoints = Math.min(endorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED) * POINTS.ENDORSEMENT_RECEIVED;

  const rawTotal =
    contractDeploymentPoints +
    verifiedContractPoints +
    endorsementPoints +
    ensOwnershipPoints +
    ensMetadataPoints;

  return {
    total: normalizeScore(rawTotal),
    breakdown: {
      contractDeployments: contractDeploymentPoints,
      verifiedContracts: verifiedContractPoints,
      endorsementPoints,
      ensOwnership: ensOwnershipPoints,
      ensMetadata: ensMetadataPoints,
      timeMultiplierBonus: Math.round(timeMultiplierBonus),
    },
    contractCount: contracts.length,
    verifiedContractCount: contracts.filter((c) => c.isVerified).length,
    endorsementCount: Math.min(endorsementCount, CAPS.MAX_ENDORSEMENTS_SCORED),
    hasENS: !!ens.name,
    cappedAt: wasCapped ? CAPS.MAX_DEPLOYMENTS_SCORED : null,
  };
}

// ─── Tier labels ─────────────────────────────────────────────────────────────

/**
 * Returns a human-readable tier label based on normalized score (0–100).
 * Labels describe activity level, NOT skill level.
 *
 * @param score — a normalized score in [0, 100]
 */
export function getScoreTier(score: number): {
  label: string;
  color: string;
  description: string;
} {
  const safe = sanitizeNumber(score, 100);

  if (safe === 0) {
    return {
      label: "No Activity",
      color: "text-gray-400",
      description: "No developer activity detected on-chain",
    };
  }
  if (safe < 15) {
    return {
      label: "Early Activity",
      color: "text-blue-400",
      description: "Early on-chain deployment activity",
    };
  }
  if (safe < 35) {
    return {
      label: "Active Builder",
      color: "text-green-400",
      description: "Regular smart contract deployment activity",
    };
  }
  if (safe < 55) {
    return {
      label: "Established",
      color: "text-yellow-400",
      description: "Consistent on-chain deployment history",
    };
  }
  if (safe < 80) {
    return {
      label: "Prolific",
      color: "text-orange-400",
      description: "High volume of verified on-chain activity",
    };
  }
  return {
    label: "Extensive",
    color: "text-purple-400",
    description: "Extensive on-chain deployment history",
  };
}
