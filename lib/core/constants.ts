/**
 * Central constants for the Proof-of-Dev scoring system.
 * All scoring weights, caps, and time thresholds live here.
 * Changing a value here propagates everywhere automatically.
 */

// ─── Scoring weights ──────────────────────────────────────────────────────────

export const POINTS = {
  CONTRACT_DEPLOYMENT: 5,
  VERIFIED_CONTRACT: 10,
  ENDORSEMENT_RECEIVED: 3, // per unique endorsement received (social signal)
  ENS_OWNERSHIP: 2,
  ENS_METADATA: 3, // per field: avatar, url, github
} as const;

// ─── Anti-spam caps ───────────────────────────────────────────────────────────

export const CAPS = {
  /** Maximum deployments that contribute to score (prevents spam boosting) */
  MAX_DEPLOYMENTS_SCORED: 10,
  /** Maximum verified contracts that contribute to score */
  MAX_VERIFIED_SCORED: 10,
  /** Maximum endorsements that contribute to score (prevents endorsement farming) */
  MAX_ENDORSEMENTS_SCORED: 10,
  /** Deployments within this window trigger burst detection (seconds) */
  BURST_WINDOW_SECONDS: 7 * 24 * 60 * 60, // 7 days
  /** If this many or more deployments fall in the burst window, flag it */
  BURST_THRESHOLD: 3,
} as const;

// ─── Time weighting ───────────────────────────────────────────────────────────

export const TIME = {
  /** Activity older than this gets a bonus multiplier */
  ESTABLISHED_THRESHOLD_SECONDS: 30 * 24 * 60 * 60, // 30 days
  /** Multiplier for established (older) activity */
  ESTABLISHED_MULTIPLIER: 1.2,
  /** Multiplier for recent burst activity */
  RECENT_BURST_MULTIPLIER: 0.8,
} as const;

// ─── Disclaimer text ─────────────────────────────────────────────────────────

export const DISCLAIMER =
  "This profile reflects on-chain activity only and does not guarantee " +
  "developer skill or code quality. Data may be incomplete.";

export const METADATA_DISCLAIMER =
  "Activity-based profile, not a certification. " +
  "Reflects on-chain data only.";
