/**
 * Typed error codes for the Proof-of-Dev API.
 * Every error that reaches the frontend must have one of these codes.
 */

export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_ADDRESS: "INVALID_ADDRESS",
  NETWORK_ERROR: "NETWORK_ERROR",
  RATE_LIMIT: "RATE_LIMIT",
  PARTIAL_DATA: "PARTIAL_DATA",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Human-readable messages for each error code */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: "Invalid request format.",
  INVALID_ADDRESS: "Please provide a valid Ethereum address.",
  NETWORK_ERROR: "Could not reach a required data source. Please try again.",
  RATE_LIMIT: "API rate limit reached. Please wait a moment and try again.",
  PARTIAL_DATA: "Some data sources were unavailable. Results may be incomplete.",
  INTERNAL_ERROR: "An unexpected error occurred. Please try again.",
};
