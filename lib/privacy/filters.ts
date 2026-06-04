/**
 * Privacy filters — apply consent config before any data reaches scoring.
 *
 * Rules:
 * - ENS data MUST be empty unless consent.includeENS is true
 * - Filters are pure functions (no side effects)
 */

import { ENSProfile, NormalizedContract } from "@/lib/types";
import { ConsentConfig } from "./consent";

const EMPTY_ENS: ENSProfile = {
  name: null,
  avatar: null,
  url: null,
  github: null,
};

/**
 * Returns ENS data only if the user consented to ENS inclusion.
 * Otherwise returns an empty profile — scoring will treat it as no ENS.
 */
export function filterENS(ens: ENSProfile, consent: ConsentConfig): ENSProfile {
  if (!consent.includeENS) return EMPTY_ENS;
  return ens;
}

/**
 * Pass-through filter for contracts.
 * Kept here so future per-contract privacy controls can be added cleanly.
 */
export function filterContracts(contracts: NormalizedContract[]): NormalizedContract[] {
  return contracts;
}
