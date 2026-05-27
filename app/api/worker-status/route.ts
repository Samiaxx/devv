/**
 * GET /api/worker-status
 * Proxies to the worker API health endpoint server-side.
 * Keeps port 8000 internal — never exposed to the browser.
 */

import { NextResponse } from "next/server";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";

export const runtime = "nodejs";
// Revalidate every 15 seconds (Next.js cache)
export const revalidate = 15;

export async function GET() {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return NextResponse.json({ status: "error" }, { status: 200 });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ status: "offline" }, { status: 200 });
  }
}
