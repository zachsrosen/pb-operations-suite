import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const LINKABLE_SOURCES = ["hubspot", "zuper", "zoho"] as const;
type LinkableSourceName = (typeof LINKABLE_SOURCES)[number];
type AnchorSourceName = "internal" | LinkableSourceName;

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  url?: string | null;
  linkedExternalIds?: Partial<Record<LinkableSourceName, string | null>>;
}

interface PossibleMatch {
  source: string;
  product: ComparableProduct;
  score: number;
  signals: string[];
}

interface ComparisonRow {
  key: string;
  reasons: string[];
  isMismatch: boolean;
  internal: ComparableProduct | null;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  possibleMatches: PossibleMatch[];
}

interface TruthSetItem {
  sampleId: string;
  rowKey: string;
  category: string;
  targetSource: LinkableSourceName;
  anchorSource: AnchorSourceName;
  reasons: string[];
  internal: {
    id: string;
    brand: string;
    model: string;
    name: string | null;
    sku: string | null;
    currentLinkedExternalId: string | null;
  };
  anchor: {
    source: AnchorSourceName;
    id: string;
    name: string | null;
    sku: string | null;
    url: string | null;
  };
  suggestions: Array<{
    externalId: string;
    name: string | null;
    sku: string | null;
    score: number;
    signals: string[];
    url: string | null;
  }>;
  label: null;
  stratum: string;
}

function isAllowedRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "OWNER";
}

function normalizeSource(value: unknown): LinkableSourceName | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hubspot") return "hubspot";
  if (normalized === "zuper") return "zuper";
  if (normalized === "zoho") return "zoho";
  return null;
}

function parseBooleanParam(value: string | null, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return defaultValue;
}

