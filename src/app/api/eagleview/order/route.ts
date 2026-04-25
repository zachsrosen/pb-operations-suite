/**
 * /api/eagleview/order
 *
 * GET ?dealId=…  → Return latest EagleViewOrder row for the deal (or null).
 * POST { dealId, force? } → Manually order a TrueDesign for the deal.
 *
 * Auth: session via requireApiAuth.
 * `force: true` requires OPS_MANAGER+ role per cost-control policy.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
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

  let body: { dealId?: string; force?: boolean };
  try {
    body = (await request.json()) as { dealId?: string; force?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const dealId = (body.dealId ?? "").toString().trim();
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
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
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
