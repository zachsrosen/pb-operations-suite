/**
 * GET /api/solar/shade?lat=39.739&lng=-104.985
 *
 * Google Solar API proxy — returns roof segments, panel placements,
 * and whole-roof statistics for a given location.
 *
 * Flow:
 *  1. Auth (requireSolarAuth)
 *  2. Per-user read rate limit (20 req/min — lower than mutation limiter; hits paid API)
 *  3. Validate lat/lng
 *  4. Check SolarShadeCache (keyed by latE5/lngE5 — ~1.1m precision)
 *  5. If cache hit and fresh (< 30 days) → return cached
 *  6. If miss → fetch from Google Solar API → cache → return
 *  7. If Google returns no data → return { data: null, source: 'none', fallbackReason }
 *
 * Two rate limiters:
 *  - Per-user (20 req/min): applied to authenticated requests
 *  - Per-IP (30 req/min): applied ONLY when session identity is missing/invalid
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import type { ShadeFallbackReason } from "@/lib/solar/types";

// ── Config ────────────────────────────────────────────────

const GOOGLE_SOLAR_API_KEY = process.env.GOOGLE_SOLAR_API_KEY;
const GOOGLE_SOLAR_BASE_URL =
  "https://solar.googleapis.com/v1/buildingInsights:findClosest";

/** Cache TTL: 30 days in milliseconds */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Read Rate Limiter (separate from mutation rate limiter) ──

const shadeRateLimitMap = new Map<string, number[]>();
const SHADE_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const SHADE_RATE_LIMIT_MAX_USER = 20; // 20 req/min per user
const SHADE_RATE_LIMIT_MAX_IP = 30; // 30 req/min per IP (unauthenticated only)

function checkShadeRateLimit(
  key: string,
  max: number
): NextResponse | null {
  const now = Date.now();
  const timestamps = (shadeRateLimitMap.get(key) ?? []).filter(
    (t) => now - t < SHADE_RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= max) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }
  timestamps.push(now);
  shadeRateLimitMap.set(key, timestamps);
  return null;
}

// ── Validation ────────────────────────────────────────────

/** Reject null/empty before coercion — prevents "" and null coercing to 0 */
const requiredNumericParam = z
  .preprocess(
    (val) => (val === null || val === undefined || val === "" ? undefined : val),
    z.coerce.number()
  );

const QuerySchema = z.object({
  lat: requiredNumericParam.pipe(z.number().min(-90).max(90)),
  lng: requiredNumericParam.pipe(z.number().min(-180).max(180)),
});

