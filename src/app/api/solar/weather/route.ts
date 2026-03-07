/**
 * GET /api/solar/weather?lat=39.739&lng=-104.985
 *
 * NREL TMY proxy — returns 8,760 hourly GHI + ambient temperature values.
 *
 * Flow:
 *  1. Validate lat/lng
 *  2. Check SolarWeatherCache (keyed by latE3/lngE3)
 *  3. If cache hit and fresh (< 90 days) → return cached
 *  4. If miss → fetch from NREL NSRDB PSM3 TMY API → parse CSV → cache → return
 *
 * Cache key uses integer lat/lng × 1000 (~110m resolution) to avoid
 * floating-point uniqueness edge cases.
 *
 * PBO-003a hotfixes applied:
 *  - CSV parser detects header row dynamically (handles variable metadata rows)
 *  - Mutation rate limiter removed (read-only endpoint)
 *  - Structured logging for cache source, fetch failures, parse failures
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { parseNrelCsv } from "@/lib/solar-weather-parser";

// ── Config ────────────────────────────────────────────────

const NREL_API_KEY = process.env.NREL_API_KEY;
const NREL_EMAIL = process.env.NREL_EMAIL || "solar@photonbrothers.com";
const NREL_BASE_URL =
  "https://developer.nrel.gov/api/nsrdb/v2/solar/psm3-tmy-download.csv";

/** Cache TTL: 90 days in milliseconds */
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ── Validation ────────────────────────────────────────────

const QuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// ── Route Handler ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  // No mutation rate limiter — this is a read-only endpoint.
  // NREL upstream has its own rate limits; our cache prevents excessive calls.

  if (!prisma) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }

  if (!NREL_API_KEY) {
    return NextResponse.json(
      { error: "NREL API key not configured" },
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

  // Convert to integer keys (×1000, rounded) for cache lookup
  const latE3 = Math.round(lat * 1000);
  const lngE3 = Math.round(lng * 1000);

  // ── Check cache ─────────────────────────────────────────

  const cached = await prisma.solarWeatherCache.findUnique({
    where: { latE3_lngE3: { latE3, lngE3 } },
  });

  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < CACHE_TTL_MS) {
      console.log(
        `[weather] source=cache lat=${lat} lng=${lng} latE3=${latE3} lngE3=${lngE3} user=${user.email}`
      );
      return NextResponse.json({
        data: cached.tmyData,
        source: "cache",
        latE3,
        lngE3,
        fetchedAt: cached.fetchedAt.toISOString(),
      });
    }
    // Cache expired — fall through to re-fetch
    console.log(
      `[weather] cache_expired lat=${lat} lng=${lng} age_days=${Math.round(age / 86400000)}`
    );
  }

  // ── Fetch from NREL ─────────────────────────────────────

  const wkt = `POINT(${lng} ${lat})`;
  const nrelParams = new URLSearchParams({
    api_key: NREL_API_KEY,
    wkt,
    names: "tmy-2021",
    attributes: "ghi,air_temperature",
    utc: "true",
    leap_day: "false",
    interval: "60",
    full_name: "Photon Brothers Solar",
    email: NREL_EMAIL,
    affiliation: "Photon Brothers",
    reason: "solar_design_tool",
    mailing_list: "false",
  });

  let csvText: string;
  try {
    const nrelResponse = await fetch(`${NREL_BASE_URL}?${nrelParams}`, {
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!nrelResponse.ok) {
      const errText = await nrelResponse.text().catch(() => "");
      console.error(
        `[weather] nrel_fetch_error status=${nrelResponse.status} lat=${lat} lng=${lng} body=${errText.slice(0, 500)}`
      );
      return NextResponse.json(
        {
          error: "NREL API request failed",
          nrelStatus: nrelResponse.status,
        },
        { status: 502 }
      );
    }

    csvText = await nrelResponse.text();
  } catch (err) {
    console.error(
      `[weather] nrel_fetch_exception lat=${lat} lng=${lng}`,
      err
    );
    return NextResponse.json(
      { error: "Failed to reach NREL API" },
      { status: 502 }
    );
  }

  // ── Parse CSV ───────────────────────────────────────────

  const parseResult = parseNrelCsv(csvText);
  if (!parseResult.ok) {
    console.error(
      `[weather] parse_error lat=${lat} lng=${lng} reason="${parseResult.error}" totalLines=${parseResult.totalLines ?? "?"} headerRow=${parseResult.headerRowIndex ?? "not found"}`
    );
    return NextResponse.json(
      {
        error: "Failed to parse NREL CSV response",
        detail: parseResult.error,
      },
      { status: 502 }
    );
  }

  const tmyData = parseResult.data;

  if (tmyData.ghi.length !== 8760 || tmyData.temperature.length !== 8760) {
    console.error(
      `[weather] row_count_error lat=${lat} lng=${lng} ghi=${tmyData.ghi.length} temp=${tmyData.temperature.length} expected=8760`
    );
    return NextResponse.json(
      {
        error: `Expected 8760 hourly values, got GHI=${tmyData.ghi.length}, temp=${tmyData.temperature.length}`,
      },
      { status: 502 }
    );
  }

  // ── Upsert cache ────────────────────────────────────────

  try {
    await prisma.solarWeatherCache.upsert({
      where: { latE3_lngE3: { latE3, lngE3 } },
      create: {
        latE3,
        lngE3,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tmyData: tmyData as any,
        fetchedAt: new Date(),
      },
      update: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tmyData: tmyData as any,
        fetchedAt: new Date(),
      },
    });
  } catch (err) {
    // Cache write failure is non-fatal — still return data
    console.error("[weather] cache_upsert_error", err);
  }

  console.log(
    `[weather] source=nrel lat=${lat} lng=${lng} latE3=${latE3} lngE3=${lngE3} rows=${tmyData.ghi.length} user=${user.email}`
  );

  return NextResponse.json({
    data: tmyData,
    source: "nrel",
    latE3,
    lngE3,
    fetchedAt: new Date().toISOString(),
  });
}

// Parser imported from @/lib/solar-weather-parser
