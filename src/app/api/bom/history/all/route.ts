/**
 * BOM History - All Snapshots
 *
 * GET /api/bom/history/all
 *   Returns BOM snapshots across all projects, newest-first,
 *   with a summary extracted from bomData (no full bomData).
 *
 * Query params:
 *   limit  — page size (default 200, max 500)
 *   cursor — id of the last snapshot from the previous page
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

interface BomData {
  project?: {
    customer?: string;
    address?: string;
    systemSizeKwdc?: number | string;
    moduleCount?: number | string;
  };
  items?: unknown[];
}

export async function GET(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const url = request.nextUrl;
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT), MAX_LIMIT);
  const cursor = url.searchParams.get("cursor") || undefined;

  const raw = await prisma.projectBomSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to detect hasMore
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

  const hasMore = raw.length > limit;
  const page = hasMore ? raw.slice(0, limit) : raw;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const snapshots = page.map((s) => {
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

  return NextResponse.json({ snapshots, hasMore, nextCursor });
}