// ── Route Handler ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Auth — if session is invalid, apply per-IP limiter instead
  const [user, authError] = await requireSolarAuth(req);

  if (authError) {
    // Per-IP fallback limiter — only when session identity is missing/invalid
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ipLimited = checkShadeRateLimit(`ip:${ip}`, SHADE_RATE_LIMIT_MAX_IP);
    if (ipLimited) return ipLimited;

    // Still return auth error — IP limiter only prevents abuse before auth check
    return authError;
  }

  // Per-user read rate limit (20 req/min)
  const rateLimited = checkShadeRateLimit(
    `user:${user.email}`,
    SHADE_RATE_LIMIT_MAX_USER
  );
  if (rateLimited) return rateLimited;

  if (!prisma) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }

  if (!GOOGLE_SOLAR_API_KEY) {
    return NextResponse.json(
      { error: "Google Solar API key not configured" },
      { status: 503 }
    );
  }

  // Parse query params
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    lat: url.searchParams.get("lat"),
    lng: url.searchParams.get("lng"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid coordinates",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { lat, lng } = parsed.data;

  // Convert to integer keys (×100,000, rounded) for cache lookup (~1.1m precision)
  const latE5 = Math.round(lat * 100_000);
  const lngE5 = Math.round(lng * 100_000);

  // ── Check cache ─────────────────────────────────────────

  const cached = await prisma.solarShadeCache.findUnique({
    where: { latE5_lngE5: { latE5, lngE5 } },
  });

  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < CACHE_TTL_MS) {
      console.log(
        `[shade] source=cache lat=${lat} lng=${lng} latE5=${latE5} lngE5=${lngE5} user=${user.email}`
      );
      return NextResponse.json({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: cached.shadeData as any,
        source: "cache",
        latE5,
        lngE5,
        fetchedAt: cached.fetchedAt.toISOString(),
      });
    }
    // Cache expired — fall through to re-fetch
    console.log(
      `[shade] cache_expired lat=${lat} lng=${lng} age_days=${Math.round(age / 86400000)}`
    );
  }

  // ── Fetch from Google Solar API ─────────────────────────

  const googleUrl = `${GOOGLE_SOLAR_BASE_URL}?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=MEDIUM&key=${GOOGLE_SOLAR_API_KEY}`;

  let googleData: Record<string, unknown>;
  try {
    const googleResponse = await fetch(googleUrl, {
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    if (!googleResponse.ok) {
      const errText = await googleResponse.text().catch(() => "");
      const status = googleResponse.status;

      // Determine fallback reason based on Google's response
      let fallbackReason: ShadeFallbackReason = "API_ERROR";
      if (status === 404 || errText.includes("NOT_FOUND")) {
        fallbackReason = "NO_COVERAGE";
      }

      console.error(
        JSON.stringify({
          event: "shade_fallback",
          reason: fallbackReason,
          lat,
          lng,
          googleStatus: status,
          responseTime: "n/a",
          requestId: req.headers.get("x-request-id") || "none",
        })
      );

      // Do NOT cache failures
      return NextResponse.json({
        data: null,
        source: "none",
        latE5,
        lngE5,
        fallbackReason,
      });
    }

    googleData = await googleResponse.json();
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "shade_fallback",
        reason: "API_ERROR",
        lat,
        lng,
        googleStatus: "fetch_exception",
        error: err instanceof Error ? err.message : String(err),
        requestId: req.headers.get("x-request-id") || "none",
      })
    );

    return NextResponse.json({
      data: null,
      source: "none",
      latE5,
      lngE5,
      fallbackReason: "API_ERROR",
    });
  }

  // ── Check imagery quality ───────────────────────────────

  const imageryQuality = googleData.imageryQuality as string | undefined;
  if (imageryQuality === "LOW") {
    console.log(
      JSON.stringify({
        event: "shade_fallback",
        reason: "LOW_QUALITY",
        lat,
        lng,
        imageryQuality,
        requestId: req.headers.get("x-request-id") || "none",
      })
    );

    return NextResponse.json({
      data: null,
      source: "none",
      latE5,
      lngE5,
      fallbackReason: "LOW_QUALITY",
    });
  }

  // ── Extract relevant data ───────────────────────────────

  const solarPotential = googleData.solarPotential as
    | Record<string, unknown>
    | undefined;

  const shadeData = {
    roofSegments: solarPotential?.roofSegmentStats ?? [],
    solarPanels: solarPotential?.solarPanels ?? [],
    wholeRoofStats: solarPotential?.wholeRoofStats ?? {},
    maxArrayPanelsCount: solarPotential?.maxArrayPanelsCount ?? 0,
    maxSunshineHoursPerYear: solarPotential?.maxSunshineHoursPerYear ?? 0,
    imageryDate: googleData.imageryDate ?? {},
    imageryQuality: imageryQuality ?? "MEDIUM",
  };

  // ── Upsert cache ────────────────────────────────────────

  try {
    await prisma.solarShadeCache.upsert({
      where: { latE5_lngE5: { latE5, lngE5 } },
      create: {
        latE5,
        lngE5,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shadeData: shadeData as any,
        fetchedAt: new Date(),
      },
      update: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shadeData: shadeData as any,
        fetchedAt: new Date(),
      },
    });
  } catch (err) {
    // Cache write failure is non-fatal — still return data
    console.error("[shade] cache_upsert_error", err);
  }

  console.log(
    `[shade] source=google lat=${lat} lng=${lng} latE5=${latE5} lngE5=${lngE5} panels=${(solarPotential?.maxArrayPanelsCount as number) ?? 0} user=${user.email}`
  );

  return NextResponse.json({
    data: shadeData,
    source: "google" as const,
    latE5,
    lngE5,
    fetchedAt: new Date().toISOString(),
  });
}
