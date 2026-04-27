import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { setShitShowFlag } from "@/lib/shit-show/hubspot-flag";

/**
 * POST /api/shit-show-meeting/flag
 *
 * Body: { dealId: string, flagged: boolean, reason?: string }
 *
 * Canonical write to pb_shit_show_flagged + pb_shit_show_reason +
 * pb_shit_show_flagged_since on the HubSpot deal.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json()) as {
    dealId?: string;
    flagged?: boolean;
    reason?: string;
  };
  if (!body.dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }
  await setShitShowFlag(body.dealId, !!body.flagged, body.reason);
  return NextResponse.json({ ok: true });
}
