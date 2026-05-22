/**
 * /api/eagleview/order
 *
 * GET ?dealId=…  → Return latest EagleViewOrder row for the deal (or null).
 * POST { dealId, ticketId?, force? } → Manually order a TrueDesign for a deal or ticket.
 *   - If only ticketId is provided, resolves the associated deal via HubSpot associations.
 *   - Falls back to synthetic `ticket:<id>` dealId when no deal association exists.
 *
 * Auth: session via requireApiAuth.
 * `force: true` requires OPS_MANAGER+ role per cost-control policy.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { orderTrueDesign } from "@/lib/eagleview-pipeline";
import { defaultPipelineDeps } from "@/lib/eagleview-pipeline-deps";

const FORCE_REQUIRED_ROLES = new Set([
  "ADMIN",
  "EXECUTIVE",
  "OWNER",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
]);

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const dealId = request.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }

  const order = await prisma.eagleViewOrder.findFirst({
    where: { dealId, productCode: "TDP" },
    orderBy: { orderedAt: "desc" },
  });
  return NextResponse.json({ order });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { dealId?: string; ticketId?: string; force?: boolean };
  try {
    body = (await request.json()) as { dealId?: string; ticketId?: string; force?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let dealId = (body.dealId ?? "").toString().trim();
  const ticketId = (body.ticketId ?? "").toString().trim() || undefined;

  // If only ticketId provided, resolve the associated deal
  if (!dealId && ticketId) {
    try {
      const batchResponse = await hubspotClient.crm.associations.batchApi.read(
        "tickets",
        "deals",
        { inputs: [{ id: ticketId }] },
      );
      const firstResult = batchResponse?.results?.[0];
      const firstDeal = firstResult?.to?.[0];
      if (firstDeal) {
        dealId = String(firstDeal.id);
      } else {
        // No associated deal — use synthetic dealId for dedup
        dealId = `ticket:${ticketId}`;
      }
    } catch {
      // Association lookup failed — use synthetic key
      dealId = `ticket:${ticketId}`;
    }
  }

  if (!dealId) {
    return NextResponse.json({ error: "dealId or ticketId required" }, { status: 400 });
  }

  const userRoles: string[] = Array.isArray(auth.roles) ? (auth.roles as string[]) : [];
  if (body.force === true) {
    const allowed = userRoles.some((r) => FORCE_REQUIRED_ROLES.has(r));
    if (!allowed) {
      return NextResponse.json(
        { error: "force=true requires OPS_MANAGER or higher" },
        { status: 403 },
      );
    }
    // Force flag wipes any existing same-key row so a new order can claim it.
    // Caller is on the hook for the duplicate-order $$.
    await prisma.eagleViewOrder.deleteMany({
      where: { dealId, productCode: "TDP" },
    });
  }

  try {
    const result = await orderTrueDesign(defaultPipelineDeps(), {
      dealId,
      triggeredBy: auth.email ?? "manual",
    });

    // If ticketId provided, link it to the order row
    if (ticketId && result.orderId) {
      await prisma.eagleViewOrder.update({
        where: { id: result.orderId },
        data: { ticketId },
      }).catch(() => { /* best-effort */ });
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
