import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { buildPeReworkPayload, type PeReworkPayload } from "@/lib/pe-rework";

// Reads three PE tables and runs pure aggregation — well under the default
// duration, but bumped for safety on cold cache with the full version set.
export const maxDuration = 60;
const REWORK_TTL_MS = 15 * 60 * 1000;

async function buildPayload(): Promise<PeReworkPayload> {
  const [versions, actionItems, reviews] = await Promise.all([
    prisma.peDocVersion.findMany({
      select: { peProjectId: true, dealId: true, docName: true, version: true, uploadedBy: true, uploadedAt: true },
    }),
    prisma.peActionItem.findMany({
      select: { peProjectId: true, docLabel: true, notes: true, actionDate: true },
    }),
    prisma.peDocumentReview.findMany({
      select: { dealId: true, docName: true, status: true },
    }),
  ]);
  return buildPeReworkPayload(versions, actionItems, reviews);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.PE_REWORK,
      buildPayload,
      false,
      { ttl: REWORK_TTL_MS },
    );
    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[pe-rework] failed:", error);
    return NextResponse.json({ error: "Failed to build PE rework analytics" }, { status: 502 });
  }
}
