import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { CatalogProductSource } from "@/generated/prisma/enums";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { zohoInventory, type ZohoInventoryItem } from "@/lib/zoho-inventory";
import { getZuperWebBaseUrl } from "@/lib/external-links";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALL_SOURCES = ["internal", "hubspot", "zuper", "zoho", "opensolar", "quickbooks"] as const;
type SourceName = (typeof ALL_SOURCES)[number];
const LINKABLE_SOURCES = ["hubspot", "zuper", "zoho", "quickbooks"] as const;
type LinkableSourceName = (typeof LINKABLE_SOURCES)[number];

const SOURCE_LABELS: Record<SourceName, string> = {
  internal: "Internal",
  hubspot: "HubSpot",
  zuper: "Zuper",
  zoho: "Zoho",
  opensolar: "OpenSolar",
  quickbooks: "QuickBooks",
};

type CacheSourceName = "hubspot" | "zuper" | "zoho" | "quickbooks" | "opensolar";

const CACHE_SOURCE_ENUM: Record<CacheSourceName, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
  quickbooks: "QUICKBOOKS",
  opensolar: "OPENSOLAR",
};

type RowProducts = Record<SourceName, ComparableProduct | null>;

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
  url: string | null;
  linkedExternalIds?: Partial<Record<LinkableSourceName, string | null>>;
}

interface NormalizedProduct extends ComparableProduct {
  source: SourceName;
  key: string;
  normalizedName: string;
}

interface SourceHealth {
  configured: boolean;
  count: number;
  error: string | null;
}

interface ComparisonRow extends RowProducts {
  key: string;
  reasons: string[];
  isMismatch: boolean;
  possibleMatches: PossibleMatch[];
}

interface PossibleMatch {
  source: SourceName;
  product: ComparableProduct;
  score: number;
  signals: string[];
}

interface ProductComparisonResponse {
  rows: ComparisonRow[];
  summary: {
    totalRows: number;
    mismatchRows: number;
    fullyMatchedRows: number;
    missingBySource: Record<SourceName, number>;
    sourceCounts: Record<SourceName, number>;
  };
  health: Record<SourceName, SourceHealth>;
  warnings: string[];
  lastUpdated: string;
}

interface SourceFetchResult {
  products: NormalizedProduct[];
  configured: boolean;
  error: string | null;
}

interface HubSpotObjectResponse {
  results?: Array<{
    id?: string;
    properties?: Record<string, string | null | undefined>;
  }>;
  paging?: {
    next?: {
      after?: string;
    };
  };
}

interface HubSpotPropertyDefinitionResponse {
  results?: Array<{
    name?: string;
    label?: string;
  }>;
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.trunc(raw);
}

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isPrismaMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2022";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAllowedRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "OWNER";
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSku(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function countLinkedExternalIds(
  links: Partial<Record<LinkableSourceName, string | null>> | undefined
): number {
  if (!links) return 0;
  let count = 0;
  for (const source of LINKABLE_SOURCES) {
    if (String(links[source] || "").trim()) count += 1;
  }
  return count;
}

function aggregateInternalLinks(
  products: NormalizedProduct[]
): Partial<Record<LinkableSourceName, string | null>> {
  const aggregated: Partial<Record<LinkableSourceName, string | null>> = {};
  for (const source of LINKABLE_SOURCES) {
    const ids = uniqueStrings(
      products
        .map((product) => String(product.linkedExternalIds?.[source] || "").trim())
        .filter(Boolean)
    );
    if (ids.length === 1) {
      aggregated[source] = ids[0];
    }
  }
  return aggregated;
}

function pickPrimaryInternal(products: NormalizedProduct[]): ComparableProduct | null {
  if (!products.length) return null;

  const sorted = [...products].sort((a, b) => {
    const linkDelta =
      countLinkedExternalIds(b.linkedExternalIds) - countLinkedExternalIds(a.linkedExternalIds);
    if (linkDelta !== 0) return linkDelta;
    return a.id.localeCompare(b.id);
  });

  const primary = pickPrimary(sorted);
  if (!primary) return null;

  const aggregatedLinks = aggregateInternalLinks(products);
  const mergedLinks: Partial<Record<LinkableSourceName, string | null>> = {
    ...(primary.linkedExternalIds || {}),
    ...aggregatedLinks,
  };
  primary.linkedExternalIds = mergedLinks;
  return primary;
}

function missingReasonForSource(source: SourceName): string {
  return `Missing in ${SOURCE_LABELS[source]}`;
}

function buildHubSpotProductUrl(productId: string): string {
  const portalId = (process.env.HUBSPOT_PORTAL_ID || "21710069").trim();
  return `https://app.hubspot.com/contacts/${portalId}/record/0-7/${encodeURIComponent(productId)}`;
}

function buildZuperProductUrl(productId: string): string {
  const baseUrl = getZuperWebBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}/app/product/${encodeURIComponent(productId)}`;
}

function buildZohoProductUrl(itemId: string): string {
  const baseUrl = process.env.ZOHO_INVENTORY_WEB_URL || "https://inventory.zoho.com/app#/items";
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(itemId)}`;
}

function buildOpenSolarProductUrl(productId: string): string {
  const baseUrl = process.env.OPENSOLAR_WEB_URL || "https://app.opensolar.com";
  return `${baseUrl.replace(/\/$/, "")}/app/products/${encodeURIComponent(productId)}`;
}

function buildQuickBooksProductUrl(itemId: string): string | null {
  const companyId = String(process.env.QUICKBOOKS_COMPANY_ID || "").trim();
  if (!companyId) return null;
  const baseUrl = process.env.QUICKBOOKS_WEB_URL || "https://app.qbo.intuit.com";
  return `${baseUrl.replace(/\/$/, "")}/app/items?itemId=${encodeURIComponent(itemId)}&companyId=${encodeURIComponent(companyId)}`;
}

function keyForProduct(sku: string | null, name: string | null, source: SourceName, id: string): string {
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) return `sku:${normalizedSku}`;
  const normalizedName = normalizeText(name);
  if (normalizedName) return `name:${normalizedName}`;
  return `fallback:${source}:${id}`;
}

function pickPrimary(products: NormalizedProduct[]): ComparableProduct | null {
  if (!products.length) return null;
  const first = products[0];
  const linkedExternalIds = first.linkedExternalIds
    ? {
        hubspot: String(first.linkedExternalIds.hubspot || "").trim() || null,
        zuper: String(first.linkedExternalIds.zuper || "").trim() || null,
        zoho: String(first.linkedExternalIds.zoho || "").trim() || null,
        quickbooks: String(first.linkedExternalIds.quickbooks || "").trim() || null,
      }
    : undefined;
  return {
    id: first.id,
    name: first.name,
    sku: first.sku,
    price: first.price,
    status: first.status,
    description: first.description,
    url: first.url,
    ...(linkedExternalIds ? { linkedExternalIds } : {}),
  };
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getNestedArrayCandidate(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const record = coerceRecord(payload);
  if (!record) return null;

  const directKeys = ["data", "products", "items", "records", "result"];
  for (const key of directKeys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }

  for (const key of directKeys) {
    const nested = coerceRecord(record[key]);
    if (!nested) continue;
    for (const nestedKey of ["data", "products", "items", "records", "result"]) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }

  return null;
}

const TOKEN_STOPWORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "kit",
  "system",
  "item",
  "service",
  "misc",
  "miscellaneous",
  "solar",
]);

const TOKEN_EQUIVALENTS: Record<string, string> = {
  batt: "battery",
  batteries: "battery",
  backup: "battery",
  gateway: "controller",
  gateways: "controller",
  module: "panel",
  modules: "panel",
  inv: "inverter",
  inverters: "inverter",
  microinverter: "inverter",
  microinverters: "inverter",
  photovoltaic: "pv",
};

function normalizeNameToken(token: string): string {
  const canonical = token.trim().toLowerCase();
  if (!canonical) return "";
  return TOKEN_EQUIVALENTS[canonical] || canonical;
}

function tokenize(value: string | null | undefined): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  const tokens = normalized
    .split(" ")
    .map((token) => normalizeNameToken(token))
    .filter((token) => token.length >= 3 || /\d/.test(token))
    .filter((token) => !TOKEN_STOPWORDS.has(token));
  return new Set(tokens);
}

function canonicalNameKey(value: string | null | undefined): string {
  const tokens = [...tokenize(value)].sort();
  return tokens.join(" ");
}

