/**
 * Unit tests for the Reputation Scoring Engine.
 *
 * Covers:
 *   - sanitizeNumber: NaN, Infinity, negative, overflow, non-numeric types
 *   - sanitizeContracts: invalid entries, missing fields
 *   - sanitizeENS: null/undefined/empty fields
 *   - normalizeScore: range [0, 100], boundary cases
 *   - computeReputationScore: deterministic output, full pipeline
 *   - getScoreTier: tier boundaries
 *   - detectBurstContracts: burst detection logic
 *   - getTimeMultiplier: established vs recent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sanitizeNumber,
  sanitizeContracts,
  sanitizeENS,
  normalizeScore,
  computeReputationScore,
  getScoreTier,
  detectBurstContracts,
  getTimeMultiplier,
  THEORETICAL_MAX_SCORE,
} from "../scoring";
import { NormalizedContract, ENSProfile } from "@/lib/types";

// ─── sanitizeNumber ──────────────────────────────────────────────────────────

describe("sanitizeNumber", () => {
  it("returns 0 for NaN", () => {
    expect(sanitizeNumber(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(sanitizeNumber(Infinity)).toBe(0);
    expect(sanitizeNumber(-Infinity)).toBe(0);
  });

  it("returns 0 for negative values", () => {
    expect(sanitizeNumber(-1)).toBe(0);
    expect(sanitizeNumber(-100)).toBe(0);
  });

  it("returns 0 for non-numeric types", () => {
    expect(sanitizeNumber(undefined)).toBe(0);
    expect(sanitizeNumber(null)).toBe(0);
    expect(sanitizeNumber("hello")).toBe(0);
    expect(sanitizeNumber({})).toBe(0);
    expect(sanitizeNumber([])).toBe(0);
  });

  it("floors decimal values", () => {
    expect(sanitizeNumber(4.7)).toBe(4);
    expect(sanitizeNumber(0.1)).toBe(0);
  });

  it("clamps to max when provided", () => {
    expect(sanitizeNumber(500, 100)).toBe(100);
    expect(sanitizeNumber(101, 100)).toBe(100);
  });

  it("accepts valid non-negative integers", () => {
    expect(sanitizeNumber(0)).toBe(0);
    expect(sanitizeNumber(42)).toBe(42);
    expect(sanitizeNumber(100)).toBe(100);
  });
});

// ─── sanitizeContracts ───────────────────────────────────────────────────────

describe("sanitizeContracts", () => {
  it("returns empty array for non-array input", () => {
    expect(sanitizeContracts(null)).toEqual([]);
    expect(sanitizeContracts(undefined)).toEqual([]);
    expect(sanitizeContracts("string")).toEqual([]);
    expect(sanitizeContracts(123)).toEqual([]);
  });

  it("filters out entries without contractAddress", () => {
    const input = [
      { contractAddress: "0xabc", timestamp: 100, isVerified: false, transactionHash: "0x1", blockNumber: 1 },
      { contractAddress: "", timestamp: 100, isVerified: false, transactionHash: "0x2", blockNumber: 2 },
      { noAddress: true },
      null,
    ];
    const result = sanitizeContracts(input);
    expect(result).toHaveLength(1);
    expect(result[0].contractAddress).toBe("0xabc");
  });

  it("sanitizes numeric fields in contracts", () => {
    const input = [
      { contractAddress: "0xabc", timestamp: NaN, isVerified: false, transactionHash: "0x1", blockNumber: -5 },
    ];
    const result = sanitizeContracts(input);
    expect(result[0].timestamp).toBe(0);
    expect(result[0].blockNumber).toBe(0);
  });

  it("handles empty array", () => {
    expect(sanitizeContracts([])).toEqual([]);
  });
});

// ─── sanitizeENS ─────────────────────────────────────────────────────────────

describe("sanitizeENS", () => {
  it("returns null profile for null/undefined input", () => {
    const expected = { name: null, avatar: null, url: null, github: null };
    expect(sanitizeENS(null)).toEqual(expected);
    expect(sanitizeENS(undefined)).toEqual(expected);
  });

  it("returns null profile for non-object input", () => {
    expect(sanitizeENS("string")).toEqual({ name: null, avatar: null, url: null, github: null });
    expect(sanitizeENS(123)).toEqual({ name: null, avatar: null, url: null, github: null });
  });

  it("keeps valid string fields", () => {
    const input = { name: "vitalik.eth", avatar: "https://img.png", url: "https://vitalik.ca", github: "vbuterin" };
    expect(sanitizeENS(input)).toEqual(input);
  });

  it("nullifies empty strings", () => {
    const input = { name: "", avatar: "", url: "https://ok.com", github: "" };
    const result = sanitizeENS(input);
    expect(result.name).toBeNull();
    expect(result.avatar).toBeNull();
    expect(result.url).toBe("https://ok.com");
    expect(result.github).toBeNull();
  });

  it("handles partial objects", () => {
    const input = { name: "test.eth" };
    const result = sanitizeENS(input);
    expect(result.name).toBe("test.eth");
    expect(result.avatar).toBeNull();
  });
});

// ─── normalizeScore ──────────────────────────────────────────────────────────

describe("normalizeScore", () => {
  it("returns 0 for negative input", () => {
    expect(normalizeScore(-10)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(normalizeScore(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(normalizeScore(Infinity)).toBe(0);
  });

  it("returns 0 for 0", () => {
    expect(normalizeScore(0)).toBe(0);
  });

  it("returns 100 for theoretical max or above", () => {
    expect(normalizeScore(THEORETICAL_MAX_SCORE)).toBe(100);
    expect(normalizeScore(THEORETICAL_MAX_SCORE * 2)).toBe(100);
  });

  it("returns ~50 for half the theoretical max", () => {
    // Half of 230 = 115 → normalizeScore(115) = Math.round(115/230*100) = 50
    expect(normalizeScore(THEORETICAL_MAX_SCORE / 2)).toBe(50);
  });

  it("returns integer values", () => {
    const result = normalizeScore(37);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("always returns a value in [0, 100]", () => {
    const testValues = [-100, -1, 0, 1, 50, 100, 150, 200, 500, NaN, Infinity, -Infinity];
    for (const v of testValues) {
      const result = normalizeScore(v);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});

// ─── getTimeMultiplier ───────────────────────────────────────────────────────

describe("getTimeMultiplier", () => {
  it("returns 1 for timestamp 0 (unknown)", () => {
    expect(getTimeMultiplier(0)).toBe(1);
  });

  it("returns ESTABLISHED_MULTIPLIER for old timestamps (>30 days)", () => {
    const thirtyOneDaysAgo = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    expect(getTimeMultiplier(thirtyOneDaysAgo)).toBe(1.2);
  });

  it("returns RECENT_BURST_MULTIPLIER for recent timestamps (<30 days)", () => {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60;
    expect(getTimeMultiplier(oneDayAgo)).toBe(0.8);
  });

  it("returns 0 for negative timestamp (sanitized to 0 → neutral)", () => {
    expect(getTimeMultiplier(-100)).toBe(1);
  });

  it("returns 0 for NaN timestamp (sanitized to 0 → neutral)", () => {
    expect(getTimeMultiplier(NaN)).toBe(1);
  });
});

// ─── detectBurstContracts ────────────────────────────────────────────────────

describe("detectBurstContracts", () => {
  it("returns empty set for fewer than BURST_THRESHOLD contracts", () => {
    const contracts: NormalizedContract[] = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 1000, isVerified: false },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 2, timestamp: 2000, isVerified: false },
    ];
    const result = detectBurstContracts(contracts);
    expect(result.size).toBe(0);
  });

  it("detects burst when 3+ contracts deployed within 7 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const contracts: NormalizedContract[] = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: now, isVerified: false },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 2, timestamp: now + 100, isVerified: false },
      { contractAddress: "0x3", transactionHash: "0x3", blockNumber: 3, timestamp: now + 200, isVerified: false },
    ];
    const result = detectBurstContracts(contracts);
    expect(result.size).toBe(3);
    expect(result.has("0x1")).toBe(true);
    expect(result.has("0x2")).toBe(true);
    expect(result.has("0x3")).toBe(true);
  });

  it("does not flag contracts spread over 30 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;
    const contracts: NormalizedContract[] = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: now, isVerified: false },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 2, timestamp: now + 10 * day, isVerified: false },
      { contractAddress: "0x3", transactionHash: "0x3", blockNumber: 3, timestamp: now + 20 * day, isVerified: false },
    ];
    const result = detectBurstContracts(contracts);
    expect(result.size).toBe(0);
  });

  it("returns empty set for empty input", () => {
    expect(detectBurstContracts([]).size).toBe(0);
  });
});

// ─── getScoreTier ────────────────────────────────────────────────────────────

describe("getScoreTier", () => {
  it("returns No Activity for 0", () => {
    expect(getScoreTier(0).label).toBe("No Activity");
  });

  it("returns Early Activity for low scores", () => {
    expect(getScoreTier(5).label).toBe("Early Activity");
    expect(getScoreTier(14).label).toBe("Early Activity");
  });

  it("returns Active Builder for mid-low scores", () => {
    expect(getScoreTier(15).label).toBe("Active Builder");
    expect(getScoreTier(34).label).toBe("Active Builder");
  });

  it("returns Established for mid scores", () => {
    expect(getScoreTier(35).label).toBe("Established");
    expect(getScoreTier(54).label).toBe("Established");
  });

  it("returns Prolific for high scores", () => {
    expect(getScoreTier(55).label).toBe("Prolific");
    expect(getScoreTier(79).label).toBe("Prolific");
  });

  it("returns Extensive for very high scores", () => {
    expect(getScoreTier(80).label).toBe("Extensive");
    expect(getScoreTier(100).label).toBe("Extensive");
  });

  it("clamps score to 0–100 for tier lookup", () => {
    expect(getScoreTier(200).label).toBe("Extensive");
    expect(getScoreTier(-50).label).toBe("No Activity");
    expect(getScoreTier(NaN).label).toBe("No Activity");
  });
});

// ─── computeReputationScore (integration) ────────────────────────────────────

describe("computeReputationScore", () => {
  const emptyENS: ENSProfile = { name: null, avatar: null, url: null, github: null };

  it("returns 0 for empty contracts and no ENS", () => {
    const result = computeReputationScore([], emptyENS);
    expect(result.total).toBe(0);
    expect(result.contractCount).toBe(0);
    expect(result.hasENS).toBe(false);
  });

  it("returns 0 for null/undefined inputs", () => {
    const result = computeReputationScore(null, undefined);
    expect(result.total).toBe(0);
    expect(result.contractCount).toBe(0);
  });

  it("is deterministic — same input always produces same output", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 100, timestamp: 0, isVerified: true },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 200, timestamp: 0, isVerified: false },
    ];
    const ens: ENSProfile = { name: "test.eth", avatar: null, url: null, github: null };

    const result1 = computeReputationScore(contracts, ens);
    const result2 = computeReputationScore(contracts, ens);

    expect(result1.total).toBe(result2.total);
    expect(result1.breakdown).toEqual(result2.breakdown);
    expect(result1.contractCount).toBe(result2.contractCount);
  });

  it("total is always in [0, 100]", () => {
    // Large number of contracts — should still be capped by normalization
    const contracts = Array.from({ length: 100 }, (_, i) => ({
      contractAddress: `0x${i}`,
      transactionHash: `0x${i}`,
      blockNumber: i,
      timestamp: 0,
      isVerified: true,
    }));
    const ens: ENSProfile = { name: "vitalik.eth", avatar: "https://img.png", url: "https://v.ca", github: "vb" };

    const result = computeReputationScore(contracts, ens);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("scores higher with verified contracts than unverified", () => {
    const verified = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: true },
    ];
    const unverified = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const scoreVerified = computeReputationScore(verified, emptyENS);
    const scoreUnverified = computeReputationScore(unverified, emptyENS);

    expect(scoreVerified.total).toBeGreaterThan(scoreUnverified.total);
  });

  it("scores higher with ENS than without", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];
    const withENS: ENSProfile = { name: "test.eth", avatar: null, url: null, github: null };

    const scoreWithENS = computeReputationScore(contracts, withENS);
    const scoreWithoutENS = computeReputationScore(contracts, emptyENS);

    expect(scoreWithENS.total).toBeGreaterThan(scoreWithoutENS.total);
  });

  it("scores higher with ENS metadata fields", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];
    const basicENS: ENSProfile = { name: "test.eth", avatar: null, url: null, github: null };
    const fullENS: ENSProfile = { name: "test.eth", avatar: "https://img.png", url: "https://test.com", github: "testuser" };

    const scoreBasic = computeReputationScore(contracts, basicENS);
    const scoreFull = computeReputationScore(contracts, fullENS);

    expect(scoreFull.total).toBeGreaterThan(scoreBasic.total);
  });

  it("applies deployment cap", () => {
    // 15 contracts should be capped at 10
    const contracts = Array.from({ length: 15 }, (_, i) => ({
      contractAddress: `0x${i}`,
      transactionHash: `0x${i}`,
      blockNumber: i,
      timestamp: 0,
      isVerified: false,
    }));

    const result = computeReputationScore(contracts, emptyENS);
    expect(result.cappedAt).toBe(10);
    expect(result.contractCount).toBe(15); // original count preserved
  });

  it("handles invalid entries in the array gracefully", () => {
    const mixed = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
      null,
      { noAddress: true },
      { contractAddress: "", timestamp: 0 },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 2, timestamp: 0, isVerified: true },
    ] as unknown[];

    const result = computeReputationScore(mixed, emptyENS);
    expect(result.contractCount).toBe(2); // only valid entries
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("handles contracts with NaN/Infinity timestamps", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: NaN, isVerified: false },
      { contractAddress: "0x2", transactionHash: "0x2", blockNumber: 2, timestamp: Infinity, isVerified: false },
    ];

    const result = computeReputationScore(contracts, emptyENS);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.total)).toBe(true);
  });

  // ── Endorsement scoring ───────────────────────────────────────────────────

  it("scores higher with endorsements than without", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const scoreWith = computeReputationScore(contracts, emptyENS, 5);
    const scoreWithout = computeReputationScore(contracts, emptyENS, 0);

    expect(scoreWith.total).toBeGreaterThan(scoreWithout.total);
    expect(scoreWith.breakdown.endorsementPoints).toBe(15); // 5 × 3
    expect(scoreWithout.breakdown.endorsementPoints).toBe(0);
  });

  it("caps endorsement count at MAX_ENDORSEMENTS_SCORED", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const result = computeReputationScore(contracts, emptyENS, 50);
    expect(result.endorsementCount).toBe(10); // capped at 10
    expect(result.breakdown.endorsementPoints).toBe(30); // 10 × 3
  });

  it("handles negative endorsement count safely", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const result = computeReputationScore(contracts, emptyENS, -5);
    expect(result.endorsementCount).toBe(0);
    expect(result.breakdown.endorsementPoints).toBe(0);
  });

  it("handles NaN endorsement count safely", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const result = computeReputationScore(contracts, emptyENS, NaN);
    expect(result.endorsementCount).toBe(0);
    expect(result.breakdown.endorsementPoints).toBe(0);
  });

  it("defaults endorsement count to 0 when not provided", () => {
    const contracts = [
      { contractAddress: "0x1", transactionHash: "0x1", blockNumber: 1, timestamp: 0, isVerified: false },
    ];

    const result = computeReputationScore(contracts, emptyENS);
    expect(result.endorsementCount).toBe(0);
    expect(result.breakdown.endorsementPoints).toBe(0);
  });
});
