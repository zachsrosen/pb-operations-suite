/**
 * GET /api/solar/geocode?address=123+Main+St+Denver+CO
 *
 * Server-side geocoding proxy — converts an address to lat/lng
 * using the Google Maps Geocoding API.
 *
 * Keeps the API key server-side (not exposed to client).
 * Auth: requireSolarAuth (same as shade route).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth } from "@/lib/solar-auth";
import { z } from "zod";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const QuerySchema = z.object({
  address: z.string().min(1, "Address is required").max(500),
});

export async function GET(req: NextRequest) {
  // Auth check
  const [, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!GOOGLE_MAPS_API_KEY) {
    return NextResponse.json(
      { error: "Google Maps API key not configured" },
      { status: 503 }
    );
  }

  // Parse query params
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    address: url.searchParams.get("address"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid address", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { address } = parsed.data;

  try {
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;

    const geoRes = await fetch(geoUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!geoRes.ok) {
      return NextResponse.json(
        { error: "Geocoding service error", status: geoRes.status },
        { status: 502 }
      );
    }

    const geoJson = await geoRes.json();

    if (geoJson.status !== "OK" || !geoJson.results?.length) {
      return NextResponse.json({
        data: null,
        reason: geoJson.status || "NO_RESULTS",
      });
    }

    const location = geoJson.results[0].geometry.location;
    const formattedAddress = geoJson.results[0].formatted_address;

    return NextResponse.json({
      data: {
        lat: location.lat,
        lng: location.lng,
        formattedAddress,
      },
    });
  } catch (err) {
    console.error("[geocode] error", err);
    return NextResponse.json(
      { error: "Geocoding failed" },
      { status: 502 }
    );
  }
}