function extractIdentifiers(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  const raw = String(value).toUpperCase();
  const matches = raw.match(/[A-Z]{1,8}\d[A-Z0-9-]{1,}/g) || [];
  const cleaned = matches
    .map((token) => token.replace(/[^A-Z0-9]+/g, ""))
    .filter((token) => token.length >= 4);
  return new Set(cleaned);
}

function identifierOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap;
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? overlap / union : 0;
}

function compareProducts(anchor: ComparableProduct, candidate: ComparableProduct): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  const anchorIdentifiers = new Set([
    ...extractIdentifiers(anchor.sku),
    ...extractIdentifiers(anchor.name),
  ]);
  const candidateIdentifiers = new Set([
    ...extractIdentifiers(candidate.sku),
    ...extractIdentifiers(candidate.name),
  ]);

  const sharedIdentifiers = identifierOverlap(anchorIdentifiers, candidateIdentifiers);
  if (sharedIdentifiers > 0) {
    score += 0.58;
    signals.push("Identifier match");
  }

  const anchorSku = normalizeSku(anchor.sku);
  const candidateSku = normalizeSku(candidate.sku);
  if (anchorSku && candidateSku) {
    if (anchorSku === candidateSku) {
      score += 0.72;
      signals.push("SKU exact");
    } else if (
      anchorSku.length >= 5 &&
      candidateSku.length >= 5 &&
      (anchorSku.includes(candidateSku) || candidateSku.includes(anchorSku))
    ) {
      score += 0.42;
      signals.push("SKU partial");
    } else if (sharedIdentifiers === 0) {
      score -= 0.15;
      signals.push("SKU differs");
    }
  }

  const normalizedAnchorName = normalizeText(anchor.name);
  const normalizedCandidateName = normalizeText(candidate.name);
  const anchorCanonicalName = canonicalNameKey(anchor.name);
  const candidateCanonicalName = canonicalNameKey(candidate.name);

  if (normalizedAnchorName && normalizedAnchorName === normalizedCandidateName) {
    score += 0.62;
    signals.push("Name exact");
  } else if (anchorCanonicalName && anchorCanonicalName === candidateCanonicalName) {
    score += 0.52;
    signals.push("Name canonical");
  }

  const nameSimilarity = tokenSimilarity(tokenize(anchor.name), tokenize(candidate.name));
  if (nameSimilarity >= 0.9) {
    score += 0.56;
    signals.push("Name very close");
  } else if (nameSimilarity >= 0.6) {
    score += 0.42;
    signals.push("Name similar");
  } else if (nameSimilarity >= 0.4) {
    score += 0.25;
    signals.push("Name overlap");
  }

  const descriptionSimilarity = tokenSimilarity(tokenize(anchor.description), tokenize(candidate.description));
  if (descriptionSimilarity >= 0.6) {
    score += 0.14;
    signals.push("Description similar");
  } else if (descriptionSimilarity >= 0.35) {
    score += 0.08;
    signals.push("Description overlap");
  }

  if (typeof anchor.price === "number" && typeof candidate.price === "number" && anchor.price > 0 && candidate.price > 0) {
    const diffRatio = Math.abs(anchor.price - candidate.price) / Math.max(anchor.price, candidate.price);
    if (diffRatio <= 0.03) {
      score += 0.2;
      signals.push("Price close");
    } else if (diffRatio <= 0.1) {
      score += 0.12;
      signals.push("Price similar");
    } else if (diffRatio <= 0.2) {
      score += 0.05;
      signals.push("Price somewhat close");
    } else if (diffRatio >= 0.75) {
      score -= 0.2;
      signals.push("Price far");
    } else if (diffRatio >= 0.5) {
      score -= 0.12;
      signals.push("Price diverges");
    }
  }

  return { score: Math.max(0, Math.min(1, Number(score.toFixed(3)))), signals };
}

function quickProductFilter(anchorProducts: ComparableProduct[], candidate: ComparableProduct): boolean {
  const candidateSku = normalizeSku(candidate.sku);
  const candidateTokens = tokenize(candidate.name);
  const candidateCanonicalName = canonicalNameKey(candidate.name);
  const candidateIdentifiers = new Set([
    ...extractIdentifiers(candidate.sku),
    ...extractIdentifiers(candidate.name),
  ]);

  for (const anchor of anchorProducts) {
    const anchorSku = normalizeSku(anchor.sku);
    if (anchorSku && candidateSku) {
      if (anchorSku === candidateSku) return true;
      if (
        anchorSku.length >= 5 &&
        candidateSku.length >= 5 &&
        (anchorSku.includes(candidateSku) || candidateSku.includes(anchorSku))
      ) {
        return true;
      }
    }

    if (candidateCanonicalName && candidateCanonicalName === canonicalNameKey(anchor.name)) return true;

    const overlap = tokenSimilarity(tokenize(anchor.name), candidateTokens);
    if (overlap >= 0.2) return true;

    const anchorIdentifiers = new Set([
      ...extractIdentifiers(anchor.sku),
      ...extractIdentifiers(anchor.name),
    ]);
    if (identifierOverlap(anchorIdentifiers, candidateIdentifiers) > 0) return true;

    if (typeof anchor.price === "number" && typeof candidate.price === "number" && anchor.price > 0 && candidate.price > 0) {
      const diffRatio = Math.abs(anchor.price - candidate.price) / Math.max(anchor.price, candidate.price);
      if (diffRatio <= 0.25) return true;
    }
  }

  return false;
}

function buildPossibleMatches(
  row: ComparisonRow,
  productsBySource: Record<SourceName, ComparableProduct[]>,
  sources: SourceName[]
): PossibleMatch[] {
  if (!row.isMismatch) return [];

  const anchors = sources.map((source) => row[source]).filter(Boolean) as ComparableProduct[];
  if (anchors.length === 0) return [];

  const missingSources = sources.filter((source) => row[source] === null);
  if (missingSources.length === 0) return [];

  const threshold = 0.5;
  const maxPerSource = 3;
  const possibleMatches: PossibleMatch[] = [];

  for (const source of missingSources) {
    const candidates: Array<{ product: ComparableProduct; score: number; signals: string[] }> = [];
    for (const candidate of productsBySource[source]) {
      if (!quickProductFilter(anchors, candidate)) continue;

      let bestScore = 0;
      let scoreSum = 0;
      let supportingAnchors = 0;
      const signalSet = new Set<string>();

      for (const anchor of anchors) {
        const result = compareProducts(anchor, candidate);
        scoreSum += result.score;
        if (result.score >= 0.45) supportingAnchors += 1;
        if (result.score > bestScore) {
          bestScore = result.score;
        }
        for (const signal of result.signals) signalSet.add(signal);
      }

      const averageScore = scoreSum / anchors.length;
      const consensusBoost =
        anchors.length > 1
          ? Math.min(0.14, (supportingAnchors / anchors.length) * 0.14)
          : 0;
      const combinedScore = Math.min(
        1,
        Number((bestScore * 0.72 + averageScore * 0.28 + consensusBoost).toFixed(3))
      );

      const hasStrongSignal = [...signalSet].some((signal) =>
        signal === "SKU exact" ||
        signal === "Identifier match" ||
        signal === "Name exact" ||
        signal === "Name canonical" ||
        signal === "Name very close"
      );
      if (!hasStrongSignal && combinedScore < 0.62) continue;

      if (combinedScore >= threshold) {
        const signals = uniqueStrings([
          ...[...signalSet].filter((signal) => !signal.startsWith("SKU differs")),
          ...(supportingAnchors > 1 ? [`Consensus ${supportingAnchors}/${anchors.length}`] : []),
        ]).slice(0, 4);
        candidates.push({ product: candidate, score: combinedScore, signals });
      }
    }

    candidates
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return (a.product.name || "").localeCompare(b.product.name || "");
      })
      .slice(0, maxPerSource)
      .forEach((match) => {
        possibleMatches.push({
          source,
          product: match.product,
          score: match.score,
          signals: match.signals,
        });
      });
  }

  return possibleMatches.sort((a, b) => b.score - a.score);
}

interface ExactMatchIndexEntry {
  bySku: Map<string, ComparableProduct[]>;
  byName: Map<string, ComparableProduct[]>;
}

