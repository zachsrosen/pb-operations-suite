/**
 * Cache-warming cron for office performance dashboards.
 *
 * Problem: office TV pages hit /api/office-performance/[location] which takes
 * 70-90s on cold cache (HubSpot search + batch read + Zuper + compliance).
 * Vercel serverless lambdas don't share in-memory cache across instances.
 * If the lambda container recycles, the next request starts cold.
 *
 * Solution: this cron self-fetches each per-location endpoint via HTTP every
 * 4 minutes, keeping the API lambda's in-memory cache warm. The fetch goes
 * through Vercel's load balancer → same lambda pool as real traffic, so the
 * warmed container serves subsequent TV requests with cache hits.
 *
 * Uses API_SECRET_TOKEN bearer auth (allowed via MACHINE_TOKEN_ALLOWED_ROUTES).
 */

import { NextRequest, NextResponse } from "next/server";
import { DASHBOARD_LOCATION_GROUPS } from "@/lib/dashboard-location-groups";

export const maxDuration = 300;

const LOCATION_SLUGS = DASHBOARD_LOCATION_GROUPS.map((g) => g.slug);

function getBaseUrl(): string {
  // Production: use the canonical domain
  // Preview/dev: use Vercel's auto-generated URL
  if (process.env.VERCEL_ENV === "production") {
    return "https://www.pbtechops.com";
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = getBaseUrl();
  const token = process.env.API_SECRET_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "API_SECRET_TOKEN not configured" },
      { status: 500 }
    );
  }

  const results: Array<{
    slug: string;
    status: number | "error";
    durationMs: number;
    cached?: boolean;
  }> = [];

  // Warm each location sequentially to avoid HubSpot/Zuper rate-limit storms.
  // Sequential is ~5 × 1-2s (cache hit) or ~5 × 70-90s (all cold), but the
  // cron runs frequently enough that most invocations hit warm cache.
  for (const slug of LOCATION_SLUGS) {
    const start = Date.now();
    try {
      const res = await fetch(
        `${baseUrl}/api/office-performance/${slug}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          // Bypass Next.js fetch cache — we want the API handler to run
          cache: "no-store",
        }
      );
      const body = await res.json().catch(() => null);
      results.push({
        slug,
        status: res.status,
        durationMs: Date.now() - start,
        cached: body?.cached,
      });
    } catch (err) {
      results.push({
        slug,
        status: "error",
        durationMs: Date.now() - start,
      });
      console.error(`[office-perf-warm] Failed to warm ${slug}:`, err);
    }
  }

  // Also warm the /all aggregator — with per-location caches now warm,
  // this should be near-instant (reads from per-group cache).
  const allStart = Date.now();
  try {
    const allRes = await fetch(`${baseUrl}/api/office-performance/all`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const allBody = await allRes.json().catch(() => null);
    results.push({
      slug: "all",
      status: allRes.status,
      durationMs: Date.now() - allStart,
      cached: allBody?.cached,
    });
  } catch (err) {
    results.push({ slug: "all", status: "error", durationMs: Date.now() - allStart });
    console.error("[office-perf-warm] Failed to warm /all:", err);
  }

  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const allCached = results.every((r) => r.cached);

  console.log(
    `[office-perf-warm] Warmed ${results.length} endpoints in ${totalMs}ms` +
      (allCached ? " (all cache hits)" : "")
  );

  return NextResponse.json({ results, totalMs });
}
