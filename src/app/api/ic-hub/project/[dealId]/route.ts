import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchIcProjectDetail,
  isIcHubAllowedRole,
  isIcHubEnabled,
} from "@/lib/ic-hub";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (!isIcHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isIcHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const detail = await fetchIcProjectDetail(dealId);
  if (!detail) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