function createExactMatchIndex(
  productsBySource: Record<SourceName, ComparableProduct[]>
): Record<SourceName, ExactMatchIndexEntry> {
  const makeEntry = (): ExactMatchIndexEntry => ({
    bySku: new Map<string, ComparableProduct[]>(),
    byName: new Map<string, ComparableProduct[]>(),
  });

  const index: Record<SourceName, ExactMatchIndexEntry> = {
    internal: makeEntry(),
    hubspot: makeEntry(),
    zuper: makeEntry(),
    zoho: makeEntry(),
    opensolar: makeEntry(),
    quickbooks: makeEntry(),
  };

  for (const source of ALL_SOURCES) {
    for (const product of productsBySource[source]) {
      const id = String(product.id || "").trim();
      if (!id) continue;

      const skuKey = normalizeSku(product.sku);
      if (skuKey) {
        const existing = index[source].bySku.get(skuKey) || [];
        if (!existing.some((candidate) => candidate.id === id)) {
          existing.push(product);
          index[source].bySku.set(skuKey, existing);
        }
      }

      const nameKey = normalizeText(product.name);
      if (nameKey) {
        const existing = index[source].byName.get(nameKey) || [];
        if (!existing.some((candidate) => candidate.id === id)) {
          existing.push(product);
          index[source].byName.set(nameKey, existing);
        }
      }
    }
  }

  return index;
}

function buildFastPossibleMatches(
  row: ComparisonRow,
  exactMatchIndex: Record<SourceName, ExactMatchIndexEntry>,
  sources: SourceName[]
): PossibleMatch[] {
  if (!row.isMismatch) return [];

  const anchors = sources.map((source) => row[source]).filter(Boolean) as ComparableProduct[];
  if (anchors.length === 0) return [];

  const missingSources = sources.filter((source) => row[source] === null);
  if (missingSources.length === 0) return [];

  const anchorSkus = uniqueStrings(
    anchors.map((product) => normalizeSku(product.sku)).filter(Boolean)
  );
  const anchorNames = uniqueStrings(
    anchors.map((product) => normalizeText(product.name)).filter(Boolean)
  );

  const allMatches: PossibleMatch[] = [];
  for (const source of missingSources) {
    const candidates = new Map<string, { product: ComparableProduct; score: number; signals: Set<string> }>();

    const upsertCandidate = (product: ComparableProduct, score: number, signal: string) => {
      const id = String(product.id || "").trim();
      if (!id) return;
      const existing = candidates.get(id);
      if (existing) {
        existing.score = Math.max(existing.score, score);
        existing.signals.add(signal);
        return;
      }
      candidates.set(id, {
        product,
        score,
        signals: new Set<string>([signal]),
      });
    };

    for (const sku of anchorSkus) {
      const skuMatches = exactMatchIndex[source].bySku.get(sku) || [];
      for (const candidate of skuMatches) {
        upsertCandidate(candidate, 0.94, "SKU exact");
      }
    }

    for (const name of anchorNames) {
      const nameMatches = exactMatchIndex[source].byName.get(name) || [];
      for (const candidate of nameMatches) {
        upsertCandidate(candidate, 0.84, "Name exact");
      }
    }

    const ranked = [...candidates.values()]
      .map((candidate) => {
        const hasSku = candidate.signals.has("SKU exact");
        const hasName = candidate.signals.has("Name exact");
        const score =
          hasSku && hasName
            ? 0.98
            : hasSku
              ? Math.max(candidate.score, 0.94)
              : Math.max(candidate.score, 0.84);
        return {
          product: candidate.product,
          score,
          signals: [...candidate.signals],
        };
      })
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return (a.product.name || "").localeCompare(b.product.name || "");
      })
      .slice(0, 3);

    for (const match of ranked) {
      allMatches.push({
        source,
        product: match.product,
        score: Number(match.score.toFixed(3)),
        signals: match.signals,
      });
    }
  }

  return allMatches.sort((a, b) => b.score - a.score);
}

function evaluateRowReasons(row: RowProducts, sources: SourceName[]): string[] {
  const reasons: string[] = [];

  for (const source of sources) {
    if (!row[source]) reasons.push(missingReasonForSource(source));
  }

  const present = sources.map((source) => row[source]).filter(Boolean) as ComparableProduct[];
  const names = new Set(present.map((p) => normalizeText(p.name)).filter(Boolean));
  const skus = new Set(present.map((p) => normalizeSku(p.sku)).filter(Boolean));
  const hasSharedSku = skus.size === 1 && skus.size > 0;

  if (names.size > 1 && !hasSharedSku) reasons.push("Product name mismatch");
  if (skus.size > 1) reasons.push("SKU mismatch");

  const numericPrices = present
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p))
    .map((p) => Number(p.toFixed(2)));
  if (numericPrices.length >= 2) {
    const uniquePrices = new Set(numericPrices);
    if (uniquePrices.size > 1) reasons.push("Price mismatch");
  }

  const internalProduct = row.internal;
  const linkedExternalIds = internalProduct?.linkedExternalIds;
  if (internalProduct && linkedExternalIds) {
    for (const source of LINKABLE_SOURCES) {
      if (!sources.includes(source)) continue;
      const linkedId = String(linkedExternalIds[source] || "").trim();
      const externalProduct = row[source];
      if (!externalProduct) {
        if (linkedId) reasons.push(`Internal link mismatch for ${SOURCE_LABELS[source]}`);
        continue;
      }
      if (!linkedId) {
        reasons.push(`Internal link missing for ${SOURCE_LABELS[source]}`);
        continue;
      }
      if (linkedId !== externalProduct.id) {
        reasons.push(`Internal link mismatch for ${SOURCE_LABELS[source]}`);
      }
    }
  }

  return uniqueStrings(reasons);
}

function autoMergeRows(rows: ComparisonRow[], sources: SourceName[]): ComparisonRow[] {
  const working = rows.map((row) => ({
    ...row,
    reasons: [...row.reasons],
    possibleMatches: [...row.possibleMatches],
  }));
  const removed = new Set<number>();
  const productToRow = new Map<string, number>();

  const indexRowProducts = (rowIndex: number) => {
    const row = working[rowIndex];
    for (const source of sources) {
      const product = row[source];
      if (!product) continue;
      productToRow.set(`${source}:${product.id}`, rowIndex);
    }
  };

  for (let i = 0; i < working.length; i += 1) {
    indexRowProducts(i);
  }

  const isHighConfidenceMatch = (
    match: PossibleMatch,
    rankedMatches: PossibleMatch[]
  ): boolean => {
    const hasStrongSignal =
      match.signals.includes("SKU exact") ||
      match.signals.includes("Identifier match");
    if (hasStrongSignal && match.score >= 0.78) return true;

    const secondBestScore = rankedMatches[1]?.score ?? 0;
    const hasClearLead = match.score - secondBestScore >= 0.08;
    if (!hasClearLead) return false;

    // Allow merge on very strong name similarity when SKU/identifier is missing.
    if (match.signals.includes("Name exact") && match.score >= 0.6) return true;
    if (match.signals.includes("Name canonical") && match.score >= 0.64) return true;
    if (match.signals.includes("Name very close") && match.score >= 0.54) return true;
    if (match.signals.includes("Name similar") && match.score >= 0.66) return true;

    return false;
  };

  const hasSourceConflict = (a: ComparisonRow, b: ComparisonRow): boolean => {
    for (const source of sources) {
      if (a[source] && b[source] && a[source]!.id !== b[source]!.id) return true;
    }
    return false;
  };

  for (let i = 0; i < working.length; i += 1) {
    if (removed.has(i)) continue;

    let mergedSomething = true;
    while (mergedSomething) {
      mergedSomething = false;
      const base = working[i];
      if (!base.isMismatch) break;

      for (const source of sources) {
        if (base[source]) continue;

        const candidateMatches = base.possibleMatches
          .filter((match) => match.source === source)
          .sort((a, b) => b.score - a.score);
        const topMatch = candidateMatches[0];
        if (!topMatch || !isHighConfidenceMatch(topMatch, candidateMatches)) continue;

        const targetRowIndex = productToRow.get(`${source}:${topMatch.product.id}`);
        if (targetRowIndex === undefined || targetRowIndex === i || removed.has(targetRowIndex)) continue;

        const target = working[targetRowIndex];
        if (hasSourceConflict(base, target)) continue;

        const mergedKey =
          base.key.startsWith("fallback:") && !target.key.startsWith("fallback:")
            ? target.key
            : base.key;

        const mergedRowBase: ComparisonRow = {
          key: mergedKey,
          internal: base.internal || target.internal,
          hubspot: base.hubspot || target.hubspot,
          zuper: base.zuper || target.zuper,
          zoho: base.zoho || target.zoho,
          opensolar: base.opensolar || target.opensolar,
          quickbooks: base.quickbooks || target.quickbooks,
          reasons: [],
          isMismatch: false,
          possibleMatches: [...base.possibleMatches, ...target.possibleMatches],
        };

        const reasons = evaluateRowReasons(mergedRowBase, sources);
        const mergedRow: ComparisonRow = {
          ...mergedRowBase,
          reasons,
          isMismatch: reasons.length > 0,
        };

        working[i] = mergedRow;
        removed.add(targetRowIndex);
        indexRowProducts(i);
        mergedSomething = true;
        break;
      }
    }
  }

  return working.filter((_, index) => !removed.has(index));
}

