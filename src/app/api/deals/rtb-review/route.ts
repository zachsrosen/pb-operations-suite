import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchRtbQueue, type RtbQueueStage } from "@/lib/rtb-review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const raw = request.nextUrl.searchParams.get("stage");
  const stage: RtbQueueStage = raw === "ready" ? "ready" : "blocked";
  const items = await fetchRtbQueue(stage);
  return NextResponse.json({ items, lastUpdated: new Date().toISOString() });
}
