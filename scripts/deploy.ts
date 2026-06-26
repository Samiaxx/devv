/**
 * Deploy ProofOfDev contract to Sepolia.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *
 * Required env vars (in .env.local):
 *   DEPLOYER_PRIVATE_KEY       - private key of the deployer wallet (needs Sepolia ETH)
 *   NEXT_PUBLIC_ALCHEMY_API_KEY - Alchemy API key for Sepolia RPC
 *
 * After deployment, add the contract address to .env.local:
 *   NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.error("No Sepolia ETH. Get some from https://sepoliafaucet.com");
    process.exit(1);
  }

  // Base URI for token metadata — update for production
  const baseURI = "https://your-app-domain.com/api/token";

  console.log("Deploying ProofOfDev...");
  const ProofOfDev = await ethers.getContractFactory("ProofOfDev");
  const contract = await ProofOfDev.deploy(baseURI);
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
