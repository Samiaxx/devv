/**
 * Unit tests for the Reputation Profile builder.
 *
 * Covers:
 *   - buildReputationProfile: full pipeline from contracts + ENS → ReputationProfile
 *   - Edge cases: empty input, burst detection, data flag warnings
 *   - Consistency: score in profile matches computeReputationScore output
 */

import { describe, it, expect } from "vitest";
import { buildReputationProfile } from "../reputation";
import { computeReputationScore, normalizeScore } from "../scoring";
import { NormalizedContract, ENSProfile } from "@/lib/types";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeContract(
  address: string,
  opts: Partial<NormalizedContract> = {}
): NormalizedContract {
  return {
    contractAddress: address,
    transactionHash: `0x${address}`,
    blockNumber: 1,
    timestamp: 0,
    isVerified: false,
    ...opts,
  };
}

const emptyENS: ENSProfile = { name: null, avatar: null, url: null, github: null };
const noFailures = {
  alchemyFailed: false,
  etherscanFailed: false,
  ensFailed: false,
  includesENS: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildReputationProfile", () => {
  it("returns score 0 for empty input", () => {
    const profile = buildReputationProfile([], emptyENS, noFailures);
    expect(profile.score).toBe(0);
    expect(profile.summary.contractCount).toBe(0);
    expect(profile.summary.tier).toBe("No Activity");
  });

  it("score matches computeReputationScore output", () => {
    const contracts = [
      makeContract("0x1", { isVerified: true }),
      makeContract("0x2"),
    ];
    const ens: ENSProfile = { name: "test.eth", avatar: null, url: null, github: null };

    const direct = computeReputationScore(contracts, ens);
    const profile = buildReputationProfile(contracts, ens, { ...noFailures, includesENS: true });

    expect(profile.score).toBe(direct.total);
    expect(profile.breakdown).toEqual(direct.breakdown);
  });

  it("score is always in [0, 100]", () => {
    const contracts = Array.from({ length: 20 }, (_, i) =>
      makeContract(`0x${i}`, { isVerified: true })
    );
    const ens: ENSProfile = { name: "vitalik.eth", avatar: "https://img.png", url: "https://v.ca", github: "vb" };

    const profile = buildReputationProfile(contracts, ens, { ...noFailures, includesENS: true });

    expect(profile.score).toBeGreaterThanOrEqual(0);
    expect(profile.score).toBeLessThanOrEqual(100);
  });

  it("includes ENS explanation when ENS is present", () => {
    const ens: ENSProfile = { name: "test.eth", avatar: "https://img.png", url: null, github: null };
    const profile = buildReputationProfile([], ens, { ...noFailures, includesENS: true });

    const ensExplanation = profile.explanations.find((e) => e.includes("ENS name"));
    expect(ensExplanation).toBeDefined();
    expect(ensExplanation).toContain("test.eth");
  });

  it("includes ENS opt-out explanation when user opted out", () => {
    const profile = buildReputationProfile([], emptyENS, { ...noFailures, includesENS: false });

    const optOut = profile.explanations.find((e) => e.includes("opted out"));
    expect(optOut).toBeDefined();
  });

  it("includes no-contract explanation for empty contracts", () => {
    const profile = buildReputationProfile([], emptyENS, noFailures);

    const noContracts = profile.explanations.find((e) => e.includes("No contract deployments"));
    expect(noContracts).toBeDefined();
  });

  it("includes cap warning when contracts are capped", () => {
    const contracts = Array.from({ length: 15 }, (_, i) => makeContract(`0x${i}`));
    const profile = buildReputationProfile(contracts, emptyENS, noFailures);

    expect(profile.cappedAt).toBe(10);
    const capWarning = profile.warnings.find((w) => w.includes("first 10"));
    expect(capWarning).toBeDefined();
  });

  it("includes burst warning when burst detected", () => {
    const now = Math.floor(Date.now() / 1000);
    const contracts = [
      makeContract("0x1", { timestamp: now }),
      makeContract("0x2", { timestamp: now + 100 }),
      makeContract("0x3", { timestamp: now + 200 }),
    ];
    const profile = buildReputationProfile(contracts, emptyENS, noFailures);

    const burstWarning = profile.warnings.find((w) => w.includes("burst"));
    expect(burstWarning).toBeDefined();
  });

  it("includes Alchemy failure warning", () => {
    const profile = buildReputationProfile([], emptyENS, {
      ...noFailures,
      alchemyFailed: true,
    });

    const warning = profile.warnings.find((w) => w.includes("Alchemy"));
    expect(warning).toBeDefined();
  });

  it("includes dual-failure warning when both APIs fail", () => {
    const profile = buildReputationProfile([], emptyENS, {
      ...noFailures,
      alchemyFailed: true,
      etherscanFailed: true,
    });

    const warning = profile.warnings.find((w) => w.includes("Both Alchemy and Etherscan"));
    expect(warning).toBeDefined();
  });

  it("includes ENS failure warning", () => {
    const profile = buildReputationProfile([], emptyENS, {
      ...noFailures,
      includesENS: true,
      ensFailed: true,
    });

    const warning = profile.warnings.find((w) => w.includes("ENS lookup failed"));
    expect(warning).toBeDefined();
  });

  it("always includes the disclaimer as last warning", () => {
    const profile = buildReputationProfile([], emptyENS, noFailures);
    const lastWarning = profile.warnings[profile.warnings.length - 1];
    expect(lastWarning).toContain("on-chain activity only");
  });

  it("tier matches normalized score range", () => {
    // 1 verified contract with no timestamp → raw = 5 + 10 = 15 → normalized = round(15/200*100) = 8
    const contracts = [makeContract("0x1", { isVerified: true })];
    const profile = buildReputationProfile(contracts, emptyENS, noFailures);

    expect(profile.score).toBe(normalizeScore(15));
    // 8 → "Early Activity" tier
    expect(profile.summary.tier).toBe("Early Activity");
  });

  it("summary includes correct contract counts", () => {
    const contracts = [
      makeContract("0x1", { isVerified: true }),
      makeContract("0x2", { isVerified: false }),
      makeContract("0x3", { isVerified: true }),
    ];
    const profile = buildReputationProfile(contracts, emptyENS, noFailures);

    expect(profile.summary.contractCount).toBe(3);
    expect(profile.summary.verifiedContractCount).toBe(2);
  });

  it("handles contracts with time multiplier bonus in explanation", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60; // 60 days ago
    const contracts = [makeContract("0x1", { timestamp: oldTimestamp })];
    const profile = buildReputationProfile(contracts, emptyENS, noFailures);

    const timeExplanation = profile.explanations.find((e) => e.includes("Time weighting"));
    expect(timeExplanation).toBeDefined();
    expect(timeExplanation).toContain("bonus");
  });
});
