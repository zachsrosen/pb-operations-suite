/**
 * Shared text tokenization and similarity helpers.
 * Used by linked-products matching and BOM diff/fill sync.
 */

export function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function tokenize(value: string | null | undefined): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set<string>();
  return new Set(normalized.split(" ").filter((token) => token.length >= 3));
}

/**
 * Jaccard-style token similarity (intersection / union).
 * Returns 0–1.
 */
export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? overlap / union : 0;
}
