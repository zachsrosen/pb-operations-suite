import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/scorecard-warm
 *
 * Cache warmer for /api/ops-scorecard (schedule in vercel.json, every 25
 * minutes against the 30-minute cache TTL). A cold refresh takes ~45-60s of
 * HubSpot fetches — Matt sat through an 80-second skeleton on 7/21. Same
 * pattern as office-performance-warm: self-fetch through Vercel's load
 * balancer with API_SECRET_TOKEN (route allowed via
 * MACHINE_TOKEN_ALLOWED_ROUTES) so the same lambda pool that serves real
 * traffic gets the warm in-memory cache. CRON_SECRET validated here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.API_SECRET_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "API_SECRET_TOKEN not configured" }, { status: 500 });
  }
  const baseUrl =
    process.env.VERCEL_ENV === "production"
      ? "https://www.pbtechops.com"
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/ops-scorecard`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      console.error(`[scorecard-warm] warm fetch failed: ${res.status} in ${ms}ms`);
      return NextResponse.json({ ok: false, status: res.status, ms }, { status: 502 });
    }
    const body = (await res.json()) as { cached?: boolean };
    if (ms > 5000) {
      console.warn(`[scorecard-warm] recomputed cold cache in ${ms}ms (cached=${body.cached})`);
    }
    return NextResponse.json({ ok: true, ms, cached: body.cached ?? null });
  } catch (err) {
    console.error("[scorecard-warm] failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