function createProductIdIndex(
  productsBySource: Record<SourceName, ComparableProduct[]>
): Record<SourceName, Map<string, ComparableProduct>> {
  const index = {
    internal: new Map<string, ComparableProduct>(),
    hubspot: new Map<string, ComparableProduct>(),
    zuper: new Map<string, ComparableProduct>(),
    zoho: new Map<string, ComparableProduct>(),
    opensolar: new Map<string, ComparableProduct>(),
    quickbooks: new Map<string, ComparableProduct>(),
  } as Record<SourceName, Map<string, ComparableProduct>>;

  for (const source of ALL_SOURCES) {
    for (const product of productsBySource[source]) {
      const id = String(product.id || "").trim();
      if (!id) continue;
      if (!index[source].has(id)) {
        index[source].set(id, product);
      }
    }
  }

  return index;
}

function applyInternalLinksToRows(
  rows: ComparisonRow[],
  productsById: Record<SourceName, Map<string, ComparableProduct>>,
  sources: SourceName[]
): ComparisonRow[] {
  return rows.map((row) => {
    const links = row.internal?.linkedExternalIds;
    if (!links) return row;

    const nextRow: ComparisonRow = {
      ...row,
    };
    let changed = false;

    for (const source of LINKABLE_SOURCES) {
      if (!sources.includes(source)) continue;

      const linkedId = String(links[source] || "").trim();
      if (!linkedId) continue;

      const linkedProduct = productsById[source].get(linkedId);
      if (!linkedProduct) continue;

      if (!nextRow[source] || nextRow[source]!.id !== linkedId) {
        nextRow[source] = linkedProduct;
        changed = true;
      }
    }

    if (!changed) return row;

    const duplicateReasons = row.reasons.filter((reason) => reason.startsWith("Duplicate "));
    const recalculatedReasons = evaluateRowReasons(nextRow, sources);
    const reasons = uniqueStrings([...duplicateReasons, ...recalculatedReasons]);

    return {
      ...nextRow,
      reasons,
      isMismatch: reasons.length > 0,
    };
  });
}

async function findHubSpotBundleTypePropertyName(token: string): Promise<string | null> {
  const requestTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_REQUEST_TIMEOUT_MS", 8000);
  try {
    const response = await fetchWithTimeout(
      "https://api.hubapi.com/crm/v3/properties/products?archived=false",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
      requestTimeoutMs
    );
    const rawText = await response.text();
    if (!response.ok) return null;

    const json = (rawText ? JSON.parse(rawText) : {}) as HubSpotPropertyDefinitionResponse;
    const property = (Array.isArray(json.results) ? json.results : []).find((candidate) => {
      const label = normalizeText(candidate.label);
      const name = normalizeText(candidate.name);
      return label === "bundle type" || name === "bundle type";
    });

    return String(property?.name || "").trim() || null;
  } catch {
    return null;
  }
}

function isHubSpotBundleOpen(
  properties: Record<string, string | null | undefined> | undefined,
  bundleTypePropertyName: string | null
): boolean {
  if (!properties || !bundleTypePropertyName) return false;
  return normalizeText(properties[bundleTypePropertyName]) === "open";
}

async function fetchHubSpotProducts(): Promise<{
  products: NormalizedProduct[];
  error: string | null;
  configured: boolean;
  excludedBundles: number;
  bundleTypePropertyName: string | null;
}> {
  const requestTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_REQUEST_TIMEOUT_MS", 8000);
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return {
      products: [],
      error: "HUBSPOT_ACCESS_TOKEN is not configured",
      configured: false,
      excludedBundles: 0,
      bundleTypePropertyName: null,
    };
  }

  const products: NormalizedProduct[] = [];
  const seenIds = new Set<string>();
  let excludedBundles = 0;
  const bundleTypePropertyName = await findHubSpotBundleTypePropertyName(token);
  let after: string | undefined;
  const maxPages = 200;
  const properties = [
    "name",
    "hs_sku",
    "price",
    "description",
    "hs_lastmodifieddate",
    "createdate",
    "hs_product_type",
    "hs_product_category",
    "product_type",
    "product_category",
    "item_type",
  ];
  if (bundleTypePropertyName) {
    properties.push(bundleTypePropertyName);
  }

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        limit: "100",
        archived: "false",
        properties: properties.join(","),
      });
      if (after) params.set("after", after);

      const url = `https://api.hubapi.com/crm/v3/objects/products?${params.toString()}`;
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        },
        requestTimeoutMs
      );

      const bodyText = await response.text();
      if (!response.ok) {
        const detail = bodyText || `status ${response.status}`;
        throw new Error(`HubSpot products request failed (${response.status}): ${detail}`);
      }

      const json = (bodyText ? JSON.parse(bodyText) : {}) as HubSpotObjectResponse;
      const items = Array.isArray(json.results) ? json.results : [];
      for (const item of items) {
        const id = String(item.id || "").trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        if (isHubSpotBundleOpen(item.properties, bundleTypePropertyName)) {
          excludedBundles += 1;
          continue;
        }

        const name = String(item.properties?.name || "").trim() || null;
        const sku = String(item.properties?.hs_sku || "").trim() || null;
        const price = parsePrice(item.properties?.price);
        const status = String(item.properties?.hs_product_type || "").trim() || null;
        const description = String(item.properties?.description || "").trim() || null;

        products.push({
          source: "hubspot",
          id,
          name,
          sku,
          price,
          status,
          description,
          url: buildHubSpotProductUrl(id),
          key: keyForProduct(sku, name, "hubspot", id),
          normalizedName: normalizeText(name),
        });
      }

      const nextAfter = json.paging?.next?.after;
      if (!nextAfter) break;
      after = nextAfter;
    }
  } catch (error) {
    return {
      products: [],
      error: error instanceof Error ? error.message : "Failed to fetch HubSpot products",
      configured: true,
      excludedBundles: 0,
      bundleTypePropertyName,
    };
  }

  return { products, error: null, configured: true, excludedBundles, bundleTypePropertyName };
}

async function fetchZohoProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
  if (!zohoInventory.isConfigured()) {
    const missing = zohoInventory.getMissingConfig();
    return {
      products: [],
      error: `Zoho Inventory is not configured: ${missing.join(", ")}`,
      configured: false,
    };
  }

  try {
    const items = await zohoInventory.listItems();
    const products: NormalizedProduct[] = items.map((item: ZohoInventoryItem) => {
      const id = String(item.item_id || "").trim();
      const name = String(item.name || "").trim() || null;
      const sku = String(item.sku || "").trim() || null;
      const status = String(item.status || "").trim() || null;
      const description = String((item as ZohoInventoryItem & { description?: string }).description || "").trim() || null;
      const price = typeof item.rate === "number" ? item.rate : null;

      return {
        source: "zoho",
        id,
        name,
        sku,
        price,
        status,
        description,
        url: buildZohoProductUrl(id),
        key: keyForProduct(sku, name, "zoho", id),
        normalizedName: normalizeText(name),
      };
    });

    return { products, error: null, configured: true };
  } catch (error) {
    return {
      products: [],
      error: error instanceof Error ? error.message : "Failed to fetch Zoho products",
      configured: true,
    };
  }
}

