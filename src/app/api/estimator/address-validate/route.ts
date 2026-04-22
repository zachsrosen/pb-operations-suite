import { NextResponse } from "next/server";
import { z } from "zod";

import { geocodeAddress, geocodeFreeform } from "@/lib/geocode";
import {
  AddressPartsSchema,
  resolveLocationFromZip,
  loadUtilitiesForState,
} from "@/lib/estimator";
import { checkRateLimit, extractIp, hashIp, rateLimitKey } from "@/lib/estimator/rate-limit";

const RATE_LIMIT_COUNT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Accept either structured AddressParts or a single freeform query string.
 * The client's Google Places autocomplete populates structured fields when
 * it works, but falls back to just the formatted string (via `query`) when
 * place_changed doesn't fire reliably.
 */
const RequestSchema = z.union([
  AddressPartsSchema,
  z.object({ query: z.string().min(3).max(500) }),
]);

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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid address", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const isFreeform = "query" in data;

  let geocoded: Awaited<ReturnType<typeof geocodeAddress>> = null;
  try {
    if (isFreeform) {
      geocoded = await geocodeFreeform(data.query);
    } else {
      geocoded = await geocodeAddress({
        street: data.street,
        unit: data.unit ?? null,
        city: data.city,
        state: data.state,
        zip: data.zip,
      });
    }
  } catch (err) {
    console.error("[estimator] geocode failed", err);
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  if (!geocoded || !geocoded.zip) {
    return NextResponse.json(
      {
        error:
          "We couldn't find that address. Please check the spelling or enter it manually.",
      },
      { status: 400 },
    );
  }

  const normalized = {
    street: geocoded.streetAddress || (isFreeform ? "" : data.street),
    city: geocoded.city || (isFreeform ? "" : data.city),
    state: geocoded.state || (isFreeform ? "" : data.state),
    zip: geocoded.zip,
    lat: geocoded.latitude,
    lng: geocoded.longitude,
    formatted: geocoded.formattedAddress,
    unit: !isFreeform ? data.unit : undefined,
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
