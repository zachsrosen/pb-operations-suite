import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { resolveCustomer } from "@/lib/bom-customer-resolve";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/bom/resolve-customer
 *
 * Multi-strategy Zoho customer matching. Used by the BOM tool UI
 * to auto-resolve the customer without manual search.
 *
 * Same logic as the BOM pipeline's RESOLVE_CUSTOMER step, extracted
 * into a shared module so both callers use a single source of truth.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const body = (await req.json()) as {
    dealName?: string;
    hubspotContactId?: string;
    dealAddress?: string;
  };

  if (!body.dealName) {
    return NextResponse.json({ error: "dealName is required" }, { status: 400 });
  }

  const result = await resolveCustomer({
    dealName: body.dealName,
    primaryContactId: body.hubspotContactId || null,
    dealAddress: body.dealAddress || null,
  });

  return NextResponse.json(result);
}
