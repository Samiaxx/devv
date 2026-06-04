/**
 * EAS Attestation Service — server-side delegated attestation.
 *
 * Flow:
 *   1. Server signs a delegated attestation using ATTESTER_PRIVATE_KEY.
 *   2. The signed payload is returned to the client.
 *   3. The client submits the tx on-chain (user pays gas).
 *
 * This means:
 *   - The server vouches for the data it computed (its signature is the proof).
 *   - The user controls submission — they decide when/whether to publish.
 *   - The server never holds user funds or submits transactions on their behalf.
 *
 * Required env var (server-side only, never exposed to client):
 *   ATTESTER_PRIVATE_KEY — private key of the attester wallet.
 *   This wallet signs attestations but does NOT need ETH (user pays gas).
 */

import { EAS, SchemaEncoder, NO_EXPIRATION } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";
import { EAS_CONFIG } from "./config";
import { ReputationProfile } from "@/lib/types";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DelegatedAttestationPayload {
  /** EAS contract address on Sepolia */
  easContractAddress: string;
  /** Schema UID */
  schemaUID: string;
  /** Recipient wallet address */
  recipient: string;
  /** ABI-encoded attestation data */
  encodedData: string;
  /** EIP-712 signature from the server attester */
  signature: { r: string; s: string; v: number };
  /** Server attester address (for on-chain verification) */
  attester: string;
  /** Deadline for the delegated signature (0 = no expiry) */
  deadline: bigint;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAttesterSigner(): ethers.Wallet {
  const privateKey = process.env.ATTESTER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "ATTESTER_PRIVATE_KEY is not set. Add it to .env.local to enable EAS attestations."
    );
  }
  const provider = new ethers.JsonRpcProvider(
    `https://eth-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? ""}`
  );
  return new ethers.Wallet(privateKey, provider);
}

function encodeAttestationData(profile: ReputationProfile): string {
  const { schemaString } = EAS_CONFIG.sepolia;
  const encoder = new SchemaEncoder(schemaString);

  return encoder.encodeData([
    { name: "score",                  value: BigInt(profile.score),                          type: "uint256" },
    { name: "contractCount",          value: BigInt(profile.summary.contractCount),           type: "uint256" },
    { name: "verifiedContractCount",  value: BigInt(profile.summary.verifiedContractCount),   type: "uint256" },
    { name: "hasENS",                 value: profile.summary.hasENS,                          type: "bool"    },
    { name: "tier",                   value: profile.summary.tier,                            type: "string"  },
    { name: "analyzedAt",             value: BigInt(Math.floor(Date.now() / 1000)),            type: "uint256" },
  ]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a delegated EAS attestation signed by the server attester.
 * Returns the signed payload for the client to submit on-chain.
 */
export async function createDelegatedAttestation(
  recipient: string,
  profile: ReputationProfile
): Promise<DelegatedAttestationPayload> {
  const { easContractAddress, schemaUID } = EAS_CONFIG.sepolia;

  if (!schemaUID) {
    throw new Error(
      "EAS schema UID not configured. Run scripts/registerSchema.ts and set NEXT_PUBLIC_EAS_SCHEMA_UID."
    );
  }

  const signer = getAttesterSigner();
  const eas = new EAS(easContractAddress);
  eas.connect(signer);

  const encodedData = encodeAttestationData(profile);
  const delegated = await eas.getDelegated();

  logger.info("[eas] Signing delegated attestation", { recipient, score: profile.score });

  const response = await delegated.signDelegatedAttestation(
    {
      schema: schemaUID,
      recipient,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      refUID: ethers.ZeroHash,
      data: encodedData,
      deadline: NO_EXPIRATION,
      value: 0n,
    },
    signer
  );

  logger.info("[eas] Delegated attestation signed", { recipient });

  return {
    easContractAddress,
    schemaUID,
    recipient,
    encodedData,
    signature: {
      r: response.signature.r,
      s: response.signature.s,
      v: response.signature.v,
    },
    attester: await signer.getAddress(),
    deadline: NO_EXPIRATION,
  };
}
