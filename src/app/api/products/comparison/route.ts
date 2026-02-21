import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { zohoInventory, type ZohoInventoryItem } from "@/lib/zoho-inventory";

type SourceName = "hubspot" | "zuper" | "zoho";

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
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

interface ComparisonRow {
  key: string;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
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
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
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
  return {
    id: first.id,
    name: first.name,
    sku: first.sku,
    price: first.price,
    status: first.status,
    description: first.description,
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

function tokenize(value: string | null | undefined): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((token) => token.length >= 3));
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
    }
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
    }
  }

  return { score: Math.min(1, Number(score.toFixed(3))), signals };
}

function quickProductFilter(anchorProducts: ComparableProduct[], candidate: ComparableProduct): boolean {
  const candidateSku = normalizeSku(candidate.sku);
  const candidateTokens = tokenize(candidate.name);

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

    const overlap = tokenSimilarity(tokenize(anchor.name), candidateTokens);
    if (overlap >= 0.2) return true;

    if (typeof anchor.price === "number" && typeof candidate.price === "number" && anchor.price > 0 && candidate.price > 0) {
      const diffRatio = Math.abs(anchor.price - candidate.price) / Math.max(anchor.price, candidate.price);
      if (diffRatio <= 0.25) return true;
    }
  }

  return false;
}

