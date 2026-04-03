import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole, searchMeetingItems } from "@/lib/idr-meeting";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const dateFrom = url.searchParams.get("from") ?? undefined;
  const dateTo = url.searchParams.get("to") ?? undefined;
  const skip = parseInt(url.searchParams.get("skip") ?? "0");

  if (query.length < 2) {
    return NextResponse.json({ items: [], total: 0, hasMore: false });
  }

  const result = await searchMeetingItems({ query, dateFrom, dateTo, skip });
  return NextResponse.json(result);
}
