/**
 * Service BOM History — All Snapshots (deals + tickets merged)
 *
 * GET /api/bom/service-history/all
 *   Returns BOM snapshots from both service-pipeline deals (ProjectBomSnapshot
 *   where dealName starts with "SVC |") and tickets (TicketBomSnapshot),
 *   merged newest-first.
 *
 * Query params:
 *   limit  — page size (default 200, max 500)
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

  const select = {
    id: true,
    version: true,
    sourceFile: true,
    savedBy: true,
    createdAt: true,
    bomData: true,
  } as const;

  const [dealRows, ticketRows] = await Promise.all([
    prisma.projectBomSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      where: { dealName: { startsWith: "SVC |" } },
      select: { ...select, dealId: true, dealName: true },
    }),
    prisma.ticketBomSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { ...select, ticketId: true, ticketSubject: true },
    }),
  ]);

  const mapped = [
    ...dealRows.map((s) => {
      const bom = s.bomData as BomData | null;
      return {
        id: s.id,
        dealId: s.dealId,
        dealName: s.dealName,
        version: s.version,
        sourceFile: s.sourceFile,
        savedBy: s.savedBy,
        createdAt: s.createdAt,
        customer: bom?.project?.customer ?? null,
        address: bom?.project?.address ?? null,
        systemSizeKwdc: bom?.project?.systemSizeKwdc ?? null,
        moduleCount: bom?.project?.moduleCount ?? null,
        itemCount: bom?.items?.length ?? 0,
        kind: "deal" as const,
      };
    }),
    ...ticketRows.map((s) => {
      const bom = s.bomData as BomData | null;
      return {
        id: s.id,
        dealId: s.ticketId,
        dealName: s.ticketSubject,
        version: s.version,
        sourceFile: s.sourceFile,
        savedBy: s.savedBy,
        createdAt: s.createdAt,
        customer: bom?.project?.customer ?? null,
        address: bom?.project?.address ?? null,
        systemSizeKwdc: bom?.project?.systemSizeKwdc ?? null,
        moduleCount: bom?.project?.moduleCount ?? null,
        itemCount: bom?.items?.length ?? 0,
        kind: "ticket" as const,
      };
    }),
  ];

  mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const snapshots = mapped.slice(0, limit);

  return NextResponse.json({ snapshots, hasMore: mapped.length > limit, nextCursor: null });
}