function buildPossibleMatches(
  row: ComparisonRow,
  productsBySource: Record<SourceName, ComparableProduct[]>
): PossibleMatch[] {
  if (!row.isMismatch) return [];

  const anchors = [row.hubspot, row.zuper, row.zoho].filter(Boolean) as ComparableProduct[];
  if (anchors.length === 0) return [];

  const missingSources = (["hubspot", "zuper", "zoho"] as SourceName[]).filter((source) => row[source] === null);
  if (missingSources.length === 0) return [];

  const threshold = 0.45;
  const maxPerSource = 3;
  const possibleMatches: PossibleMatch[] = [];

  for (const source of missingSources) {
    const candidates: Array<{ product: ComparableProduct; score: number; signals: string[] }> = [];
    for (const candidate of productsBySource[source]) {
      if (!quickProductFilter(anchors, candidate)) continue;

      let bestScore = 0;
      let bestSignals: string[] = [];

      for (const anchor of anchors) {
        const result = compareProducts(anchor, candidate);
        if (result.score > bestScore) {
          bestScore = result.score;
          bestSignals = result.signals;
        }
      }

      if (bestScore >= threshold) {
        candidates.push({ product: candidate, score: bestScore, signals: bestSignals });
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

  return possibleMatches;
}

function isHubSpotBundle(properties: Record<string, string | null | undefined> | undefined): boolean {
  if (!properties) return false;

  const productType = normalizeText(properties.hs_product_type);
  if (productType.includes("bundle")) return true;

  const sku = normalizeSku(properties.hs_sku);
  if (sku.startsWith("BUNDLE-") || sku.endsWith("-BUNDLE") || sku.includes("-BUNDLE-")) return true;

  // Fallback for accounts that don't expose a dedicated bundle type.
  if (!productType) {
    const name = normalizeText(properties.name);
    if (name.includes(" bundle ") || name.startsWith("bundle ") || name.endsWith(" bundle")) return true;
  }

  return false;
}

async function fetchHubSpotProducts(): Promise<{
  products: NormalizedProduct[];
  error: string | null;
  configured: boolean;
  excludedBundles: number;
}> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return {
      products: [],
      error: "HUBSPOT_ACCESS_TOKEN is not configured",
      configured: false,
      excludedBundles: 0,
    };
  }

  const products: NormalizedProduct[] = [];
  const seenIds = new Set<string>();
  let excludedBundles = 0;
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
  ];

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        limit: "100",
        archived: "false",
        properties: properties.join(","),
      });
      if (after) params.set("after", after);

      const url = `https://api.hubapi.com/crm/v3/objects/products?${params.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

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
        if (isHubSpotBundle(item.properties)) {
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
    };
  }

  return { products, error: null, configured: true, excludedBundles };
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
      const price = null;

      return {
        source: "zoho",
        id,
        name,
        sku,
        price,
        status,
        description,
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

  return {
    id: id || `zuper-fallback-${fallbackIdBase}`,
    name: name || null,
    sku: sku || null,
    price,
    status,
    description: description || null,
  };
}

async function fetchZuperProducts(): Promise<{ products: NormalizedProduct[]; error: string | null; configured: boolean }> {
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

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

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

function buildComparisonRows(products: NormalizedProduct[]): ComparisonRow[] {
  const grouped = new Map<
    string,
    { hubspot: NormalizedProduct[]; zuper: NormalizedProduct[]; zoho: NormalizedProduct[] }
  >();

  for (const product of products) {
    if (!grouped.has(product.key)) {
      grouped.set(product.key, { hubspot: [], zuper: [], zoho: [] });
    }
    grouped.get(product.key)![product.source].push(product);
  }

  const rows: ComparisonRow[] = [];
  for (const [key, group] of grouped) {
    const reasons: string[] = [];

    if (group.hubspot.length === 0) reasons.push("Missing in HubSpot");
    if (group.zuper.length === 0) reasons.push("Missing in Zuper");
    if (group.zoho.length === 0) reasons.push("Missing in Zoho");

    if (group.hubspot.length > 1) reasons.push(`Duplicate HubSpot entries (${group.hubspot.length})`);
    if (group.zuper.length > 1) reasons.push(`Duplicate Zuper entries (${group.zuper.length})`);
    if (group.zoho.length > 1) reasons.push(`Duplicate Zoho entries (${group.zoho.length})`);

    const present = [group.hubspot[0], group.zuper[0], group.zoho[0]].filter(Boolean) as NormalizedProduct[];
    const names = new Set(present.map((p) => p.normalizedName).filter(Boolean));
    if (names.size > 1) reasons.push("Product name mismatch");

    const skus = new Set(present.map((p) => normalizeSku(p.sku)).filter(Boolean));
    if (skus.size > 1) reasons.push("SKU mismatch");

    const numericPrices = present
      .map((p) => p.price)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p))
      .map((p) => Number(p.toFixed(2)));
    if (numericPrices.length >= 2) {
      const uniquePrices = new Set(numericPrices);
      if (uniquePrices.size > 1) reasons.push("Price mismatch");
    }

    rows.push({
      key,
      hubspot: pickPrimary(group.hubspot),
      zuper: pickPrimary(group.zuper),
      zoho: pickPrimary(group.zoho),
      reasons,
      isMismatch: reasons.length > 0,
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

  const [hubspotResult, zuperResult, zohoResult] = await Promise.all([
    fetchHubSpotProducts(),
    fetchZuperProducts(),
    fetchZohoProducts(),
  ]);

  const allProducts = [
    ...hubspotResult.products,
    ...zuperResult.products,
    ...zohoResult.products,
  ];
  const rows = buildComparisonRows(allProducts);
  const productsBySource: Record<SourceName, ComparableProduct[]> = {
    hubspot: hubspotResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    zuper: zuperResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
    zoho: zohoResult.products.map((p) => pickPrimary([p])).filter(Boolean) as ComparableProduct[],
  };
  const enrichedRows = rows.map((row) => ({
    ...row,
    possibleMatches: buildPossibleMatches(row, productsBySource),
  }));

  const mismatchRows = enrichedRows.filter((row) => row.isMismatch).length;
  const missingBySource = {
    hubspot: enrichedRows.filter((row) => row.hubspot === null).length,
    zuper: enrichedRows.filter((row) => row.zuper === null).length,
    zoho: enrichedRows.filter((row) => row.zoho === null).length,
  };

  const warnings = [hubspotResult.error, zuperResult.error, zohoResult.error].filter(Boolean) as string[];
  if (hubspotResult.excludedBundles > 0) {
    warnings.push(`Excluded ${hubspotResult.excludedBundles} HubSpot product bundle${hubspotResult.excludedBundles === 1 ? "" : "s"}.`);
  }

  const payload: ProductComparisonResponse = {
    rows: enrichedRows,
    summary: {
      totalRows: enrichedRows.length,
      mismatchRows,
      fullyMatchedRows: enrichedRows.length - mismatchRows,
      missingBySource,
      sourceCounts: {
        hubspot: hubspotResult.products.length,
        zuper: zuperResult.products.length,
        zoho: zohoResult.products.length,
      },
    },
    health: {
      hubspot: {
        configured: hubspotResult.configured,
        count: hubspotResult.products.length,
        error: hubspotResult.error,
      },
      zuper: {
        configured: zuperResult.configured,
        count: zuperResult.products.length,
        error: zuperResult.error,
      },
      zoho: {
        configured: zohoResult.configured,
        count: zohoResult.products.length,
        error: zohoResult.error,
      },
    },
    warnings,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(payload);
}
