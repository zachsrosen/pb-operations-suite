import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchRtbQueue } from "@/lib/rtb-review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const items = await fetchRtbQueue();
  return NextResponse.json({ items, lastUpdated: new Date().toISOString() });
}
