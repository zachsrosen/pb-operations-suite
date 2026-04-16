import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchPrimaryContactId } from "@/lib/hubspot";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { dealId } = await params;
  if (!/^\d+$/.test(dealId)) {
    return NextResponse.json({ error: "Invalid deal ID" }, { status: 400 });
  }

  const contactId = await fetchPrimaryContactId(dealId);
  return NextResponse.json({ contactId });
}
