import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchPrimaryContactIdForObject } from "@/lib/hubspot";

/**
 * GET /api/deals/[dealId]/primary-contact?type=deal|ticket
 * Returns the primary associated contact id for a deal or ticket.
 * Defaults to deal for backwards compatibility.
 * The route is under /deals/ for historical reasons but accepts ticket ids too.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;
  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const type = request.nextUrl.searchParams.get("type") === "ticket" ? "tickets" : "deals";
  const contactId = await fetchPrimaryContactIdForObject(type, dealId);
  return NextResponse.json({ contactId });
}
