/**
 * Ticket BOM History API (Service Suite)
 *
 * GET  /api/bom/ticket-history?ticketId=xxx
 *   Returns all snapshots for a ticket, newest-first, with full bomData.
 *
 * POST /api/bom/ticket-history
 *   Saves a new snapshot for a ticket, auto-incrementing version.
 *   Also syncs inventory SKUs via the same logic as the deal flow.
 *   Body: { ticketId, ticketSubject, bomData, sourceFile?, blobUrl? }
 *   Returns: { id, version, createdAt }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { saveTicketBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import type { ActorContext } from "@/lib/actor-context";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER",
  "PROJECT_MANAGER", "SERVICE", "DESIGNER", "PERMITTING", "TECH_OPS",
]);

/* ---- GET ---- */
export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const ticketId = req.nextUrl.searchParams.get("ticketId");
  if (!ticketId) return NextResponse.json({ error: "ticketId is required" }, { status: 400 });

  const snapshots = await prisma.ticketBomSnapshot.findMany({
    where: { ticketId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      ticketId: true,
      ticketSubject: true,
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

  let body: { ticketId: string; ticketSubject: string; bomData: BomData; sourceFile?: string; blobUrl?: string };
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
    requestPath: "/api/bom/ticket-history",
    requestMethod: "POST",
  };

  try {
    const result = await saveTicketBomSnapshot({
      ticketId: body.ticketId,
      ticketSubject: body.ticketSubject,
      bomData: body.bomData,
      sourceFile: body.sourceFile,
      blobUrl: body.blobUrl,
      actor,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Ticket BOM snapshot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
