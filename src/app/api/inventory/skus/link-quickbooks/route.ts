import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

const ADMIN_ROLES = new Set(["ADMIN", "OWNER", "MANAGER"]);

interface MatchCandidate {
  externalId: string;
  name: string | null;
}

function normalizeSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  const deduped: MatchCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.externalId.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function collectMatches(
  values: string[],
  index: Map<string, MatchCandidate[]>
): MatchCandidate[] {
  const matches: MatchCandidate[] = [];
  for (const value of values) {
    const candidates = index.get(value);
    if (candidates) matches.push(...candidates);
  }
  return dedupeCandidates(matches);
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Optional body.
  }

  const dryRun = body.dryRun === true;
  const onlyMissing = body.onlyMissing !== false;
  const limitRaw = Number(body.limit ?? 5000);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 10000) : 5000;

  const skus = await prisma.equipmentSku.findMany({
    where: {
      ...(onlyMissing
        ? {
            OR: [
              { quickbooksItemId: null },
              { quickbooksItemId: "" },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      category: true,
      brand: true,
      model: true,
      sku: true,
      vendorPartNumber: true,
      quickbooksItemId: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  });

  const quickbooksRows = await prisma.catalogProduct.findMany({
    where: { source: "QUICKBOOKS" },
    select: {
      externalId: true,
      name: true,
      normalizedSku: true,
      normalizedName: true,
    },
    take: 20000,
  });

  const bySku = new Map<string, MatchCandidate[]>();
  const byName = new Map<string, MatchCandidate[]>();
  for (const row of quickbooksRows) {
    const candidate: MatchCandidate = { externalId: row.externalId, name: row.name };
    if (row.normalizedSku) {
      const list = bySku.get(row.normalizedSku) ?? [];
      list.push(candidate);
      bySku.set(row.normalizedSku, list);
    }
    if (row.normalizedName) {
      const list = byName.get(row.normalizedName) ?? [];
      list.push(candidate);
      byName.set(row.normalizedName, list);
    }
  }

  const updates: Array<{ id: string; quickbooksItemId: string }> = [];
  const ambiguous: Array<{ id: string; brand: string; model: string; candidates: MatchCandidate[]; strategy: "sku" | "name" }> = [];
  const noMatch: Array<{ id: string; brand: string; model: string }> = [];

  for (const sku of skus) {
    if (sku.quickbooksItemId && !onlyMissing) continue;

    const skuCandidates = uniqueNonEmpty([
      normalizeSku(sku.sku),
      normalizeSku(sku.vendorPartNumber),
      normalizeSku(sku.model),
    ]);
    const nameCandidates = uniqueNonEmpty([
      normalizeText(`${sku.brand} ${sku.model}`),
      normalizeText(sku.model),
    ]);

    const skuMatches = collectMatches(skuCandidates, bySku);
    if (skuMatches.length === 1) {
      updates.push({ id: sku.id, quickbooksItemId: skuMatches[0].externalId });
      continue;
    }
    if (skuMatches.length > 1) {
      ambiguous.push({
        id: sku.id,
        brand: sku.brand,
        model: sku.model,
        candidates: skuMatches.slice(0, 5),
        strategy: "sku",
      });
      continue;
    }

    const nameMatches = collectMatches(nameCandidates, byName);
    if (nameMatches.length === 1) {
      updates.push({ id: sku.id, quickbooksItemId: nameMatches[0].externalId });
      continue;
    }
    if (nameMatches.length > 1) {
      ambiguous.push({
        id: sku.id,
        brand: sku.brand,
        model: sku.model,
        candidates: nameMatches.slice(0, 5),
        strategy: "name",
      });
      continue;
    }

    noMatch.push({ id: sku.id, brand: sku.brand, model: sku.model });
  }

  if (!dryRun) {
    for (const update of updates) {
      await prisma.equipmentSku.update({
        where: { id: update.id },
        data: { quickbooksItemId: update.quickbooksItemId },
      });
    }
  }

  const duplicateSkuGroups = [...bySku.values()].filter((group) => dedupeCandidates(group).length > 1).length;
  const duplicateNameGroups = [...byName.values()].filter((group) => dedupeCandidates(group).length > 1).length;

  return NextResponse.json({
    dryRun,
    evaluated: skus.length,
    matched: updates.length,
    ambiguous: ambiguous.length,
    noMatch: noMatch.length,
    quickbooksCatalog: {
      total: quickbooksRows.length,
      duplicateSkuGroups,
      duplicateNameGroups,
    },
    samples: {
      matched: updates.slice(0, 25),
      ambiguous: ambiguous.slice(0, 25),
      noMatch: noMatch.slice(0, 25),
    },
  });
}

