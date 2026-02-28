/**
 * BOM Create SO API
 *
 * POST /api/bom/create-so
 *   Creates a draft Zoho Sales Order from a saved BOM snapshot.
 *   Body: { dealId, version, customerId }
 *   Returns: { salesorder_id, salesorder_number, unmatchedCount, ... }
 *
 * Core logic lives in src/lib/bom-so-create.ts (shared with pipeline).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createSalesOrder } from "@/lib/bom-so-create";
import type { ActorContext } from "@/lib/actor-context";

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
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { dealId?: string; version?: number; customerId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, customerId } = body;
  if (!dealId || typeof version !== "number" || !customerId) {
    return NextResponse.json(
      { error: "dealId, version, and customerId are required" },
      { status: 400 }
    );
  }

  const enablePostProcess = process.env.ENABLE_SO_POST_PROCESS === "true";
  const wantDebug = enablePostProcess && /^\s*true\s*$/i.test(request.headers.get("X-BOM-Debug") ?? "");

  const actor: ActorContext = {
    email: authResult.email,
    name: authResult.name,
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/create-so",
    requestMethod: "POST",
  };

  try {
    const result = await createSalesOrder({
      dealId,
      version,
      customerId,
      actor,
      debug: wantDebug,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";

    // Distinguish Zoho errors (502) from other errors (500)
    const status = message.includes("Zoho API error") ? 502
      : message.includes("not found") ? 404
      : message.includes("not configured") ? 503
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
