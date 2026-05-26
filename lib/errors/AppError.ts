/**
 * AppError — typed application error class.
 * Use this instead of raw Error objects so every error has a code and
 * HTTP status, and raw API messages never leak to the frontend.
 */

import { ErrorCode, ERROR_MESSAGES } from "./errorCodes";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, detail?: string, statusCode = 500) {
    // Public message uses the safe, user-facing string from ERROR_MESSAGES
    super(ERROR_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;

    // Attach internal detail for server-side logging only
    if (detail) {
      Object.defineProperty(this, "detail", {
        value: detail,
        enumerable: false, // won't appear in JSON.stringify
      });
    }
  }

  /** Convenience factory methods */
  static invalidAddress(detail?: string) {
    return new AppError("INVALID_ADDRESS", detail, 400);
  }

  static invalidRequest(detail?: string) {
    return new AppError("INVALID_REQUEST", detail, 400);
  }

  static networkError(detail?: string) {
    return new AppError("NETWORK_ERROR", detail, 502);
  }

  static rateLimit(detail?: string) {
    return new AppError("RATE_LIMIT", detail, 429);
  }

  static partialData(detail?: string) {
    return new AppError("PARTIAL_DATA", detail, 206);
  }

  static internal(detail?: string) {
    return new AppError("INTERNAL_ERROR", detail, 500);
  }
}