function parseZuperProduct(candidate: unknown): Omit<NormalizedProduct, "source" | "key" | "normalizedName"> | null {
  const record = coerceRecord(candidate);
  if (!record) return null;

  const id = getStringField(record, ["product_uid", "product_id", "item_uid", "item_id", "id", "uid"]);
  const name = getStringField(record, ["name", "product_name", "item_name", "title", "display_name"]);
  const sku = getStringField(record, ["sku", "product_sku", "item_code", "code"]);
  const description = getStringField(record, ["description", "product_description", "item_description", "details"]);
  const directUrl = getStringField(record, ["web_url", "url", "product_url", "product_link", "link"]);
  const status =
    getStringField(record, ["status", "state"]) ??
    (typeof record.is_active === "boolean" ? (record.is_active ? "active" : "inactive") : null);
  const price = parsePrice(
    record.price ??
      record.selling_price ??
      record.sales_rate ??
      record.unit_price ??
      record.rate ??
      record.cost_price
  );

  if (!id && !name && !sku) return null;

  const fallbackIdBase = normalizeText(`${name || ""} ${sku || ""} ${status || ""}`) || "unknown";
  const resolvedId = id || `zuper-fallback-${fallbackIdBase}`;

  return {
    id: resolvedId,
    name: name || null,
    sku: sku || null,
    price,
    status,
    description: description || null,
    url: directUrl || buildZuperProductUrl(resolvedId),
  };
}

async function fetchZuperProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
  const requestTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_REQUEST_TIMEOUT_MS", 8000);
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) {
    return { products: [], error: "ZUPER_API_KEY is not configured", configured: false };
  }

  const baseUrl = (process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api").replace(/\/$/, "");
  const endpointCandidates = [
    "/products",
    "/product",
    "/inventory/items",
    "/catalog/products",
    "/catalog/items",
  ];

  let lastError: string | null = null;

  for (const endpoint of endpointCandidates) {
    const deduped = new Map<string, NormalizedProduct>();
    const pageSize = 200;
    const maxPages = 40;

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const query = new URLSearchParams({
          page: String(page),
          count: String(pageSize),
          limit: String(pageSize),
          per_page: String(pageSize),
        });
        const url = `${baseUrl}${endpoint}?${query.toString()}`;

        const response = await fetchWithTimeout(
          url,
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
          requestTimeoutMs
        );

        if (response.status === 404 || response.status === 405) {
          lastError = `Endpoint not available: ${endpoint}`;
          break;
        }

        const rawText = await response.text();
        if (!response.ok) {
          lastError = `Zuper ${endpoint} failed (${response.status})`;
          break;
        }

        const payload = rawText ? (JSON.parse(rawText) as unknown) : {};
        const array = getNestedArrayCandidate(payload);
        if (!array || array.length === 0) break;

        for (const row of array) {
          const parsed = parseZuperProduct(row);
          if (!parsed) continue;
          const key = keyForProduct(parsed.sku, parsed.name, "zuper", parsed.id);
          const normalized: NormalizedProduct = {
            source: "zuper",
            id: parsed.id,
            name: parsed.name,
            sku: parsed.sku,
            price: parsed.price,
            status: parsed.status,
            description: parsed.description,
            url: parsed.url,
            key,
            normalizedName: normalizeText(parsed.name),
          };
          if (!deduped.has(normalized.id)) {
            deduped.set(normalized.id, normalized);
          }
        }

        const payloadRecord = coerceRecord(payload);
        const hasMoreFromPageContext = Boolean(
          coerceRecord(payloadRecord?.page_context)?.has_more_page
        );
        const totalRecordsCandidate = Number(
          payloadRecord?.total_records ??
            payloadRecord?.total ??
            coerceRecord(payloadRecord?.data)?.total_records ??
            coerceRecord(payloadRecord?.data)?.total
        );
        const hasMoreFromTotal =
          Number.isFinite(totalRecordsCandidate) &&
          totalRecordsCandidate > 0 &&
          page * pageSize < totalRecordsCandidate;

        if (!hasMoreFromPageContext && !hasMoreFromTotal && array.length < pageSize) {
          break;
        }
      }

      if (deduped.size > 0) {
        return {
          products: [...deduped.values()],
          error: null,
          configured: true,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : `Failed to fetch ${endpoint}`;
    }
  }

  return {
    products: [],
    error: lastError || "No supported Zuper product endpoint returned data",
    configured: true,
  };
}

function parseOpenSolarProduct(candidate: unknown): Omit<NormalizedProduct, "source" | "key" | "normalizedName"> | null {
  const record = coerceRecord(candidate);
  if (!record) return null;

  const id = getStringField(record, ["id", "uuid", "product_id", "productId"]);
  const name = getStringField(record, ["name", "title", "product_name", "productName", "display_name"]);
  const sku = getStringField(record, ["sku", "code", "product_sku", "part_number", "partNumber"]);
  const description = getStringField(record, ["description", "details", "product_description"]);
  const directUrl = getStringField(record, ["url", "web_url", "product_url", "product_link", "link"]);
  const status =
    getStringField(record, ["status", "state"]) ??
    (typeof record.active === "boolean" ? (record.active ? "active" : "inactive") : null);
  const price = parsePrice(record.price ?? record.unit_price ?? record.rate ?? record.selling_price);

  if (!id && !name && !sku) return null;
  const fallbackIdBase = normalizeText(`${name || ""} ${sku || ""} ${status || ""}`) || "unknown";
  const resolvedId = id || `opensolar-fallback-${fallbackIdBase}`;

  return {
    id: resolvedId,
    name: name || null,
    sku: sku || null,
    price,
    status,
    description: description || null,
    url: directUrl || buildOpenSolarProductUrl(resolvedId),
  };
}

async function fetchOpenSolarProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
  const requestTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_REQUEST_TIMEOUT_MS", 8000);
  const apiKey = process.env.OPENSOLAR_API_KEY || process.env.OPENSOLAR_ACCESS_TOKEN;
  if (!apiKey) {
    return { products: [], error: null, configured: false };
  }

  const baseUrl = (process.env.OPENSOLAR_API_URL || "https://api.opensolar.com/api").replace(/\/$/, "");
  const endpointCandidates = ["/products", "/product", "/inventory/products"];
  let lastError: string | null = null;

  for (const endpoint of endpointCandidates) {
    const deduped = new Map<string, NormalizedProduct>();
    const pageSize = 200;
    const maxPages = 30;

    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const query = new URLSearchParams({
          page: String(page),
          limit: String(pageSize),
          per_page: String(pageSize),
          page_size: String(pageSize),
        });
        const url = `${baseUrl}${endpoint}?${query.toString()}`;

        const response = await fetchWithTimeout(
          url,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
          requestTimeoutMs
        );

        if (response.status === 404 || response.status === 405) {
          lastError = `Endpoint not available: ${endpoint}`;
          break;
        }

        const rawText = await response.text();
        if (!response.ok) {
          lastError = `OpenSolar ${endpoint} failed (${response.status})`;
          break;
        }

        const payload = rawText ? (JSON.parse(rawText) as unknown) : {};
        const array = getNestedArrayCandidate(payload);
        if (!array || array.length === 0) break;

        for (const row of array) {
          const parsed = parseOpenSolarProduct(row);
          if (!parsed) continue;
          const normalized: NormalizedProduct = {
            source: "opensolar",
            id: parsed.id,
            name: parsed.name,
            sku: parsed.sku,
            price: parsed.price,
            status: parsed.status,
            description: parsed.description,
            url: parsed.url,
            key: keyForProduct(parsed.sku, parsed.name, "opensolar", parsed.id),
            normalizedName: normalizeText(parsed.name),
          };
          if (!deduped.has(normalized.id)) {
            deduped.set(normalized.id, normalized);
          }
        }

        if (array.length < pageSize) break;
      }

      if (deduped.size > 0) {
        return {
          products: [...deduped.values()],
          error: null,
          configured: true,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : `Failed to fetch ${endpoint}`;
    }
  }

  return {
    products: [],
    error: lastError || "No supported OpenSolar product endpoint returned data",
    configured: true,
  };
}

function parseQuickBooksProduct(candidate: unknown): Omit<NormalizedProduct, "source" | "key" | "normalizedName"> | null {
  const record = coerceRecord(candidate);
  if (!record) return null;

  const id = getStringField(record, ["Id", "id", "ItemId", "item_id"]);
  const name = getStringField(record, ["Name", "name", "FullyQualifiedName"]);
  const sku = getStringField(record, ["Sku", "sku", "PartNumber", "part_number"]);
  const description = getStringField(record, ["Description", "description", "FullyQualifiedName"]);
  const status =
    getStringField(record, ["Type", "type"]) ??
    (typeof record.Active === "boolean" ? (record.Active ? "active" : "inactive") : null);
  const price = parsePrice(record.UnitPrice ?? record.unit_price ?? record.PurchaseCost ?? record.rate);

  if (!id && !name && !sku) return null;
  const fallbackIdBase = normalizeText(`${name || ""} ${sku || ""} ${status || ""}`) || "unknown";
  const resolvedId = id || `quickbooks-fallback-${fallbackIdBase}`;

  return {
    id: resolvedId,
    name: name || null,
    sku: sku || null,
    price,
    status,
    description: description || null,
    url: buildQuickBooksProductUrl(resolvedId),
  };
}

