/**
 * Central config for the worker server — reads from root .env.local
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

export const MONGO_URI     = process.env.MONGO_URI      ?? "mongodb://localhost:27017";
export const MONGO_DB      = process.env.MONGO_DB       ?? "proof_of_dev";
export const ALCHEMY_KEY   = process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";
export const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY ?? "";
export const QUEUE_HOST    = process.env.QUEUE_HOST ?? "127.0.0.1";
export const QUEUE_PORT    = parseInt(
  process.env.QUEUE_PORT ?? process.env.AXJET_PORT ?? "5000",
  10,
);
export const QUEUE_ENDPOINT = process.env.QUEUE_ENDPOINT ?? `tcp://${QUEUE_HOST}:${QUEUE_PORT}`;

// ─── Chain registry ───────────────────────────────────────────────────────────

export const CHAIN_RPC_URLS = {
  1:        `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  11155111: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  137:      `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  42161:    `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  10:       `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
  8453:     `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
};

export const CHAIN_NAMES = {
  1:        "mainnet",
  11155111: "sepolia",
  137:      "polygon",
  42161:    "arbitrum",
  10:       "optimism",
  8453:     "base",
};

export const ETHERSCAN_URLS = {
  1:        "https://api.etherscan.io/api",
  11155111: "https://api-sepolia.etherscan.io/api",
};

/**
 * Convert a network name string to its chain ID.
 * @param {string} network
 * @returns {number}
 */
export function chainIdFromNetwork(network) {
  const entry = Object.entries(CHAIN_NAMES).find(([, name]) => name === network.toLowerCase());
  if (!entry) throw new Error(`Unknown network name: "${network}"`);
  return Number(entry[0]);
}
