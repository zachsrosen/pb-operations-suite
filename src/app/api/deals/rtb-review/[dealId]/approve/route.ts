import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { updateDealProperty } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const { dealId } = await params;
  const ok = await updateDealProperty(dealId, { pm_rtb_approved: "true" });
  if (!ok) {
    return NextResponse.json({ error: "HubSpot update failed" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
