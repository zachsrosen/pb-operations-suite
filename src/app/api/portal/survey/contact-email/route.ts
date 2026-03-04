import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserPermissions } from "@/lib/db";
import { fetchContactEmail } from "@/lib/hubspot";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissions = await getUserPermissions(session.user.email);
  if (!permissions?.canScheduleSurveys) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

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
