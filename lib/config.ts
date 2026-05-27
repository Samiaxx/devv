/**
 * Application configuration.
 * All API URLs, feature flags, and environment-driven settings live here.
 * Import from this file instead of reading process.env directly in services.
 */

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const config = {
  alchemy: {
    apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "",
    mainnetUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? ""}`,
    sepoliaUrl: `https://eth-sepolia.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? ""}`,
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    mainnetUrl: "https://api.etherscan.io/api",
    sepoliaUrl: "https://api-sepolia.etherscan.io/api",
  },

  walletConnect: {
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo",
  },

  contract: {
    address:
      process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
      "0x0000000000000000000000000000000000000000",
  },

  // ─── Feature flags ──────────────────────────────────────────────────────────
  features: {
    /** Allow users to include ENS data in their analysis */
    enableENS: true,
    /** Allow NFT minting on Sepolia */
    enableMinting: true,
    /** Show the download report button */
    enableReportDownload: true,
  },

  // ─── Limits ─────────────────────────────────────────────────────────────────
  limits: {
    /** Max contracts fetched from Alchemy per request */
    maxAlchemyTransfers: 1000,
    /** Etherscan batch size for verification checks */
    etherscanBatchSize: 5,
    /** Delay between Etherscan batches (ms) */
    etherscanBatchDelayMs: 250,
  },
} as const;

/** Returns the correct Alchemy URL for a given network */
export function alchemyUrl(network: "mainnet" | "sepolia"): string {
  return network === "sepolia" ? config.alchemy.sepoliaUrl : config.alchemy.mainnetUrl;
}

/** Returns the correct Etherscan base URL for a given network */
export function etherscanUrl(network: "mainnet" | "sepolia"): string {
  return network === "sepolia" ? config.etherscan.sepoliaUrl : config.etherscan.mainnetUrl;
}
