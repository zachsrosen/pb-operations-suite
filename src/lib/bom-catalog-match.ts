/**
 * BOM Catalog Match Helpers
 *
 * Shared catalog-matching utilities extracted from bom-snapshot.ts.
 * Used by the BOM pipeline and the HubSpot push module.
 */

import { prisma } from "@/lib/db";
import { canonicalToken } from "@/lib/canonical";
import { normalizeModelAlias } from "@/lib/model-alias";
import { EquipmentCategory } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InternalAliasCandidate {
  id: string;
  model: string;
  canonicalKey: string | null;
}

/** Minimal item shape required for catalog matching. */
export interface CatalogMatchItem {
  category: string;
  brand: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeIdentityModel(model: string): string {
  return normalizeModelAlias(model).trim().toUpperCase();
}

export function extractModelFamily(model: string): string | null {
  const normalized = normalizeIdentityModel(model);
  const match = normalized.match(/^([A-Z0-9]{6,})(?:-[A-Z0-9]{1,4})+/);
  return match?.[1] || null;
}

export function pickUniqueInternalCandidate(
  candidates: InternalAliasCandidate[],
): InternalAliasCandidate | null {
  return candidates.length === 1 ? candidates[0] : null;
}

// ---------------------------------------------------------------------------
// DB-backed helpers
// ---------------------------------------------------------------------------

/**
 * Broad fallback search: find active InternalProducts in the same category
 * where the model or SKU matches the BOM item's model string (case-insensitive).
 * Used as a last resort before creating a PendingCatalogPush.
 */
export async function findInternalByModelOrSku(
  item: CatalogMatchItem,
): Promise<InternalAliasCandidate[]> {
  const model = item.model.trim();
  if (!model) return [];

  const candidates = await prisma!.internalProduct.findMany({
    where: {
      category: item.category as EquipmentCategory,
      isActive: true,
      OR: [
        { model: { equals: model, mode: "insensitive" } },
        { sku: { equals: model, mode: "insensitive" } },
      ],
    },
    select: { id: true, model: true, canonicalKey: true },
  });

  return candidates.map((c) => ({
    id: c.id,
    model: String(c.model || "").trim(),
    canonicalKey: c.canonicalKey,
  }));
}

export async function findInternalAliasCandidates(
  item: CatalogMatchItem,
): Promise<InternalAliasCandidate[]> {
  const canonicalBrand = canonicalToken(item.brand);
  if (!canonicalBrand) return [];

  const candidates = await prisma!.internalProduct.findMany({
    where: {
      category: item.category as EquipmentCategory,
      isActive: true,
      OR: [
        { canonicalBrand },
        { brand: item.brand },
      ],
    },
    select: {
      id: true,
      model: true,
      canonicalKey: true,
    },
  });

  return candidates.map((candidate) => ({
    id: candidate.id,
    model: String(candidate.model || "").trim(),
    canonicalKey: candidate.canonicalKey,
  }));
}
