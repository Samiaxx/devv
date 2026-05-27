/**
 * POST /api/analyze
 *
 * Thin route handler — pushes the job onto the ZeroMQ queue and awaits
 * the result from the background worker. All pipeline logic lives in
 * analyzeController.ts.
 *
 * Body: {
 *   address: string,
 *   network?: "mainnet" | "sepolia",
 *   includeENS?: boolean
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { enqueueAnalysis } from "@/lib/api/analyzeController";
import { handleApiError } from "@/lib/errors/errorHandler";

// Force Node.js runtime — zeromq native addon requires it (not compatible with Edge)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await enqueueAnalysis(body);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
