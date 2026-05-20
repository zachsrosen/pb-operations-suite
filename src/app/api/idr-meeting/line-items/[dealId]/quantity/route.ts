import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { updateLineItemQuantity } from "@/lib/hubspot";

/**
 * PATCH /api/idr-meeting/line-items/[dealId]/quantity
 *
 * Updates a line item's quantity. Used by the module count +/- buttons.
 * Body: { lineItemId: string, quantity: number }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // dealId is available for context/logging but not strictly needed for the PATCH
  await params;

  const body = await req.json().catch(() => ({})) as {
    lineItemId?: string;
    quantity?: number;
  };

  const { lineItemId, quantity } = body;
  if (!lineItemId) {
    return NextResponse.json({ error: "lineItemId is required" }, { status: 400 });
  }
  if (!quantity || !Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
  }

  await updateLineItemQuantity(lineItemId, quantity);
  return NextResponse.json({ success: true, quantity });
}
