/**
 * Deploy ProofOfDev contract to Sepolia.
 *
 * Usage:
 *   npx ts-node scripts/deploy.ts
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY  - private key of the deployer wallet (with Sepolia ETH)
 *   NEXT_PUBLIC_ALCHEMY_API_KEY - Alchemy API key for Sepolia RPC
 *
 * After deployment, copy the contract address into .env.local:
 *   NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

  if (!privateKey || !alchemyKey) {
    console.error(
      "Missing DEPLOYER_PRIVATE_KEY or NEXT_PUBLIC_ALCHEMY_API_KEY"
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(
    `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`
  );

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log("Deploying from:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance === BigInt(0)) {
    console.error("No Sepolia ETH. Get some from https://sepoliafaucet.com");
    process.exit(1);
  }

  // Read compiled artifact (compile with: npx solc --abi --bin contracts/ProofOfDev.sol)
  const artifactPath = path.join(__dirname, "../artifacts/ProofOfDev.json");

  if (!fs.existsSync(artifactPath)) {
    console.error(
      "Artifact not found. Compile the contract first:\n" +
        "  npx solc --abi --bin --output-dir artifacts contracts/ProofOfDev.sol\n" +
        "  Then combine into artifacts/ProofOfDev.json: { abi: [...], bytecode: '0x...' }"
    );
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );

  // Base URI points to our Next.js API for token metadata
  const baseURI = "https://your-app-domain.com/api/token";

  console.log("Deploying ProofOfDev...");
  const contract = await factory.deploy(baseURI);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ ProofOfDev deployed to:", address);
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
