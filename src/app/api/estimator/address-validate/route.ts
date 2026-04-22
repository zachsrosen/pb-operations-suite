import { NextResponse } from "next/server";

import { geocodeAddress } from "@/lib/geocode";
import {
  AddressPartsSchema,
  resolveLocationFromZip,
  loadUtilitiesForState,
} from "@/lib/estimator";
import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";

const RATE_LIMIT_COUNT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const ipHash = hashIp(extractIp(request));
  const allowed = await checkRateLimit(
    rateLimitKey("address-validate", ipHash),
    RATE_LIMIT_COUNT,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AddressPartsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let geocoded: Awaited<ReturnType<typeof geocodeAddress>> = null;
  try {
    geocoded = await geocodeAddress({
      street: input.street,
      unit: input.unit ?? null,
      city: input.city,
      state: input.state,
      zip: input.zip,
    });
  } catch (err) {
    console.error("[estimator] geocode failed", err);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  const normalized = geocoded
    ? {
        street: geocoded.streetAddress || input.street,
        city: geocoded.city || input.city,
        state: geocoded.state || input.state,
        zip: geocoded.zip || input.zip,
        lat: geocoded.latitude,
        lng: geocoded.longitude,
        formatted: geocoded.formattedAddress,
      }
    : {
        street: input.street,
        city: input.city,
        state: input.state,
        zip: input.zip,
      };

  const location = resolveLocationFromZip(normalized.zip);
  const inServiceArea = location !== null;
  const utilities = inServiceArea
    ? loadUtilitiesForState(normalized.state, normalized.zip).map((u) => ({
        id: u.id,
        displayName: u.label,
        kwhRate: u.kwhRate,
      }))
    : [];

  return NextResponse.json({ normalized, inServiceArea, location, utilities });
}
