import { NextRequest, NextResponse } from "next/server";
import { fetchContactEmail } from "@/lib/hubspot";

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId required" }, { status: 400 });
  }

  const contact = await fetchContactEmail(dealId);
  if (!contact) {
    return NextResponse.json({ email: null, name: null });
  }

  return NextResponse.json(contact);
}
