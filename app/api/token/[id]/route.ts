/**
 * GET /api/token/[id]
 * Returns ERC-721 metadata JSON for a given token ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { METADATA_DISCLAIMER } from "@/lib/core/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = parseInt(id);

  if (isNaN(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
  }

  const metadata = {
    name: `Proof of Dev #${tokenId}`,
    description:
      "An on-chain activity profile reflecting smart contract deployment history. " +
      "This is NOT a skill certification. " + METADATA_DISCLAIMER,
    image: `https://proof-of-dev.vercel.app/api/token/${tokenId}/image`,
    // Required fields per spec
    timestamp: Math.floor(Date.now() / 1000),
    attributes: [
      { trait_type: "Token ID", value: tokenId },
      { trait_type: "Profile Type", value: "On-Chain Activity" },
      { trait_type: "Transferable", value: "No (Soulbound)" },
    ],
    disclaimer: METADATA_DISCLAIMER,
    external_url: "https://proof-of-dev.vercel.app",
  };

  return NextResponse.json(metadata, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
