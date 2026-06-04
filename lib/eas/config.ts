/**
 * EAS (Ethereum Attestation Service) configuration.
 *
 * Contracts are deployed by the EAS team — we don't deploy these.
 * Schema is registered once by us; the UID is then hardcoded here.
 *
 * Sepolia addresses: https://docs.attest.org/docs/quick--start/contracts
 */

export const EAS_CONFIG = {
  sepolia: {
    easContractAddress: "0xC2679fBD37d54388Ce493F1DB75320D236e1815e",
    schemaRegistryAddress: "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0",
    /**
     * Schema UID registered on Sepolia for Proof-of-Dev attestations.
     * Schema string:
     *   uint256 score, uint256 contractCount, uint256 verifiedContractCount,
     *   bool hasENS, string tier, uint256 analyzedAt
     *
     * Register once via scripts/registerSchema.ts, then paste the UID here.
     * Until registered, set NEXT_PUBLIC_EAS_SCHEMA_UID in .env.local.
     */
    schemaUID: process.env.NEXT_PUBLIC_EAS_SCHEMA_UID ?? "",
    schemaString:
      "uint256 score, uint256 contractCount, uint256 verifiedContractCount, bool hasENS, string tier, uint256 analyzedAt",
  },
} as const;

/** EAS explorer base URL for a given attestation UID */
export function easScanUrl(uid: string): string {
  return `https://sepolia.easscan.org/attestation/view/${uid}`;
}
