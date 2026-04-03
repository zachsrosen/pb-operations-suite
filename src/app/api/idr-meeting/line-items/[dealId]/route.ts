import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { fetchLineItemsForDeal } from "@/lib/hubspot";

/**
 * GET /api/idr-meeting/line-items/[dealId]
 *
 * Fetches HubSpot line items for a deal. Used by the detail panel
 * to show equipment from the BOM instead of the snapshot summary.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const lineItems = await fetchLineItemsForDeal(dealId);

  return NextResponse.json({ lineItems });
}
