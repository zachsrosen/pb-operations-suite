/**
 * BOM Push to HubSpot API
 *
 * POST /api/bom/push-to-hubspot
 *   Pushes BOM snapshot line items to a HubSpot deal.
 *   Body: { dealId, snapshotId }
 *   Returns: PushToHubSpotResult
 *
 * Core logic lives in src/lib/bom-hubspot-line-items.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { pushBomToHubSpotLineItems, DuplicatePushError } from "@/lib/bom-hubspot-line-items";
import { prisma, logActivity } from "@/lib/db";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
]);

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { dealId?: string; snapshotId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dealId = String(body.dealId || "").trim();
  const snapshotId = String(body.snapshotId || "").trim();
  if (!dealId || !snapshotId) {
    return NextResponse.json({ error: "dealId and snapshotId are required" }, { status: 400 });
  }

  try {
    const result = await pushBomToHubSpotLineItems(dealId, snapshotId, authResult.email);

    await logActivity({
      type: "BOM_PIPELINE_COMPLETED",
      description: `Pushed ${result.pushedCount} line items to HubSpot for deal ${dealId}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "deal",
      entityId: dealId,
      entityName: dealId,
      metadata: { dealId, snapshotId, pushedCount: result.pushedCount, skippedCount: result.skippedItems.length },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/push-to-hubspot",
      requestMethod: "POST",
    }).catch(() => {});

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DuplicatePushError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Internal server error";

    await logActivity({
      type: "API_ERROR",
      description: `HubSpot push failed for deal ${dealId}: ${message}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "deal",
      entityId: dealId,
      entityName: dealId,
      metadata: { dealId, snapshotId, error: message },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/push-to-hubspot",
      requestMethod: "POST",
    }).catch(() => {});

    const status = message.includes("not found") ? 404
      : message.includes("not configured") ? 503
      : message.includes("HubSpot") ? 502
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
