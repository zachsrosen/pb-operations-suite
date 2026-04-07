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