async function fetchQuickBooksProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
  const requestTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_REQUEST_TIMEOUT_MS", 8000);
  const accessToken = process.env.QUICKBOOKS_ACCESS_TOKEN;
  const companyId = process.env.QUICKBOOKS_COMPANY_ID;
  if (!accessToken || !companyId) {
    return { products: [], error: null, configured: false };
  }

  const baseUrl = (process.env.QUICKBOOKS_API_BASE_URL || "https://quickbooks.api.intuit.com/v3/company").replace(/\/$/, "");
  const minorVersion = process.env.QUICKBOOKS_MINOR_VERSION || "75";
  const pageSize = 200;
  const maxPages = 30;
  const deduped = new Map<string, NormalizedProduct>();

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const startPosition = page * pageSize + 1;
      const sql = `select * from Item startposition ${startPosition} maxresults ${pageSize}`;
      const url = `${baseUrl}/${companyId}/query?query=${encodeURIComponent(sql)}&minorversion=${encodeURIComponent(minorVersion)}`;

      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/text",
          },
          cache: "no-store",
        },
        requestTimeoutMs
      );

      const rawText = await response.text();
      if (!response.ok) {
        return {
          products: [],
          error: `QuickBooks query failed (${response.status})`,
          configured: true,
        };
      }

      const payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      const queryResponse = coerceRecord(payload.QueryResponse);
      const items = Array.isArray(queryResponse?.Item) ? (queryResponse!.Item as unknown[]) : [];
      if (items.length === 0) break;

      for (const item of items) {
        const parsed = parseQuickBooksProduct(item);
        if (!parsed) continue;
        const normalized: NormalizedProduct = {
          source: "quickbooks",
          id: parsed.id,
          name: parsed.name,
          sku: parsed.sku,
          price: parsed.price,
          status: parsed.status,
          description: parsed.description,
          url: parsed.url,
          key: keyForProduct(parsed.sku, parsed.name, "quickbooks", parsed.id),
          normalizedName: normalizeText(parsed.name),
        };
        if (!deduped.has(normalized.id)) {
          deduped.set(normalized.id, normalized);
        }
      }

      if (items.length < pageSize) break;
    }
  } catch (error) {
    return {
      products: [],
      error: error instanceof Error ? error.message : "Failed to fetch QuickBooks products",
      configured: true,
    };
  }

  return {
    products: [...deduped.values()],
    error: null,
    configured: true,
  };
}

async function fetchInternalProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
  const db = prisma;
  if (!db) {
    return {
      products: [],
      error: "Database is not configured",
      configured: false,
    };
  }

  try {
    let rows: Array<{
      id: string;
      brand: string;
      model: string;
      description: string | null;
      sku: string | null;
      vendorPartNumber: string | null;
      isActive: boolean;
      hubspotProductId: string | null;
      zuperItemId: string | null;
      zohoItemId: string | null;
      quickbooksItemId: string | null;
    }>;

    try {
      rows = await db.equipmentSku.findMany({
        where: { isActive: true },
        select: {
          id: true,
          brand: true,
          model: true,
          description: true,
          sku: true,
          vendorPartNumber: true,
          isActive: true,
          hubspotProductId: true,
          zuperItemId: true,
          zohoItemId: true,
          quickbooksItemId: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 10000,
      });
    } catch (error) {
      if (!isPrismaMissingColumnError(error)) throw error;
      const legacy = await db.equipmentSku.findMany({
        where: { isActive: true },
        select: {
          id: true,
          brand: true,
          model: true,
          description: true,
          sku: true,
          vendorPartNumber: true,
          isActive: true,
          hubspotProductId: true,
          zuperItemId: true,
          zohoItemId: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 10000,
      });
      rows = legacy.map((row) => ({ ...row, quickbooksItemId: null }));
    }

    const products: NormalizedProduct[] = rows.map((row) => {
      const combinedName = `${String(row.brand || "").trim()} ${String(row.model || "").trim()}`.trim() || null;
      const internalSku = String(row.sku || row.vendorPartNumber || "").trim() || null;
      const status = row.isActive ? "active" : "inactive";

      return {
        source: "internal",
        id: row.id,
        name: combinedName,
        sku: internalSku,
        price: null,
        status,
        description: String(row.description || "").trim() || null,
        url: `/dashboards/catalog/edit/${encodeURIComponent(row.id)}`,
        key: keyForProduct(internalSku, combinedName, "internal", row.id),
        normalizedName: normalizeText(combinedName),
        linkedExternalIds: {
          hubspot: String(row.hubspotProductId || "").trim() || null,
          zuper: String(row.zuperItemId || "").trim() || null,
          zoho: String(row.zohoItemId || "").trim() || null,
          quickbooks: String(row.quickbooksItemId || "").trim() || null,
        },
      };
    });

    return { products, error: null, configured: true };
  } catch (error) {
    return {
      products: [],
      error: error instanceof Error ? error.message : "Failed to fetch internal catalog",
      configured: true,
    };
  }
}

function createGroupedProductBuckets(): Record<SourceName, NormalizedProduct[]> {
  return {
    internal: [],
    hubspot: [],
    zuper: [],
    zoho: [],
    opensolar: [],
    quickbooks: [],
  };
}

function sourceFromCacheEnum(source: CatalogProductSource): CacheSourceName {
  const map: Record<CatalogProductSource, CacheSourceName> = {
    HUBSPOT: "hubspot",
    ZUPER: "zuper",
    ZOHO: "zoho",
    QUICKBOOKS: "quickbooks",
    OPENSOLAR: "opensolar",
  };
  return map[source];
}

function normalizeForCache(source: CacheSourceName, product: NormalizedProduct): NormalizedProduct {
  const id = String(product.id || "").trim();
  const name = product.name || null;
  const sku = product.sku || null;
  return {
    source,
    id,
    name,
    sku,
    price: product.price ?? null,
    status: product.status ?? null,
    description: product.description ?? null,
    url: product.url ?? null,
    key: keyForProduct(sku, name, source, id),
    normalizedName: normalizeText(name),
  };
}

async function saveProductsToCache(source: CacheSourceName, products: NormalizedProduct[]): Promise<void> {
  const db = prisma;
  if (!db || products.length === 0) return;

  const sourceEnum = CACHE_SOURCE_ENUM[source];
  const deduped = new Map<string, NormalizedProduct>();
  for (const product of products) {
    const normalized = normalizeForCache(source, product);
    if (!normalized.id) continue;
    deduped.set(normalized.id, normalized);
  }
  if (deduped.size === 0) return;

  const rows = [...deduped.values()];
  const now = new Date();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await Promise.all(
      chunk.map((product) =>
        db.catalogProduct.upsert({
          where: {
            source_externalId: {
              source: sourceEnum,
              externalId: product.id,
            },
          },
          update: {
            name: product.name,
            sku: product.sku,
            normalizedName: normalizeText(product.name),
            normalizedSku: normalizeSku(product.sku),
            description: product.description,
            price: product.price,
            status: product.status,
            url: product.url,
            lastSyncedAt: now,
          },
          create: {
            source: sourceEnum,
            externalId: product.id,
            name: product.name,
            sku: product.sku,
            normalizedName: normalizeText(product.name),
            normalizedSku: normalizeSku(product.sku),
            description: product.description,
            price: product.price,
            status: product.status,
            url: product.url,
            lastSyncedAt: now,
          },
        })
      )
    );
  }
}

async function loadProductsFromCache(source: CacheSourceName): Promise<NormalizedProduct[]> {
  const db = prisma;
  if (!db) return [];

  const rows = await db.catalogProduct.findMany({
    where: { source: CACHE_SOURCE_ENUM[source] },
    orderBy: { updatedAt: "desc" },
    take: 10000,
  });

  return rows.map((row) => {
    const normalizedSource = sourceFromCacheEnum(row.source);
    return {
      source: normalizedSource,
      id: row.externalId,
      name: row.name,
      sku: row.sku,
      price: row.price,
      status: row.status,
      description: row.description,
      url: row.url,
      key: keyForProduct(row.sku, row.name, normalizedSource, row.externalId),
      normalizedName: normalizeText(row.name),
    };
  });
}