function parseIntParam(value: string | null, defaultValue: number, min: number, max: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x12345678;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

async function fetchComparisonRows(request: NextRequest): Promise<ComparisonRow[]> {
  const origin = request.nextUrl.origin;
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  const authorization = request.headers.get("authorization");
  const tokenAuthFlag = request.headers.get("x-api-token-authenticated");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  if (tokenAuthFlag) headers.set("x-api-token-authenticated", tokenAuthFlag);

  const response = await fetch(`${origin}/api/products/comparison`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Comparison fetch failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as { rows?: ComparisonRow[] } | null;
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error("Comparison response did not include rows");
  }

  return payload.rows;
}

function pickAnchorSource(row: ComparisonRow, targetSource: LinkableSourceName): AnchorSourceName {
  for (const source of LINKABLE_SOURCES) {
    if (source === targetSource) continue;
    if (row[source]) return source;
  }
  return "internal";
}

function getAnchorProduct(row: ComparisonRow, anchorSource: AnchorSourceName): ComparableProduct | null {
  if (anchorSource === "internal") return row.internal;
  return row[anchorSource];
}

export async function GET(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!isAllowedRole(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const size = parseIntParam(request.nextUrl.searchParams.get("size"), 300, 25, 1000);
  const seed = parseIntParam(request.nextUrl.searchParams.get("seed"), 42, 1, Number.MAX_SAFE_INTEGER);
  const maxSuggestions = parseIntParam(request.nextUrl.searchParams.get("maxSuggestions"), 5, 1, 10);
  const onlyMismatches = parseBooleanParam(request.nextUrl.searchParams.get("onlyMismatches"), true);
  const includeNoSuggestion = parseBooleanParam(request.nextUrl.searchParams.get("includeNoSuggestion"), true);
  const minSuggestionScore = Number(request.nextUrl.searchParams.get("minScore") ?? "0");
  const normalizedMinSuggestionScore = Number.isFinite(minSuggestionScore)
    ? Math.min(1, Math.max(0, minSuggestionScore))
    : 0;

  let rows: ComparisonRow[] = [];
  try {
    rows = await fetchComparisonRows(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch comparison rows" },
      { status: 502 }
    );
  }

  const internalIds = [...new Set(rows.map((row) => row.internal?.id).filter((id): id is string => Boolean(id)))];
  const internalMetaRows = internalIds.length
    ? await prisma.equipmentSku.findMany({
        where: { id: { in: internalIds } },
        select: {
          id: true,
          category: true,
          brand: true,
          model: true,
        },
      })
    : [];
  const internalMetaById = new Map(internalMetaRows.map((row) => [row.id, row]));

  const population: TruthSetItem[] = [];
  for (const row of rows) {
    if (!row.internal?.id) continue;
    if (onlyMismatches && !row.isMismatch) continue;

    const internalMeta = internalMetaById.get(row.internal.id);
    const category = String(internalMeta?.category || "UNKNOWN").trim() || "UNKNOWN";

    for (const targetSource of LINKABLE_SOURCES) {
      if (row[targetSource]) continue;

      const anchorSource = pickAnchorSource(row, targetSource);
      const anchorProduct = getAnchorProduct(row, anchorSource);
      if (!anchorProduct?.id) continue;

      const suggestions = row.possibleMatches
        .filter((match) => normalizeSource(match.source) === targetSource)
        .filter((match) => Number.isFinite(match.score) && match.score >= normalizedMinSuggestionScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSuggestions)
        .map((match) => ({
          externalId: String(match.product.id || "").trim(),
          name: match.product.name ?? null,
          sku: match.product.sku ?? null,
          score: match.score,
          signals: Array.isArray(match.signals) ? match.signals : [],
          url: match.product.url ?? null,
        }))
        .filter((candidate) => Boolean(candidate.externalId));

      if (!includeNoSuggestion && suggestions.length === 0) {
        continue;
      }

      const bucket = suggestions.length > 0 ? "suggested" : "no_suggestion";
      const stratum = `${category}::${anchorSource}->${targetSource}::${bucket}`;
      const currentLinkedExternalId =
        row.internal.linkedExternalIds && typeof row.internal.linkedExternalIds === "object"
          ? String(row.internal.linkedExternalIds[targetSource] || "").trim() || null
          : null;

      population.push({
        sampleId: `${row.key}:${targetSource}`,
        rowKey: row.key,
        category,
        targetSource,
        anchorSource,
        reasons: Array.isArray(row.reasons) ? row.reasons : [],
        internal: {
          id: row.internal.id,
          brand: String(internalMeta?.brand || "").trim(),
          model: String(internalMeta?.model || "").trim(),
          name: row.internal.name ?? null,
          sku: row.internal.sku ?? null,
          currentLinkedExternalId,
        },
        anchor: {
          source: anchorSource,
          id: anchorProduct.id,
          name: anchorProduct.name ?? null,
          sku: anchorProduct.sku ?? null,
          url: anchorProduct.url ?? null,
        },
        suggestions,
        label: null,
        stratum,
      });
    }
  }

  const random = seededRandom(seed);
  const byStratum = new Map<string, TruthSetItem[]>();
  for (const item of population) {
    const list = byStratum.get(item.stratum) || [];
    list.push(item);
    byStratum.set(item.stratum, list);
  }

  const strataEntries = [...byStratum.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stratum, items]) => {
      const cloned = [...items].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
      shuffleInPlace(cloned, random);
      return { stratum, remaining: cloned, populationCount: items.length };
    });

  const sampled: TruthSetItem[] = [];
  while (sampled.length < size) {
    let added = false;
    for (const entry of strataEntries) {
      if (sampled.length >= size) break;
      const next = entry.remaining.pop();
      if (!next) continue;
      sampled.push(next);
      added = true;
    }
    if (!added) break;
  }

  const selectedByStratum = sampled.reduce<Record<string, number>>((acc, item) => {
    acc[item.stratum] = (acc[item.stratum] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    params: {
      size,
      seed,
      maxSuggestions,
      onlyMismatches,
      includeNoSuggestion,
      minScore: normalizedMinSuggestionScore,
    },
    population: {
      totalCandidates: population.length,
      rowsEvaluated: rows.length,
      strataCount: strataEntries.length,
    },
    sample: {
      selectedCount: sampled.length,
      strata: strataEntries.map((entry) => ({
        key: entry.stratum,
        populationCount: entry.populationCount,
        selectedCount: selectedByStratum[entry.stratum] || 0,
      })),
      items: sampled,
    },
  });
}
