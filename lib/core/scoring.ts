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
 * This profile reflects on-chain activity only.
 * It does NOT measure developer skill or code quality.
 */

import { NormalizedContract, ENSProfile, ReputationScore } from "@/lib/types";
import { POINTS, CAPS, TIME } from "./constants";

// Re-export for backwards compatibility and UI use
export { POINTS as SCORING_RULES };

// ─── Time multiplier ─────────────────────────────────────────────────────────

/**
 * Returns a time-based weight multiplier for a contract deployment.
 * Older activity = more weight. Recent burst = less weight.
 */
export function getTimeMultiplier(timestamp: number): number {
  if (timestamp === 0) return 1; // unknown timestamp — neutral

  const ageSeconds = Math.floor(Date.now() / 1000) - timestamp;

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
 * @param contracts - Normalized, privacy-filtered contract list
 * @param ens       - Normalized ENS profile (empty if user opted out)
 */
export function computeReputationScore(
  contracts: NormalizedContract[],
  ens: ENSProfile
): ReputationScore {
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
    // Burst contracts get an additional 0.8× on top of the time multiplier
    const multiplier = getTimeMultiplier(contract.timestamp) * (isBurst ? TIME.RECENT_BURST_MULTIPLIER : 1);

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

  const total =
    contractDeploymentPoints +
    verifiedContractPoints +
    ensOwnershipPoints +
    ensMetadataPoints;

  return {
    total,
    breakdown: {
      contractDeployments: contractDeploymentPoints,
      verifiedContracts: verifiedContractPoints,
      ensOwnership: ensOwnershipPoints,
      ensMetadata: ensMetadataPoints,
      timeMultiplierBonus: Math.round(timeMultiplierBonus),
    },
    contractCount: contracts.length,
    verifiedContractCount: contracts.filter((c) => c.isVerified).length,
    hasENS: !!ens.name,
    cappedAt: wasCapped ? CAPS.MAX_DEPLOYMENTS_SCORED : null,
  };
}

// ─── Tier labels ─────────────────────────────────────────────────────────────

/**
 * Returns a human-readable tier label based on total score.
 * Labels describe activity level, NOT skill level.
 */
export function getScoreTier(score: number): {
  label: string;
  color: string;
  description: string;
} {
  if (score === 0) {
    return {
      label: "No Activity",
      color: "text-gray-400",
      description: "No developer activity detected on-chain",
    };
  }
  if (score < 10) {
    return {
      label: "Early Activity",
      color: "text-blue-400",
      description: "Early on-chain deployment activity",
    };
  }
  if (score < 30) {
    return {
      label: "Active Builder",
      color: "text-green-400",
      description: "Regular smart contract deployment activity",
    };
  }
  if (score < 60) {
    return {
      label: "Established",
      color: "text-yellow-400",
      description: "Consistent on-chain deployment history",
    };
  }
  if (score < 100) {
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
