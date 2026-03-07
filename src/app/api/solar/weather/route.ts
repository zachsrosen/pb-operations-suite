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
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

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

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

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
      return NextResponse.json({
        data: cached.tmyData,
        source: "cache",
        latE3,
        lngE3,
        fetchedAt: cached.fetchedAt.toISOString(),
      });
    }
    // Cache expired — fall through to re-fetch
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
        `NREL API error ${nrelResponse.status}: ${errText.slice(0, 500)}`
      );
      return NextResponse.json(
        {
          error: "NREL API request failed",
          status: nrelResponse.status,
        },
        { status: 502 }
      );
    }

    csvText = await nrelResponse.text();
  } catch (err) {
    console.error("NREL fetch error:", err);
    return NextResponse.json(
      { error: "Failed to reach NREL API" },
      { status: 502 }
    );
  }

  // ── Parse CSV ───────────────────────────────────────────

  const tmyData = parseNrelCsv(csvText);
  if (!tmyData) {
    return NextResponse.json(
      { error: "Failed to parse NREL CSV response" },
      { status: 502 }
    );
  }

  if (tmyData.ghi.length !== 8760 || tmyData.temperature.length !== 8760) {
    console.error(
      `NREL data length mismatch: GHI=${tmyData.ghi.length}, temp=${tmyData.temperature.length}`
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
    console.error("Weather cache upsert failed:", err);
  }

  return NextResponse.json({
    data: tmyData,
    source: "nrel",
    latE3,
    lngE3,
    fetchedAt: new Date().toISOString(),
  });
}

// ── CSV Parser ────────────────────────────────────────────

/**
 * Parse NREL PSM3 TMY CSV response.
 *
 * NREL CSV format:
 *  - Row 1: Source metadata
 *  - Row 2: Column headers (Year, Month, Day, Hour, Minute, GHI, Temperature, ...)
 *  - Rows 3+: Data (8,760 hourly rows for a non-leap year)
 *
 * We extract GHI (W/m²) and Temperature (°C).
 */
function parseNrelCsv(
  csv: string
): { ghi: number[]; temperature: number[] } | null {
  try {
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length < 3) {
      console.error("NREL CSV too short:", lines.length, "lines");
      return null;
    }

    // Row 2 (index 1) is the header row
    const headers = lines[1].split(",").map((h) => h.trim().toLowerCase());

    // Find column indices — NREL uses various header names
    const ghiIdx = headers.findIndex(
      (h) => h === "ghi" || h === "ghi (w/m2)" || h === "ghi (w/m^2)"
    );
    const tempIdx = headers.findIndex(
      (h) =>
        h === "temperature" ||
        h === "air temperature" ||
        h === "temperature (c)" ||
        h === "air temperature (c)"
    );

    if (ghiIdx === -1 || tempIdx === -1) {
      console.error(
        "NREL CSV header mismatch. Headers found:",
        headers.join(", ")
      );
      console.error(`GHI index: ${ghiIdx}, Temp index: ${tempIdx}`);
      return null;
    }

    const ghi: number[] = [];
    const temperature: number[] = [];

    // Data starts at row 3 (index 2)
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(ghiIdx, tempIdx)) continue;

      const g = parseFloat(cols[ghiIdx]);
      const t = parseFloat(cols[tempIdx]);

      if (isNaN(g) || isNaN(t)) {
        console.warn(`NREL CSV row ${i}: invalid data — GHI=${cols[ghiIdx]}, temp=${cols[tempIdx]}`);
        continue;
      }

      ghi.push(g);
      temperature.push(t);
    }

    return { ghi, temperature };
  } catch (err) {
    console.error("NREL CSV parse error:", err);
    return null;
  }
}