function collectInternalLinkedIds(
  internalProducts: NormalizedProduct[]
): Record<LinkableSourceName, Set<string>> {
  const linkedBySource: Record<LinkableSourceName, Set<string>> = {
    hubspot: new Set<string>(),
    zuper: new Set<string>(),
    zoho: new Set<string>(),
    quickbooks: new Set<string>(),
  };

  for (const product of internalProducts) {
    for (const source of LINKABLE_SOURCES) {
      const linkedId = String(product.linkedExternalIds?.[source] || "").trim();
      if (linkedId) linkedBySource[source].add(linkedId);
    }
  }

  return linkedBySource;
}

async function backfillLinkedProductsFromCache(
  internalProducts: NormalizedProduct[],
  productsBySource: Record<SourceName, ComparableProduct[]>
): Promise<{ productsBySource: Record<SourceName, ComparableProduct[]>; warnings: string[] }> {
  const db = prisma;
  if (!db || internalProducts.length === 0) {
    return { productsBySource, warnings: [] };
  }

  const linkedBySource = collectInternalLinkedIds(internalProducts);
  const hydratedProductsBySource: Record<SourceName, ComparableProduct[]> = {
    internal: [...productsBySource.internal],
    hubspot: [...productsBySource.hubspot],
    zuper: [...productsBySource.zuper],
    zoho: [...productsBySource.zoho],
    opensolar: [...productsBySource.opensolar],
    quickbooks: [...productsBySource.quickbooks],
  };
  const warnings: string[] = [];

  for (const source of LINKABLE_SOURCES) {
    const requestedIds = [...linkedBySource[source]];
    if (!requestedIds.length) continue;

    const existingIds = new Set(
      hydratedProductsBySource[source]
        .map((product) => String(product.id || "").trim())
        .filter(Boolean)
    );
    const missingIds = requestedIds.filter((id) => !existingIds.has(id));
    if (!missingIds.length) continue;

    const cachedRows = await db.catalogProduct.findMany({
      where: {
        source: CACHE_SOURCE_ENUM[source],
        externalId: { in: missingIds },
      },
      select: {
        externalId: true,
        name: true,
        sku: true,
        price: true,
        status: true,
        description: true,
        url: true,
      },
    });

    let hydratedCount = 0;
    for (const row of cachedRows) {
      const id = String(row.externalId || "").trim();
      if (!id || existingIds.has(id)) continue;
      hydratedProductsBySource[source].push({
        id,
        name: row.name,
        sku: row.sku,
        price: row.price,
        status: row.status,
        description: row.description,
        url: row.url,
      });
      existingIds.add(id);
      hydratedCount += 1;
    }

    if (hydratedCount > 0) {
      warnings.push(
        `${SOURCE_LABELS[source]} link hydration backfilled ${hydratedCount} linked product${hydratedCount === 1 ? "" : "s"} from cache`
      );
    }
  }

  return { productsBySource: hydratedProductsBySource, warnings };
}

