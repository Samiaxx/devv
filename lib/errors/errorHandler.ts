/**
 * Centralized error handler for API routes.
 * Converts any thrown value into a safe, typed NextResponse.
 */

import { NextResponse } from "next/server";
import { AppError } from "./AppError";
import { ErrorCode, ERROR_MESSAGES } from "./errorCodes";
import { logger } from "@/lib/logger";

export interface ApiErrorResponse {
  error: string;
  code: ErrorCode;
}

/**
 * Converts any thrown value into a structured JSON error response.
 * Raw error messages from external APIs are never forwarded to the client.
 */
export function handleApiError(err: unknown): NextResponse<ApiErrorResponse> {
  if (err instanceof AppError) {
    logger.error(`[AppError] ${err.code}`, err.message);
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.statusCode }
    );
  }

  // Detect rate-limit signals from external APIs
  if (err instanceof Error && /rate.?limit|429/i.test(err.message)) {
    logger.warn("[RateLimit] External API rate limit hit");
    return NextResponse.json(
      { error: ERROR_MESSAGES.RATE_LIMIT, code: "RATE_LIMIT" as ErrorCode },
      { status: 429 }
    );
  }

  // Detect network/fetch errors
  if (err instanceof TypeError && err.message.includes("fetch")) {
    logger.error("[NetworkError]", err.message);
    return NextResponse.json(
      { error: ERROR_MESSAGES.NETWORK_ERROR, code: "NETWORK_ERROR" as ErrorCode },
      { status: 502 }
    );
  }

  // Unknown error — log internally, return generic message
  logger.error("[UnhandledError]", err instanceof Error ? err.message : String(err));
  return NextResponse.json(
    { error: ERROR_MESSAGES.INTERNAL_ERROR, code: "INTERNAL_ERROR" as ErrorCode },
    { status: 500 }
  );
}
