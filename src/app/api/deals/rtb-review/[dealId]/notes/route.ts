import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { updateDealProperty } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

/**
 * Update a deal's RTB - Blocked Reason (`rtb_blocked_reason`) from the RTB
 * Review Queue. Empty string clears the note.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const { dealId } = await params;
  const body = await request.json().catch(() => null);
  const notes = body?.notes;
  if (typeof notes !== "string") {
    return NextResponse.json(
      { error: "notes must be a string" },
      { status: 400 }
    );
  }

  const ok = await updateDealProperty(dealId, { rtb_blocked_reason: notes });
  if (!ok) {
    return NextResponse.json({ error: "HubSpot update failed" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
