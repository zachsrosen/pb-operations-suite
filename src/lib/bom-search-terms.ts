/**
 * Shared Zoho search term builder for BOM matching.
 *
 * Used by both bom-snapshot.ts (SKU sync) and bom-so-create.ts (SO creation)
 * to produce an ordered cascade of search terms for Zoho Inventory lookups.
 *
 * Term order: model → "brand model" → description → normalized alias → "brand alias"
 */

import { normalizeModelAlias } from "@/lib/model-alias";

export function buildBomSearchTerms(input: {
  brand?: string | null;
  model?: string | null;
  description?: string | null;
}): string[] {
  const { brand, model, description } = input;

  const name = model
    ? brand
      ? `${brand} ${model}`
      : model
    : description;

  const terms: (string | null | undefined)[] = [model, name, description];

  // Add suffix-stripped model alias as fallback search terms
  if (model) {
    const normalized = normalizeModelAlias(model);
    if (normalized && normalized !== model) {
      terms.push(normalized, brand ? `${brand} ${normalized}` : normalized);
    }
  }

  return terms.filter(
    (t): t is string => !!t && t.trim().length > 1,
  );
}
