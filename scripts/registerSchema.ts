/**
 * Register the Proof-of-Dev EAS schema on Sepolia.
 *
 * Run once — the resulting UID is permanent. After running, copy the
 * printed UID into .env.local:
 *   NEXT_PUBLIC_EAS_SCHEMA_UID=0x...
 *
 * Usage:
 *   npx ts-node scripts/registerSchema.ts
 *
 * Required env vars:
 *   ATTESTER_PRIVATE_KEY          — wallet that pays gas for registration
 *   NEXT_PUBLIC_ALCHEMY_API_KEY   — Alchemy Sepolia RPC key
 */

import { SchemaRegistry } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";

const SCHEMA_REGISTRY_ADDRESS = "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0";

/**
 * Schema fields:
 *   score                 — total reputation score
 *   contractCount         — number of deployed contracts
 *   verifiedContractCount — number of Etherscan-verified contracts
 *   hasENS                — whether the wallet has an ENS name
 *   tier                  — human-readable tier label
 *   analyzedAt            — Unix timestamp of when the analysis ran
 */
const SCHEMA =
  "uint256 score, uint256 contractCount, uint256 verifiedContractCount, bool hasENS, string tier, uint256 analyzedAt";

async function main() {
  const privateKey = process.env.ATTESTER_PRIVATE_KEY;
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

  if (!privateKey || !alchemyKey) {
    console.error("Missing ATTESTER_PRIVATE_KEY or NEXT_PUBLIC_ALCHEMY_API_KEY");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(
    `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`
  );
  const signer = new ethers.Wallet(privateKey, provider);

  console.log("Registering schema from:", signer.address);
  console.log("Schema:", SCHEMA);

  const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
  registry.connect(signer);

  const tx = await registry.register({
    schema: SCHEMA,
    resolverAddress: ethers.ZeroAddress, // no resolver — open attestation
    revocable: true,
  });

  console.log("Waiting for confirmation…");
  const uid = await tx.wait();

  console.log("\n✅ Schema registered!");
  console.log("Schema UID:", uid);
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_EAS_SCHEMA_UID=${uid}`);
  console.log("\nView on EAS Explorer:");
  console.log(`https://sepolia.easscan.org/schema/view/${uid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
