/**
 * BOM History - All Snapshots
 *
 * GET /api/bom/history/all
 *   Returns the 100 most recent BOM snapshots across all projects,
 *   newest-first, with a summary extracted from bomData (no full bomData).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

interface BomData {
  project?: {
    customer?: string;
    address?: string;
    systemSizeKwdc?: number | string;
    moduleCount?: number | string;
  };
  items?: unknown[];
}

export async function GET() {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const raw = await prisma.projectBomSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      dealId: true,
      dealName: true,
      version: true,
      sourceFile: true,
      savedBy: true,
      createdAt: true,
      bomData: true,
    },
  });

  const snapshots = raw.map((s) => {
    const bom = s.bomData as BomData | null;
    return {
      id: s.id,
      dealId: s.dealId,
      dealName: s.dealName,
      version: s.version,
      sourceFile: s.sourceFile,
      savedBy: s.savedBy,
      createdAt: s.createdAt,
      // Summary fields extracted from bomData
      customer: bom?.project?.customer ?? null,
      address: bom?.project?.address ?? null,
      systemSizeKwdc: bom?.project?.systemSizeKwdc ?? null,
      moduleCount: bom?.project?.moduleCount ?? null,
      itemCount: bom?.items?.length ?? 0,
    };
  });

  return NextResponse.json({ snapshots });
}
