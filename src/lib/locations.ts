export const CANONICAL_LOCATIONS = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
] as const;

export type CanonicalLocation = (typeof CANONICAL_LOCATIONS)[number];

const NORMALIZED_LOCATION_ALIASES: Array<[CanonicalLocation, string[]]> = [
  ["Centennial", ["dtc", "centennial", "denver tech"]],
  ["Westminster", ["westy", "westminster"]],
  ["Camarillo", ["camarillo"]],
  ["San Luis Obispo", ["slo", "san luis obispo", "san luis", "california"]],
  ["Colorado Springs", ["cosp", "colorado springs", "co springs", "pueblo"]],
];

export function isCanonicalLocation(value: string): value is CanonicalLocation {
  return (CANONICAL_LOCATIONS as readonly string[]).includes(value);
}

export function normalizeLocation(location?: string | null): CanonicalLocation | null {
  const raw = (location || "").trim();
  if (!raw) return null;

  if (isCanonicalLocation(raw)) return raw;

  const lower = raw.toLowerCase();
  for (const [canonical, aliases] of NORMALIZED_LOCATION_ALIASES) {
    if (aliases.some((alias) => lower === alias || lower.includes(alias))) {
      return canonical;
    }
  }

  return null;
}

export function normalizeLocationOrUnknown(location?: string | null): string {
  return normalizeLocation(location) || "Unknown";
}

/** URL-friendly slug ↔ canonical location mapping for office-performance routes */
export const LOCATION_SLUG_TO_CANONICAL: Record<string, CanonicalLocation> = {
  "westminster": "Westminster",
  "centennial": "Centennial",
  "colorado-springs": "Colorado Springs",
  "san-luis-obispo": "San Luis Obispo",
  "camarillo": "Camarillo",
};

export const CANONICAL_TO_LOCATION_SLUG: Record<CanonicalLocation, string> = {
  "Westminster": "westminster",
  "Centennial": "centennial",
  "Colorado Springs": "colorado-springs",
  "San Luis Obispo": "san-luis-obispo",
  "Camarillo": "camarillo",
};

// ---- Zip + state → PB Location ----
// Kept as a simple static map maintained by Ops. Future: lat/lng + service-radius resolution.
// Zip prefixes cover the broad metro bands around each shop. Tie-breaker precedence: CO zips
// route to the CO-shop band they fall in, CA zips to the CA-shop band.
const ZIP_PREFIX_TO_LOCATION: Record<string, CanonicalLocation> = {
  // Westminster / north metro Denver
  "800": "Westminster", "801": "Westminster", "802": "Westminster", "803": "Westminster",
  // Colorado Springs
  "808": "Colorado Springs", "809": "Colorado Springs",
  // Camarillo / Ventura county
  "930": "Camarillo",
  // San Luis Obispo / SLO county
  "934": "San Luis Obispo", "935": "San Luis Obispo", "936": "San Luis Obispo",
};

// Fine-grained overrides where a 3-digit prefix straddles shops (e.g. Denver metro 801xx covers both Westminster and Centennial).
const FULL_ZIP_OVERRIDES: Record<string, CanonicalLocation> = {
  "80111": "Centennial", "80112": "Centennial", "80113": "Centennial", "80121": "Centennial",
  "80122": "Centennial", "80124": "Centennial", "80125": "Centennial", "80126": "Centennial",
  "80128": "Centennial", "80129": "Centennial", "80130": "Centennial", "80134": "Centennial",
  "80138": "Centennial",
};

export function resolvePbLocationFromAddress(zip: string, state: string): CanonicalLocation | null {
  const z = (zip ?? "").trim();
  const s = (state ?? "").trim().toUpperCase();
  if (!z || z.length < 3) return null;
  if (FULL_ZIP_OVERRIDES[z]) return FULL_ZIP_OVERRIDES[z];

  const prefix = z.slice(0, 3);
  const candidate = ZIP_PREFIX_TO_LOCATION[prefix];
  if (!candidate) return null;

  // State sanity check — CO shops must have CO zips, CA shops must have CA zips.
  const expectedState = (candidate === "Camarillo" || candidate === "San Luis Obispo") ? "CA" : "CO";
  if (s !== expectedState) return null;

  return candidate;
}
