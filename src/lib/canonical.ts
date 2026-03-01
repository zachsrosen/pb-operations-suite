/**
 * Canonical token normalization for product deduplication.
 *
 * Used by: SKU route, harvest, dedupe, matcher, syncEquipmentSkus.
 * Must stay in sync with the Postgres backfill regex in migration.
 */

export function canonicalToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Build a canonical key from category, brand, and model.
 * Returns null if any component is empty after normalization.
 *
 * Format: "CATEGORY|canonicalBrand|canonicalModel"
 * Category is kept as-is (enum value), brand/model are canonicalized.
 */
export function buildCanonicalKey(
  category: string,
  brand: unknown,
  model: unknown
): string | null {
  const cat = String(category || "").trim();
  const cb = canonicalToken(brand);
  const cm = canonicalToken(model);
  if (!cat || !cb || !cm) return null;
  return `${cat}|${cb}|${cm}`;
}
