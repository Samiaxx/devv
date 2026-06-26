/**
 * Unit tests for the server-side scoring engine (scoring.js).
 *
 * Mirrors the frontend scoring.test.ts to ensure consistency between
 * the Next.js frontend and the Node.js worker backend.
 *
 * Covers:
 *   - sanitizeNumber: NaN, Infinity, negative, overflow, non-numeric types
 *   - sanitizeContracts: invalid entries, snake_case and camelCase support
 *   - sanitizeENS: null/undefined/empty fields
 *   - normalizeScore: range [0, 100], boundary cases
 *   - computeReputationScore: deterministic output, full pipeline
 *   - getTier: tier boundaries (normalized scores)
 *   - detectBurstContracts: burst detection logic
 *   - getTimeMultiplier: established vs recent
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeNumber,
  sanitizeContracts,
  sanitizeENS,
  normalizeScore,
  computeReputationScore,
  getTier,
  detectBurstContracts,
  getTimeMultiplier,
  THEORETICAL_MAX_SCORE,
} from "../scoring.js";

// ─── sanitizeNumber ──────────────────────────────────────────────────────────

describe("server/scoring — sanitizeNumber", () => {
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

describe("server/scoring — sanitizeContracts", () => {
  it("returns empty array for non-array input", () => {
    expect(sanitizeContracts(null)).toEqual([]);
    expect(sanitizeContracts(undefined)).toEqual([]);
    expect(sanitizeContracts("string")).toEqual([]);
    expect(sanitizeContracts(123)).toEqual([]);
  });

  it("filters out entries without contract_address", () => {
    const input = [
      { contract_address: "0xabc", timestamp: 100, is_verified: false },
      { contract_address: "", timestamp: 100, is_verified: false },
      { noAddress: true },
      null,
    ];
    const result = sanitizeContracts(input);
    expect(result).toHaveLength(1);
    expect(result[0].contract_address).toBe("0xabc");
  });

  it("supports camelCase contractAddress as fallback", () => {
    const input = [
      { contractAddress: "0xabc", timestamp: 100, isVerified: false },
    ];
    const result = sanitizeContracts(input);
    expect(result).toHaveLength(1);
    expect(result[0].contract_address).toBe("0xabc");
    expect(result[0].contractAddress).toBe("0xabc");
  });

  it("sanitizes numeric fields in contracts", () => {
    const input = [
      { contract_address: "0xabc", timestamp: NaN, is_verified: false, block_number: -5 },
    ];
    const result = sanitizeContracts(input);
    expect(result[0].timestamp).toBe(0);
    expect(result[0].block_number).toBe(0);
  });

  it("handles empty array", () => {
    expect(sanitizeContracts([])).toEqual([]);
  });
});

// ─── sanitizeENS ─────────────────────────────────────────────────────────────

describe("server/scoring — sanitizeENS", () => {
  it("returns null profile for null/undefined input", () => {
    const expected = { name: null, avatar: null, url: null, github: null };
    expect(sanitizeENS(null)).toEqual(expected);
    expect(sanitizeENS(undefined)).toEqual(expected);
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
});

// ─── normalizeScore ──────────────────────────────────────────────────────────

describe("server/scoring — normalizeScore", () => {
  it("returns 0 for negative input", () => {
    expect(normalizeScore(-10)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(normalizeScore(NaN)).toBe(0);
  });

  it("returns 100 for theoretical max or above", () => {
    expect(normalizeScore(THEORETICAL_MAX_SCORE)).toBe(100);
    expect(normalizeScore(THEORETICAL_MAX_SCORE * 2)).toBe(100);
  });

  it("returns ~50 for half the theoretical max", () => {
    expect(normalizeScore(THEORETICAL_MAX_SCORE / 2)).toBe(50);
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

describe("server/scoring — getTimeMultiplier", () => {
  it("returns 1 for timestamp 0 (unknown)", () => {
    expect(getTimeMultiplier(0)).toBe(1);
  });

  it("returns ESTABLISHED_MULTIPLIER for old timestamps", () => {
    const thirtyOneDaysAgo = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    expect(getTimeMultiplier(thirtyOneDaysAgo)).toBe(1.2);
  });

  it("returns RECENT_BURST_MULTIPLIER for recent timestamps", () => {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60;
    expect(getTimeMultiplier(oneDayAgo)).toBe(0.8);
  });

  it("returns 1 for negative timestamp (sanitized to 0)", () => {
    expect(getTimeMultiplier(-100)).toBe(1);
  });

  it("returns 1 for NaN timestamp (sanitized to 0)", () => {
    expect(getTimeMultiplier(NaN)).toBe(1);
  });
});

// ─── detectBurstContracts ────────────────────────────────────────────────────

describe("server/scoring — detectBurstContracts", () => {
  it("returns empty set for fewer than BURST_THRESHOLD contracts", () => {
    const contracts = [
      { contract_address: "0x1", timestamp: 1000 },
      { contract_address: "0x2", timestamp: 2000 },
    ];
    expect(detectBurstContracts(contracts).size).toBe(0);
  });

  it("detects burst when 3+ contracts deployed within 7 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const contracts = [
      { contract_address: "0x1", timestamp: now },
      { contract_address: "0x2", timestamp: now + 100 },
      { contract_address: "0x3", timestamp: now + 200 },
    ];
    const result = detectBurstContracts(contracts);
    expect(result.size).toBe(3);
  });

  it("does not flag contracts spread over 30 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;
    const contracts = [
      { contract_address: "0x1", timestamp: now },
      { contract_address: "0x2", timestamp: now + 10 * day },
      { contract_address: "0x3", timestamp: now + 20 * day },
    ];
    expect(detectBurstContracts(contracts).size).toBe(0);
  });
});

// ─── getTier ─────────────────────────────────────────────────────────────────

describe("server/scoring — getTier", () => {
  it("returns No Activity for 0", () => {
    expect(getTier(0).tier).toBe("No Activity");
  });

  it("returns Early Activity for low scores", () => {
    expect(getTier(5).tier).toBe("Early Activity");
    expect(getTier(14).tier).toBe("Early Activity");
  });

  it("returns Active Builder for mid-low scores", () => {
    expect(getTier(15).tier).toBe("Active Builder");
    expect(getTier(34).tier).toBe("Active Builder");
  });

  it("returns Established for mid scores", () => {
    expect(getTier(35).tier).toBe("Established");
    expect(getTier(54).tier).toBe("Established");
  });

  it("returns Prolific for high scores", () => {
    expect(getTier(55).tier).toBe("Prolific");
    expect(getTier(79).tier).toBe("Prolific");
  });

  it("returns Extensive for very high scores", () => {
    expect(getTier(80).tier).toBe("Extensive");
    expect(getTier(100).tier).toBe("Extensive");
  });

  it("clamps score to 0–100 for tier lookup", () => {
    expect(getTier(200).tier).toBe("Extensive");
    expect(getTier(-50).tier).toBe("No Activity");
  });
});

// ─── computeReputationScore (integration) ────────────────────────────────────

describe("server/scoring — computeReputationScore", () => {
  it("returns 0 for empty contracts and no ENS", () => {
    const result = computeReputationScore([], {});
    expect(result.total).toBe(0);
    expect(result.contractCount).toBe(0);
    expect(result.hasEns).toBe(false);
  });

  it("returns 0 for null/undefined inputs", () => {
    const result = computeReputationScore(null, undefined);
    expect(result.total).toBe(0);
    expect(result.contractCount).toBe(0);
  });

  it("is deterministic — same input always produces same output", () => {
    const contracts = [
      { contract_address: "0x1", timestamp: 0, is_verified: true },
      { contract_address: "0x2", timestamp: 0, is_verified: false },
    ];
    const ens = { name: "test.eth" };

    const result1 = computeReputationScore(contracts, ens);
    const result2 = computeReputationScore(contracts, ens);

    expect(result1.total).toBe(result2.total);
    expect(result1.breakdown).toEqual(result2.breakdown);
  });

  it("total is always in [0, 100]", () => {
    const contracts = Array.from({ length: 100 }, (_, i) => ({
      contract_address: `0x${i}`,
      timestamp: 0,
      is_verified: true,
    }));
    const ens = { name: "vitalik.eth", avatar: "https://img.png", url: "https://v.ca", github: "vb" };

    const result = computeReputationScore(contracts, ens);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });

  it("scores higher with verified contracts than unverified", () => {
    const verified = [{ contract_address: "0x1", timestamp: 0, is_verified: true }];
    const unverified = [{ contract_address: "0x1", timestamp: 0, is_verified: false }];

    expect(computeReputationScore(verified, {}).total).toBeGreaterThan(
      computeReputationScore(unverified, {}).total
    );
  });

  it("scores higher with ENS than without", () => {
    const contracts = [{ contract_address: "0x1", timestamp: 0, is_verified: false }];
    const withENS = { name: "test.eth" };

    expect(computeReputationScore(contracts, withENS).total).toBeGreaterThan(
      computeReputationScore(contracts, {}).total
    );
  });

  it("applies deployment cap", () => {
    const contracts = Array.from({ length: 15 }, (_, i) => ({
      contract_address: `0x${i}`,
      timestamp: 0,
      is_verified: false,
    }));

    const result = computeReputationScore(contracts, {});
    expect(result.cappedAt).toBe(10);
    expect(result.contractCount).toBe(15);
  });

  it("handles camelCase contract input gracefully", () => {
    const contracts = [
      { contractAddress: "0x1", timestamp: 0, isVerified: true },
    ];

    const result = computeReputationScore(contracts, {});
    expect(result.contractCount).toBe(1);
    expect(result.verifiedContractCount).toBe(1);
  });

  it("handles invalid entries in the array gracefully", () => {
    const mixed = [
      { contract_address: "0x1", timestamp: 0, is_verified: false },
      null,
      { noAddress: true },
      { contract_address: "", timestamp: 0 },
      { contract_address: "0x2", timestamp: 0, is_verified: true },
    ];

    const result = computeReputationScore(mixed, {});
    expect(result.contractCount).toBe(2);
  });

  it("handles contracts with NaN timestamps", () => {
    const contracts = [
      { contract_address: "0x1", timestamp: NaN, is_verified: false },
      { contract_address: "0x2", timestamp: Infinity, is_verified: false },
    ];

    const result = computeReputationScore(contracts, {});
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.total)).toBe(true);
  });

  it("tier matches normalized score", () => {
    // 1 unverified contract: raw = 5, normalized = round(5/200*100) = 3
    const contracts = [{ contract_address: "0x1", timestamp: 0, is_verified: false }];
    const result = computeReputationScore(contracts, {});

    expect(result.total).toBe(normalizeScore(5));
    expect(result.tier).toBe("Early Activity");
  });

  it("returns snake_case breakdown fields", () => {
    const contracts = [{ contract_address: "0x1", timestamp: 0, is_verified: true }];
    const result = computeReputationScore(contracts, { name: "test.eth" });

    expect(result.breakdown).toHaveProperty("contract_deployments");
    expect(result.breakdown).toHaveProperty("verified_contracts");
    expect(result.breakdown).toHaveProperty("ens_ownership");
    expect(result.breakdown).toHaveProperty("ens_metadata");
    expect(result.breakdown).toHaveProperty("time_multiplier_bonus");
    expect(result.breakdown).toHaveProperty("unique_interactors");
  });
});
