/**
 * Ticket BOM — Create SO (Service Suite)
 *
 * POST /api/bom/ticket-create-so
 *   Creates a draft Zoho Sales Order from a saved Ticket BOM snapshot.
 *   Body: { ticketId, version, customerId, pbLocation? }
 *   Returns: { salesorder_id, salesorder_number, unmatchedCount, ... }
 *
 * Mirrors /api/bom/create-so but reads from TicketBomSnapshot and tags the
 * SO with the HubSpot ticket record id.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createTicketSalesOrder } from "@/lib/bom-so-create";
import { logActivity } from "@/lib/db";
import type { ActorContext } from "@/lib/actor-context";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "SERVICE",
  "DESIGNER",
  "TECH_OPS",
]);

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { ticketId?: string; version?: number; customerId?: string; pbLocation?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ticketId, version, customerId, pbLocation } = body;
  if (!ticketId || typeof version !== "number" || !customerId) {
    return NextResponse.json(
      { error: "ticketId, version, and customerId are required" },
      { status: 400 },
    );
  }

  const enablePostProcess = process.env.ENABLE_SO_POST_PROCESS === "true";
  const wantDebug = enablePostProcess && /^\s*true\s*$/i.test(request.headers.get("X-BOM-Debug") ?? "");

  const actor: ActorContext = {
    email: authResult.email,
    name: authResult.name,
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/ticket-create-so",
    requestMethod: "POST",
  };

  try {
    const result = await createTicketSalesOrder({
      ticketId,
      version,
      customerId,
      actor,
      debug: wantDebug,
      pbLocation,
    });

    await logActivity({
      type: "BOM_PIPELINE_COMPLETED",
      description: `Created SO ${result.salesorder_number || "draft"} for ticket ${ticketId} v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "sales_order",
      entityId: result.salesorder_id,
      entityName: result.salesorder_number || ticketId,
      metadata: { ticketId, version, customerId, soNumber: result.salesorder_number, unmatchedCount: result.unmatchedCount },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/ticket-create-so",
      requestMethod: "POST",
    }).catch(() => {});

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";

    await logActivity({
      type: "API_ERROR",
      description: `Ticket SO creation failed for ticket ${ticketId}: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "sales_order",
      entityName: ticketId,
      metadata: { ticketId, version, customerId, error: message },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/ticket-create-so",
      requestMethod: "POST",
    }).catch(() => {});

    const status = message.includes("Zoho API error") ? 502
      : message.includes("not found") ? 404
      : message.includes("not configured") ? 503
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
