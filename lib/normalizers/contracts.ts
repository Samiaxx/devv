/**
 * Contract deployment normalizer.
 * Cleans raw API data from Alchemy or Etherscan into a consistent shape
 * before it reaches the scoring engine.
 */

import { NormalizedContract } from "@/lib/types";

/**
 * Normalizes a single contract deployment record.
 * Fills in safe defaults for any missing or malformed fields.
 */
export function normalizeContract(raw: Partial<NormalizedContract>): NormalizedContract {
  return {
    contractAddress: (raw.contractAddress ?? "").toLowerCase().trim(),
    transactionHash: raw.transactionHash ?? "",
    blockNumber: typeof raw.blockNumber === "number" && raw.blockNumber >= 0
      ? raw.blockNumber
      : 0,
    timestamp: typeof raw.timestamp === "number" && raw.timestamp > 0
      ? raw.timestamp
      : 0,
    isVerified: raw.isVerified === true,
  };
}

/**
 * Normalizes an array of contract deployments.
 * Drops any entry with a missing or invalid contract address.
 */
export function normalizeContracts(
  raw: Partial<NormalizedContract>[]
): NormalizedContract[] {
  return raw
    .map(normalizeContract)
    .filter((c) => c.contractAddress.length === 42 && c.contractAddress.startsWith("0x"));
}

/**
 * Deduplicates contracts by address, keeping the earliest timestamp.
 * Prevents double-counting if both Alchemy and Etherscan return the same contract.
 */
export function deduplicateContracts(
  contracts: NormalizedContract[]
): NormalizedContract[] {
  const seen = new Map<string, NormalizedContract>();

  for (const contract of contracts) {
    const existing = seen.get(contract.contractAddress);
    if (!existing) {
      seen.set(contract.contractAddress, contract);
    } else {
      // Keep the one with the earlier (non-zero) timestamp
      const keepExisting =
        existing.timestamp > 0 &&
        (contract.timestamp === 0 || existing.timestamp <= contract.timestamp);
      if (!keepExisting) {
        seen.set(contract.contractAddress, contract);
      }
    }
  }

  return Array.from(seen.values());
}
