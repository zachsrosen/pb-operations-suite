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
  const q = url.searchParams.get("q") ?? "";
  const dateFrom = url.searchParams.get("from") ?? undefined;
  const dateTo = url.searchParams.get("to") ?? undefined;
  const skip = parseInt(url.searchParams.get("skip") ?? "0");

  // Require at least a text query (2+ chars) OR a date range
  if (q.length < 2 && !dateFrom && !dateTo) {
    return NextResponse.json({ items: [], total: 0, hasMore: false });
  }

  const result = await searchMeetingItems({ query: q.length >= 2 ? q : "", dateFrom, dateTo, skip });
  return NextResponse.json(result);
}
