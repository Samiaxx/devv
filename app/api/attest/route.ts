/**
 * POST /api/attest
 *
 * Signs a delegated EAS attestation for a wallet's reputation profile.
 * The server signs; the client submits on-chain (user pays gas).
 *
 * Body: {
 *   address: string          — wallet to attest
 *   profile: ReputationProfile
 * }
 *
 * Response: DelegatedAttestationPayload (signature + encoded data)
 */

import { NextRequest, NextResponse } from "next/server";
import { createDelegatedAttestation } from "@/lib/eas/attestationService";
import { handleApiError } from "@/lib/errors/errorHandler";
import { AppError } from "@/lib/errors/AppError";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { address, profile } = body as { address?: unknown; profile?: unknown };

    if (
      typeof address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(address)
    ) {
      throw AppError.invalidAddress("address must be a valid Ethereum address");
    }

    if (!profile || typeof profile !== "object") {
      throw AppError.invalidRequest("profile is required");
    }

    const payload = await createDelegatedAttestation(
      address.toLowerCase(),
      profile as Parameters<typeof createDelegatedAttestation>[1]
    );

    return NextResponse.json(payload);
  } catch (err) {
    return handleApiError(err);
  }
}