async function hydrateSourceWithCache(source: CacheSourceName, result: SourceFetchResult): Promise<{
  result: SourceFetchResult;
  warning: string | null;
}> {
  const db = prisma;
  if (!db) return { result, warning: null };

  try {
    if (result.products.length > 0) {
      // Never block the API response on cache writes; this endpoint is user-facing.
      const cacheWriteTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_CACHE_WRITE_TIMEOUT_MS", 1500);
      void withTimeout(
        saveProductsToCache(source, result.products),
        cacheWriteTimeoutMs,
        `${SOURCE_LABELS[source]} cache write`
      ).catch((error) => {
        console.warn(
          "[products/comparison] cache write skipped for %s: %s",
          source,
          error instanceof Error ? error.message : "unknown error"
        );
      });
      return { result, warning: null };
    }

    const cachedProducts = await loadProductsFromCache(source);
    if (cachedProducts.length === 0) return { result, warning: null };

    const warning = result.error
      ? `${SOURCE_LABELS[source]} live fetch failed; using ${cachedProducts.length} cached products`
      : `${SOURCE_LABELS[source]} returned no products; using ${cachedProducts.length} cached products`;

    return {
      result: {
        products: cachedProducts,
        configured: true,
        error: result.error,
      },
      warning,
    };
  } catch (error) {
    return {
      result,
      warning: `Catalog cache unavailable for ${SOURCE_LABELS[source]}: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

function buildComparisonRows(products: NormalizedProduct[], sources: SourceName[]): ComparisonRow[] {
  const grouped = new Map<string, Record<SourceName, NormalizedProduct[]>>();

  for (const product of products) {
    if (!grouped.has(product.key)) {
      grouped.set(product.key, createGroupedProductBuckets());
    }
    grouped.get(product.key)![product.source].push(product);
  }

  const rows: ComparisonRow[] = [];
  for (const [key, group] of grouped) {
    const reasons: string[] = [];

    for (const source of sources) {
      if (group[source].length === 0) reasons.push(missingReasonForSource(source));
      if (group[source].length > 1) {
        reasons.push(`Duplicate ${SOURCE_LABELS[source]} entries (${group[source].length})`);
      }
    }

    const primaryRow: RowProducts = {
      internal: pickPrimaryInternal(group.internal),
      hubspot: pickPrimary(group.hubspot),
      zuper: pickPrimary(group.zuper),
      zoho: pickPrimary(group.zoho),
      opensolar: pickPrimary(group.opensolar),
      quickbooks: pickPrimary(group.quickbooks),
    };
    reasons.push(...evaluateRowReasons(primaryRow, sources));
    const dedupedReasons = uniqueStrings(reasons);

    rows.push({
      key,
      ...primaryRow,
      reasons: dedupedReasons,
      isMismatch: dedupedReasons.length > 0,
      possibleMatches: [],
    });
  }

  return rows.sort((a, b) => {
    if (a.isMismatch !== b.isMismatch) return a.isMismatch ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const rawRole = (dbUser?.role ?? authResult.role) as UserRole;
  const role = normalizeRole(rawRole);

  if (!isAllowedRole(role)) {
    return NextResponse.json(
      { error: "Admin or owner access required" },
      { status: 403 }
    );
  }

  const sourceTimeoutMs = parsePositiveIntEnv("PRODUCT_COMPARISON_SOURCE_TIMEOUT_MS", 12000);
  const [internalResult, hubspotResult, zuperResult, zohoResult, opensolarResult, quickbooksResult] = await Promise.all([
    withTimeout(fetchInternalProducts(), sourceTimeoutMs, "Internal catalog fetch").catch((error) => ({
      products: [],
      configured: Boolean(prisma),
      error: asErrorMessage(error, "Internal catalog fetch timed out"),
    })),
    withTimeout(fetchHubSpotProducts(), sourceTimeoutMs, "HubSpot catalog fetch").catch((error) => ({
      products: [],
      configured: Boolean(process.env.HUBSPOT_ACCESS_TOKEN),
      error: asErrorMessage(error, "HubSpot catalog fetch timed out"),
      excludedBundles: 0,
      bundleTypePropertyName: null,
    })),
    withTimeout(fetchZuperProducts(), sourceTimeoutMs, "Zuper catalog fetch").catch((error) => ({
      products: [],
      configured: Boolean(process.env.ZUPER_API_KEY),
      error: asErrorMessage(error, "Zuper catalog fetch timed out"),
    })),
    withTimeout(fetchZohoProducts(), sourceTimeoutMs, "Zoho catalog fetch").catch((error) => ({
      products: [],
      configured: zohoInventory.isConfigured(),
      error: asErrorMessage(error, "Zoho catalog fetch timed out"),
    })),
    withTimeout(fetchOpenSolarProducts(), sourceTimeoutMs, "OpenSolar catalog fetch").catch((error) => ({
      products: [],
      configured: Boolean(process.env.OPENSOLAR_API_KEY || process.env.OPENSOLAR_ACCESS_TOKEN),
      error: asErrorMessage(error, "OpenSolar catalog fetch timed out"),
    })),
    withTimeout(fetchQuickBooksProducts(), sourceTimeoutMs, "QuickBooks catalog fetch").catch((error) => ({
      products: [],
      configured: Boolean(process.env.QUICKBOOKS_ACCESS_TOKEN && process.env.QUICKBOOKS_COMPANY_ID),
      error: asErrorMessage(error, "QuickBooks catalog fetch timed out"),
    })),
  ]);

  const [hubspotCache, zuperCache, zohoCache, quickbooksCache, opensolarCache] = await Promise.all([
    hydrateSourceWithCache("hubspot", {
      products: hubspotResult.products,
      configured: hubspotResult.configured,
      error: hubspotResult.error,
    }),
    hydrateSourceWithCache("zuper", {
      products: zuperResult.products,
      configured: zuperResult.configured,
      error: zuperResult.error,
    }),
    hydrateSourceWithCache("zoho", {
      products: zohoResult.products,
      configured: zohoResult.configured,
      error: zohoResult.error,
    }),
    hydrateSourceWithCache("quickbooks", {
      products: quickbooksResult.products,
      configured: quickbooksResult.configured,
      error: quickbooksResult.error,
    }),
    hydrateSourceWithCache("opensolar", {
      products: opensolarResult.products,
      configured: opensolarResult.configured,
      error: opensolarResult.error,
    }),
  ]);

  const effectiveHubspotResult = {
    ...hubspotResult,
    products: hubspotCache.result.products,
    configured: hubspotCache.result.configured,
    error: hubspotCache.result.error,
  };
  const effectiveZuperResult = {
    ...zuperResult,
    products: zuperCache.result.products,
    configured: zuperCache.result.configured,
    error: zuperCache.result.error,
  };
  const effectiveZohoResult = {
    ...zohoResult,
    products: zohoCache.result.products,
    configured: zohoCache.result.configured,
    error: zohoCache.result.error,
  };
  const effectiveQuickbooksResult = {
    ...quickbooksResult,
    products: quickbooksCache.result.products,
    configured: quickbooksCache.result.configured,
    error: quickbooksCache.result.error,
  };
  const effectiveOpensolarResult = {
    ...opensolarResult,
    products: opensolarCache.result.products,
    configured: opensolarCache.result.configured,
    error: opensolarCache.result.error,
  };

  const productCapPerSource = parsePositiveIntEnv("PRODUCT_COMPARISON_MAX_PRODUCTS_PER_SOURCE", 2500);
  const performanceWarnings: string[] = [];
  const capProducts = <T extends SourceFetchResult>(source: SourceName, result: T): T => {
    if (result.products.length <= productCapPerSource) return result;
    performanceWarnings.push(
      `${SOURCE_LABELS[source]} products capped at ${productCapPerSource} for performance (from ${result.products.length})`
    );
    return {
      ...result,
      products: result.products.slice(0, productCapPerSource),
    };
  };

  const boundedInternalResult = capProducts("internal", internalResult);
  const boundedHubspotResult = capProducts("hubspot", effectiveHubspotResult);
  const boundedZuperResult = capProducts("zuper", effectiveZuperResult);
  const boundedZohoResult = capProducts("zoho", effectiveZohoResult);
  const boundedOpensolarResult = capProducts("opensolar", effectiveOpensolarResult);
  const boundedQuickbooksResult = capProducts("quickbooks", effectiveQuickbooksResult);

  const sourceResults = {
    internal: boundedInternalResult,
    hubspot: boundedHubspotResult,
    zuper: boundedZuperResult,
    zoho: boundedZohoResult,
    opensolar: boundedOpensolarResult,
    quickbooks: boundedQuickbooksResult,
  } as const;
  const comparisonSources = ALL_SOURCES.filter((source) => sourceResults[source].configured);

  const allProducts = [
    ...boundedInternalResult.products,
    ...boundedHubspotResult.products,
    ...boundedZuperResult.products,
    ...boundedZohoResult.products,
    ...boundedOpensolarResult.products,
    ...boundedQuickbooksResult.products,
  ];
  const rows = buildComparisonRows(allProducts, comparisonSources);
  const productsBySourceBase: Record<SourceName, ComparableProduct[]> = {
    internal: boundedInternalResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    hubspot: boundedHubspotResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    zuper: boundedZuperResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    zoho: boundedZohoResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    opensolar: boundedOpensolarResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    quickbooks: boundedQuickbooksResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
  };
  const linkedCacheBackfill = await backfillLinkedProductsFromCache(
    boundedInternalResult.products,
    productsBySourceBase
  );
  const productsBySource = linkedCacheBackfill.productsBySource;
  const exactMatchIndex = createExactMatchIndex(productsBySource);
  const productsBySourceId = createProductIdIndex(productsBySource);
  const matchingRowCap = parsePositiveIntEnv("PRODUCT_COMPARISON_MAX_ROWS_FOR_MATCHING", 1500);
  const enrichedRows =
    rows.length > matchingRowCap
      ? (() => {
          performanceWarnings.push(
            `Full possible-match scoring skipped for performance (rows=${rows.length}, cap=${matchingRowCap}); using exact SKU/name suggestions`
          );
          const linkedRows = applyInternalLinksToRows(rows, productsBySourceId, comparisonSources);
          return linkedRows.map((row) => ({
            ...row,
            possibleMatches: buildFastPossibleMatches(row, exactMatchIndex, comparisonSources),
          }));
        })()
      : (() => {
          const initialRows = rows.map((row) => ({
            ...row,
            possibleMatches: buildPossibleMatches(row, productsBySource, comparisonSources),
          }));
          const mergedRows = autoMergeRows(initialRows, comparisonSources);
          const linkedRows = applyInternalLinksToRows(mergedRows, productsBySourceId, comparisonSources);
          return linkedRows.map((row) => ({
            ...row,
            possibleMatches: buildPossibleMatches(row, productsBySource, comparisonSources),
          }));
        })();

  const mismatchRows = enrichedRows.filter((row) => row.isMismatch).length;
  const missingBySource = {
    internal: sourceResults.internal.configured ? enrichedRows.filter((row) => row.internal === null).length : 0,
    hubspot: sourceResults.hubspot.configured ? enrichedRows.filter((row) => row.hubspot === null).length : 0,
    zuper: sourceResults.zuper.configured ? enrichedRows.filter((row) => row.zuper === null).length : 0,
    zoho: sourceResults.zoho.configured ? enrichedRows.filter((row) => row.zoho === null).length : 0,
    opensolar: sourceResults.opensolar.configured ? enrichedRows.filter((row) => row.opensolar === null).length : 0,
    quickbooks: sourceResults.quickbooks.configured ? enrichedRows.filter((row) => row.quickbooks === null).length : 0,
  };

  const warnings = [
    ...ALL_SOURCES
    .map((source) => sourceResults[source].error)
    .filter(Boolean) as string[],
    ...[hubspotCache, zuperCache, zohoCache, quickbooksCache, opensolarCache]
      .map((c) => c.warning)
      .filter(Boolean) as string[],
    ...linkedCacheBackfill.warnings,
    ...performanceWarnings,
  ];

  const payload: ProductComparisonResponse = {
    rows: enrichedRows,
    summary: {
      totalRows: enrichedRows.length,
      mismatchRows,
      fullyMatchedRows: enrichedRows.length - mismatchRows,
      missingBySource,
      sourceCounts: {
        internal: boundedInternalResult.products.length,
        hubspot: boundedHubspotResult.products.length,
        zuper: boundedZuperResult.products.length,
        zoho: boundedZohoResult.products.length,
        opensolar: boundedOpensolarResult.products.length,
        quickbooks: boundedQuickbooksResult.products.length,
      },
    },
    health: {
      internal: {
        configured: boundedInternalResult.configured,
        count: boundedInternalResult.products.length,
        error: boundedInternalResult.error,
      },
      hubspot: {
        configured: boundedHubspotResult.configured,
        count: boundedHubspotResult.products.length,
        error: boundedHubspotResult.error,
      },
      zuper: {
        configured: boundedZuperResult.configured,
        count: boundedZuperResult.products.length,
        error: boundedZuperResult.error,
      },
      zoho: {
        configured: boundedZohoResult.configured,
        count: boundedZohoResult.products.length,
        error: boundedZohoResult.error,
      },
      opensolar: {
        configured: boundedOpensolarResult.configured,
        count: boundedOpensolarResult.products.length,
        error: boundedOpensolarResult.error,
      },
      quickbooks: {
        configured: boundedQuickbooksResult.configured,
        count: boundedQuickbooksResult.products.length,
        error: boundedQuickbooksResult.error,
      },
    },
    warnings,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(payload);
}
