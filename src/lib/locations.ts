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
