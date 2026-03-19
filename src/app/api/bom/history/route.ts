/**
 * BOM History API
 *
 * GET  /api/bom/history?dealId=xxx
 *   Returns all snapshots for a deal, newest-first, with full bomData.
 *
 * POST /api/bom/history
 *   Saves a new snapshot for a deal, auto-incrementing version.
 *   Also syncs inventory SKUs via the same logic as /api/bom/save.
 *   Body: { dealId, dealName, bomData, sourceFile?, blobUrl? }
 *   Returns: { id, version, createdAt }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { saveBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import type { ActorContext } from "@/lib/actor-context";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER",
  "PROJECT_MANAGER", "DESIGNER", "PERMITTING",
]);

/* ---- GET ---- */
export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "dealId is required" }, { status: 400 });

  const snapshots = await prisma.projectBomSnapshot.findMany({
    where: { dealId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      dealId: true,
      dealName: true,
      version: true,
      bomData: true,
      sourceFile: true,
      blobUrl: true,
      savedBy: true,
      createdAt: true,
      zohoPurchaseOrders: true,
      zohoSoId: true,
    },
  });

  return NextResponse.json({ snapshots });
}

/* ---- POST ---- */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role, email, name, ip, userAgent } = authResult;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { dealId: string; dealName: string; bomData: BomData; sourceFile?: string; blobUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const actor: ActorContext = {
    email,
    name,
    ipAddress: ip,
    userAgent,
    requestPath: "/api/bom/history",
    requestMethod: "POST",
  };

  try {
    const result = await saveBomSnapshot({
      dealId: body.dealId,
      dealName: body.dealName,
      bomData: body.bomData,
      sourceFile: body.sourceFile,
      blobUrl: body.blobUrl,
      actor,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save BOM snapshot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
