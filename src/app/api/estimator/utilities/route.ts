import { NextResponse } from "next/server";

import { loadUtilitiesForState } from "@/lib/estimator";
import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";

export async function GET(request: Request) {
  const ipHash = hashIp(extractIp(request));
  const allowed = await checkRateLimit(rateLimitKey("utilities", ipHash), 60, 60_000);
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  const zip = searchParams.get("zip") ?? undefined;
  if (!state || state.length !== 2) {
    return NextResponse.json({ error: "state param required (2-letter)" }, { status: 400 });
  }
  const utilities = loadUtilitiesForState(state, zip).map((u) => ({
    id: u.id,
    displayName: u.label,
    kwhRate: u.kwhRate,
  }));
  return NextResponse.json({ utilities });
}
