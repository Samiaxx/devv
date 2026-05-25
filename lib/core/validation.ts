/**
 * Validation layer — sanitizes all external data before it reaches scoring.
 * Every function here is pure and returns a safe, typed value.
 * Nothing downstream should ever receive undefined or malformed data.
 */

// ─── Address ─────────────────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(address: unknown): address is string {
  return typeof address === "string" && ETH_ADDRESS_RE.test(address);
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().trim();
}

// ─── Network ─────────────────────────────────────────────────────────────────

function isValidNetwork(network: unknown): network is "mainnet" | "sepolia" {
  return network === "mainnet" || network === "sepolia";
}

function safeNetwork(network: unknown): "mainnet" | "sepolia" {
  return isValidNetwork(network) ? network : "mainnet";
}

// ─── Request body ─────────────────────────────────────────────────────────────

export interface ValidatedAnalysisRequest {
  address: string;
  network: "mainnet" | "sepolia";
  includeENS: boolean;
}

/**
 * Validates and normalizes the incoming POST /api/analyze request body.
 * Throws a descriptive error if the address is missing or invalid.
 */
export function validateAnalysisRequest(body: unknown): ValidatedAnalysisRequest {
  if (!body || typeof body !== "object") {
    throw new Error("INVALID_REQUEST: Request body must be a JSON object");
  }

  const b = body as Record<string, unknown>;

  if (!isValidAddress(b.address)) {
    throw new Error("INVALID_ADDRESS: Provide a valid Ethereum address (0x...)");
  }

  return {
    address: normalizeAddress(b.address as string),
    network: safeNetwork(b.network),
    includeENS: b.includeENS === true,
  };
}
