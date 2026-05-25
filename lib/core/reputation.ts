/**
 * Reputation Profile builder.
 *
 * Takes normalized, filtered data and produces a structured ReputationProfile
 * with a score, per-category breakdown, human-readable explanations, and
 * any warnings the UI should surface to the user.
 *
 * This is the single place where raw numbers become a meaningful profile.
 */

import { NormalizedContract, ENSProfile, ReputationProfile } from "@/lib/types";
import { computeReputationScore, getScoreTier } from "./scoring";
import { CAPS, DISCLAIMER } from "./constants";

/**
 * Detects whether a set of contracts shows burst-deployment behaviour.
 * Returns true if BURST_THRESHOLD or more contracts were deployed within
 * BURST_WINDOW_SECONDS of each other.
 */
function detectBurst(contracts: NormalizedContract[]): boolean {
  const timestamped = contracts
    .map((c) => c.timestamp)
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  if (timestamped.length < CAPS.BURST_THRESHOLD) return false;

  for (let i = 0; i <= timestamped.length - CAPS.BURST_THRESHOLD; i++) {
    const window =
      timestamped[i + CAPS.BURST_THRESHOLD - 1] - timestamped[i];
    if (window <= CAPS.BURST_WINDOW_SECONDS) return true;
  }

  return false;
}

/**
 * Builds the full ReputationProfile from normalized data.
 *
 * @param contracts  Normalized, privacy-filtered contract list
 * @param ens        Normalized ENS profile (empty if user opted out)
 * @param dataFlags  Flags indicating which data sources had issues
 */
export function buildReputationProfile(
  contracts: NormalizedContract[],
  ens: ENSProfile,
  dataFlags: {
    alchemyFailed: boolean;
    etherscanFailed: boolean;
    ensFailed: boolean;
    includesENS: boolean;
  }
): ReputationProfile {
  const score = computeReputationScore(contracts, ens);
  const tier = getScoreTier(score.total);
  const isBurst = detectBurst(contracts);

  // ── Explanations ────────────────────────────────────────────────────────────
  // One sentence per scoring category, shown in the UI breakdown.
  const explanations: string[] = [];

  if (score.contractCount > 0) {
    const capped = score.cappedAt !== null;
    explanations.push(
      `${score.contractCount} contract deployment${score.contractCount !== 1 ? "s" : ""} detected` +
        (capped ? ` — scored up to ${score.cappedAt} (cap applied)` : "") +
        `. +${score.breakdown.contractDeployments} pts`
    );
  } else {
    explanations.push("No contract deployments found for this address.");
  }

  if (score.verifiedContractCount > 0) {
    explanations.push(
      `${score.verifiedContractCount} contract${score.verifiedContractCount !== 1 ? "s" : ""} verified on Etherscan. +${score.breakdown.verifiedContracts} pts`
    );
  } else if (score.contractCount > 0) {
    explanations.push("No verified contracts found on Etherscan.");
  }

  if (dataFlags.includesENS) {
    if (ens.name) {
      const metaCount = [ens.avatar, ens.url, ens.github].filter(Boolean).length;
      explanations.push(
        `ENS name "${ens.name}" found. +${score.breakdown.ensOwnership} pts ownership` +
          (metaCount > 0
            ? `, +${score.breakdown.ensMetadata} pts from ${metaCount} metadata field${metaCount !== 1 ? "s" : ""}.`
            : ".")
      );
    } else {
      explanations.push("No ENS name found for this address.");
    }
  } else {
    explanations.push("ENS lookup was not included (user opted out).");
  }

  if (score.breakdown.timeMultiplierBonus !== 0) {
    const direction = score.breakdown.timeMultiplierBonus > 0 ? "bonus" : "penalty";
    explanations.push(
      `Time weighting ${direction}: ${score.breakdown.timeMultiplierBonus > 0 ? "+" : ""}${score.breakdown.timeMultiplierBonus} pts ` +
        "(activity >30 days old = 1.2×, <30 days = 0.8×)."
    );
  }

  // ── Warnings ────────────────────────────────────────────────────────────────
  // Surfaced in the UI as yellow notices. Non-blocking.
  const warnings: string[] = [];

  if (isBurst) {
    warnings.push(
      `High recent deployment activity detected (${CAPS.BURST_THRESHOLD}+ contracts within ${CAPS.BURST_WINDOW_SECONDS / 86400} days). ` +
        "Recent burst activity receives reduced weight."
    );
  }

  if (score.cappedAt !== null) {
    warnings.push(
      `Only the first ${score.cappedAt} deployments were scored. ` +
        "Cap prevents spam boosting."
    );
  }

  if (dataFlags.alchemyFailed && dataFlags.etherscanFailed) {
    warnings.push(
      "Both Alchemy and Etherscan data sources failed. " +
        "Contract list may be incomplete or empty."
    );
  } else if (dataFlags.alchemyFailed) {
    warnings.push(
      "Alchemy data unavailable — fell back to Etherscan. Data may be incomplete."
    );
  } else if (dataFlags.etherscanFailed) {
    warnings.push(
      "Etherscan verification check failed. Verified contract count may be understated."
    );
  }

  if (dataFlags.includesENS && dataFlags.ensFailed) {
    warnings.push("ENS lookup failed. ENS data was not included in scoring.");
  }

  // Always include the base disclaimer as the last warning
  warnings.push(DISCLAIMER);

  // ── Summary ─────────────────────────────────────────────────────────────────
  return {
    summary: {
      contractCount: score.contractCount,
      verifiedContractCount: score.verifiedContractCount,
      hasENS: score.hasENS,
      ensName: ens.name,
      tier: tier.label,
      tierDescription: tier.description,
    },
    score: score.total,
    breakdown: score.breakdown,
    cappedAt: score.cappedAt,
    explanations,
    warnings,
  };
}
