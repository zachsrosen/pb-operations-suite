const STRIP_SUFFIXES = /\s+(?:Inc|LLC|Corp|Ltd|Co)\.?\s*$/i;

/** Normalize a vendor name for comparison: lowercase, trim, strip business suffixes. */
export function normalizeVendorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.replace(STRIP_SUFFIXES, "").trim().toLowerCase();
}

interface VendorEntry {
  zohoVendorId: string;
  name: string;
}

/**
 * Match a raw vendor string against a list of known vendors.
 * Returns the matched vendor (with original name) or null.
 * Uses exact match first, then normalized comparison.
 */
export function matchVendorName(
  raw: string,
  vendors: VendorEntry[]
): VendorEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Exact match first
  const exact = vendors.find((v) => v.name === trimmed);
  if (exact) return exact;

  // Normalized match
  const normalized = normalizeVendorName(trimmed);
  if (!normalized) return null;
  return vendors.find((v) => normalizeVendorName(v.name) === normalized) ?? null;
}
