const DEFAULT_ZUPER_API_URL = "https://us-west-1c.zuperpro.com/api";

type JsonRecord = Record<string, unknown>;

const ITEM_ID_KEYS = [
  "item_uid",
  "item_id",
  "part_uid",
  "part_id",
  "product_uid",
  "product_id",
  "uid",
  "id",
] as const;
const DEFAULT_CATALOG_ENDPOINTS = [
  "/product",
] as const;

/** Zuper product_type must be one of these uppercase values. */
const VALID_PRODUCT_TYPES = ["PRODUCT", "SERVICE", "PARTS", "BUNDLE", "LABOR"] as const;

/**
 * Static fallback map of category names → Zuper product_category UIDs.
 * Used only when the live API fetch fails. The resolver prefers live data
 * so that new Zuper categories are picked up automatically.
 *
 * This map covers ALL product categories that currently exist in Zuper.
 * Categories in catalog-fields.ts like "Solar Panel", "EV Charger", etc.
 * don't have matching Zuper product categories yet — they fall back to
 * "General" with a console.warn until those categories are created in Zuper.
 */
const ZUPER_CATEGORY_UID_FALLBACK: Record<string, string> = {
  "battery": "7e926259-0552-41e6-b936-547543c209c6",
  "battery expansion": "7b1c6e98-e26f-4c2b-8ef6-d3e5471269ce",
  "inverter": "e21286e7-33a1-4e19-8981-790fb1c16d56",
  "relay device": "ea843bd0-dd5f-4211-8c59-c5dccaac2fa9",
  "invoicing": "24afea80-4196-4db6-a4f1-59260390f563",
  "general": "de36210d-534a-48cb-980d-1bb1eb2f8201",
};
const ZUPER_DEFAULT_CATEGORY_UID = ZUPER_CATEGORY_UID_FALLBACK["general"];

/** In-memory cache for Zuper product categories (name → UID). */
let _categoryCache: Record<string, string> | null = null;
let _categoryCacheExpiry = 0;
const CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Reset the in-memory category cache (for tests). */
export function _resetCategoryCache(): void {
  _categoryCache = null;
  _categoryCacheExpiry = 0;
}

/** Fetch product categories from Zuper and cache them. Falls back to static map on failure. */
async function getCategoryMap(): Promise<Record<string, string>> {
  if (_categoryCache && Date.now() < _categoryCacheExpiry) {
    return _categoryCache;
  }

  const apiKey = process.env.ZUPER_API_KEY;
  const baseUrl = process.env.ZUPER_API_URL || DEFAULT_ZUPER_API_URL;
  if (!apiKey) return ZUPER_CATEGORY_UID_FALLBACK;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${baseUrl}/product_categories?count=200&page=1`, {
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[zuper-catalog] Failed to fetch categories: ${res.status}`);
      return ZUPER_CATEGORY_UID_FALLBACK;
    }

    const rawText = await res.text();
    const json = rawText ? JSON.parse(rawText) : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories: any[] = json?.data || json?.product_categories || [];
    const map: Record<string, string> = {};
    for (const cat of categories) {
      const name = cat.product_category_name || cat.name || cat.category_name;
      const uid = cat.product_category_uid || cat.uid || cat.id;
      if (name && uid) {
        map[String(name).toLowerCase().trim()] = String(uid);
      }
    }

    if (Object.keys(map).length > 0) {
      _categoryCache = map;
      _categoryCacheExpiry = Date.now() + CATEGORY_CACHE_TTL_MS;
      return map;
    }
  } catch (err) {
    console.warn("[zuper-catalog] Category fetch error, using fallback:", err);
  }

  return ZUPER_CATEGORY_UID_FALLBACK;
}

/** Resolve a category name or UID to a valid Zuper category UID. */
async function resolveZuperCategoryUid(category: string | undefined): Promise<string> {
  if (!category) return ZUPER_DEFAULT_CATEGORY_UID;
  // Already a UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category)) {
    return category;
  }
  const key = category.toLowerCase().trim();
  const map = await getCategoryMap();
  const uid = map[key];
  if (!uid) {
    const source = map === ZUPER_CATEGORY_UID_FALLBACK ? "static fallback" : "live";
    console.warn(
      `[zuper-catalog] Category "${category}" not found in ${source} map — defaulting to General`
    );
    return ZUPER_DEFAULT_CATEGORY_UID;
  }
  return uid;
}

export interface UpsertZuperPartInput {
  brand: string;
  model: string;
  description?: string | null;
  sku?: string | null;
  unitLabel?: string | null;
  vendorName?: string | null;
  vendorPartNumber?: string | null;
  sellPrice?: number | null;
  unitCost?: number | null;
  category?: string | null;
  specification?: string | null;
}

export interface UpsertZuperPartResult {
  zuperItemId: string;
  created: boolean;
}

export interface UpdateZuperPartResult {
  status: "updated" | "not_found" | "unsupported" | "failed";
  zuperItemId: string;
  message: string;
  httpStatus?: number;
}

interface ZuperIdentity {
  name: string;
  sku?: string;
  model?: string;
  partNumber?: string;
  category?: string;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

function isNotFoundError(error: unknown): boolean {
  return /\bHTTP\s*404\b/i.test(getErrorMessage(error));
}

function getEndpointPath(endpoint: string): string {
  const trimmed = String(endpoint || "").trim();
  if (!trimmed) return "/";
  const [path] = trimmed.split("?");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function getCatalogEndpoints(): string[] {
  const configured = trimOrUndefined(process.env.ZUPER_CATALOG_ENDPOINTS);
  const rawEndpoints = configured
    ? configured.split(",").map((value) => value.trim()).filter(Boolean)
    : [...DEFAULT_CATALOG_ENDPOINTS];
  const normalized = rawEndpoints.map((endpoint) => {
    const withLeadingSlash = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return withLeadingSlash.replace(/\/+$/, "") || "/";
  });
  return [...new Set(normalized)];
}

function getRecordString(record: JsonRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    const trimmed = trimOrUndefined(value);
    if (trimmed) return trimmed;
  }
  return undefined;
}

function extractRecords(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 4 || value == null) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractRecords(item, depth + 1));
  }

  if (!isRecord(value)) return [];

  const records: JsonRecord[] = [value];
  const nestedKeys = [
    "data",
    "item",
    "items",
    "part",
    "parts",
    "product",
    "products",
    "product_data",
    "product_category",
    "result",
    "results",
    "records",
  ] as const;
  for (const key of nestedKeys) {
    records.push(...extractRecords(value[key], depth + 1));
  }
  return records;
}

function extractZuperItemId(value: unknown): string | undefined {
  const records = extractRecords(value);
  for (const record of records) {
    for (const key of ITEM_ID_KEYS) {
      const id = trimOrUndefined(record[key]);
      if (id) return id;
    }
  }
  return undefined;
}

function matchesIdentity(record: JsonRecord, identity: ZuperIdentity): boolean {
  const recordSku = getRecordString(record, [
    "sku",
    "item_sku",
    "item_code",
    "code",
    "product_no",
    "product_id",
    "vendor_part_number",
    "part_number",
    "model",
  ]);
  const recordPart = getRecordString(record, ["part_number", "product_no", "vendor_part_number", "model", "item_code", "product_id"]);
  const recordName = getRecordString(record, ["name", "item_name", "part_name", "product_name", "title", "display_name"]);
  const recordCategory = getRecordString(record, [
    "category",
    "category_name",
    "product_category",
    "product_category_name",
    "item_category",
    "part_category",
    "type",
  ]);

  const skuNorm = normalizeName(identity.sku);
  const modelNorm = normalizeName(identity.model);
  const partNorm = normalizeName(identity.partNumber);
  const nameNorm = normalizeName(identity.name);
  const categoryNorm = normalizeName(identity.category);

  if (skuNorm && recordSku && normalizeName(recordSku) === skuNorm) return true;
  if (partNorm && recordPart && normalizeName(recordPart) === partNorm) return true;
  if (modelNorm && recordPart && normalizeName(recordPart) === modelNorm) return true;

  if (nameNorm && recordName && normalizeName(recordName) === nameNorm) {
    if (!categoryNorm) return true;
    if (!recordCategory) return false;
    return normalizeName(recordCategory) === categoryNorm;
  }

  return false;
}

function getZuperApiConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = trimOrUndefined(process.env.ZUPER_API_KEY);
  if (!apiKey) {
    throw new Error("ZUPER_API_KEY is not configured");
  }

  const baseUrl = (trimOrUndefined(process.env.ZUPER_API_URL) || DEFAULT_ZUPER_API_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

async function requestZuper(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<unknown> {
  const { apiKey, baseUrl } = getZuperApiConfig();
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    headers.set("x-api-key", apiKey);

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }

    if (!response.ok) {
      const message =
        (isRecord(payload) && trimOrUndefined(payload.message)) ||
        (isRecord(payload) && trimOrUndefined(payload.error)) ||
        `HTTP ${response.status}`;
      throw new Error(`Zuper API ${endpoint} failed: ${message}`);
    }

    if (isRecord(payload)) {
      const payloadType = normalizeName(payload.type);
      if (payloadType === "error" || payloadType === "failure" || payload.success === false) {
        const message =
          trimOrUndefined(payload.message) ||
          trimOrUndefined(payload.error) ||
          `Zuper API returned ${payload.type || "error"}`;
        throw new Error(`Zuper API ${endpoint} failed: ${message}`);
      }
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Zuper API ${endpoint} timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSearchEndpoints(query: string): string[] {
  const q = encodeURIComponent(query);
  const endpointCandidates = getCatalogEndpoints();
  const searchKeys = ["filter.keyword", "search", "query"] as const;
  const endpoints: string[] = [];
  for (const endpoint of endpointCandidates) {
    for (const key of searchKeys) {
      endpoints.push(`${endpoint}?${key}=${q}&count=100`);
    }
  }
  return endpoints;
}

async function findExistingZuperItemId(identity: ZuperIdentity): Promise<string | null> {
  const queries = [
    ...new Set(
      [identity.sku, identity.partNumber, identity.model, identity.name].filter(
        (value): value is string => !!value
      )
    ),
  ];
  const unavailablePaths = new Set<string>();

  for (const query of queries) {
    for (const endpoint of buildSearchEndpoints(query)) {
      const endpointPath = getEndpointPath(endpoint);
      if (unavailablePaths.has(endpointPath)) continue;
      try {
        const payload = await requestZuper(endpoint, { method: "GET" });
        const records = extractRecords(payload);
        for (const record of records) {
          if (!matchesIdentity(record, identity)) continue;
          const id = extractZuperItemId(record);
          if (id) return id;
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          unavailablePaths.add(endpointPath);
        }
        // Ignore endpoint-specific search errors and continue fallbacks.
      }
    }
  }

  return null;
}

interface CreateAttemptResult {
  id: string | null;
  errors: string[];
  successfulResponseWithoutId: boolean;
}

interface CreateBodyVariant {
  label: string;
  body: JsonRecord;
}

async function getCreateBodyVariants(endpoint: string, payload: JsonRecord): Promise<CreateBodyVariant[]> {
  const path = getEndpointPath(endpoint).toLowerCase();
  if (path.includes("/parts")) {
    return [
      { label: "part", body: { part: payload } },
      { label: "parts[]", body: { parts: [payload] } },
      { label: "raw", body: payload },
    ];
  }
  if (path.endsWith("/product")) {
    // Map generic field names → Zuper /product API field names.
    // See https://developers.zuper.co/reference/create-a-product
    const productName = trimOrUndefined(payload.product_name) || trimOrUndefined(payload.name);
    const productCategory = trimOrUndefined(payload.product_category) || trimOrUndefined(payload.category_name) || trimOrUndefined(payload.category);
    const productDescription = trimOrUndefined(payload.product_description) || trimOrUndefined(payload.description);
    const uom = trimOrUndefined(payload.uom) || trimOrUndefined(payload.unit);
    const purchasePrice = trimOrUndefined(payload.purchase_price) || trimOrUndefined(payload.cost_price) || trimOrUndefined(payload.purchase_rate) || trimOrUndefined(payload.cost);
    const price = trimOrUndefined(payload.price) || trimOrUndefined(payload.unit_price) || trimOrUndefined(payload.rate);
    const brand = trimOrUndefined(payload.brand);
    const specification = trimOrUndefined(payload.specification);

    const rawType = (trimOrUndefined(payload.product_type) || "PRODUCT").toUpperCase();
    const productType = VALID_PRODUCT_TYPES.includes(rawType as typeof VALID_PRODUCT_TYPES[number])
      ? rawType
      : "PRODUCT";
    const categoryUid = await resolveZuperCategoryUid(productCategory);

    // product_no is auto-assigned by Zuper as a sequential integer.
    // Sending a string SKU causes a CastError, so we omit it.
    const productPayload: JsonRecord = {
      ...(productName ? { product_name: productName } : {}),
      product_category: categoryUid,
      product_type: productType,
      ...(productDescription ? { product_description: productDescription } : {}),
      ...(brand ? { brand } : {}),
      ...(specification ? { specification } : {}),
      ...(uom ? { uom } : {}),
      ...(price ? { price: Number(price) || undefined } : {}),
      ...(purchasePrice ? { purchase_price: String(purchasePrice) } : {}),
    };
    return [
      { label: "product", body: { product: productPayload } },
    ];
  }
  if (path.includes("/products")) {
    return [
      { label: "product", body: { product: payload } },
      { label: "products[]", body: { products: [payload] } },
      { label: "item", body: { item: payload } },
      { label: "raw", body: payload },
    ];
  }
  return [
    { label: "item", body: { item: payload } },
    { label: "items[]", body: { items: [payload] } },
    { label: "raw", body: payload },
  ];
}

async function tryCreateWithPayload(
  payload: JsonRecord,
  unavailableEndpoints: Set<string>
): Promise<CreateAttemptResult> {
  const attempts: Array<{ endpoint: string; body: JsonRecord; label: string }> = [];
  for (const endpoint of getCatalogEndpoints()) {
    const variants = await getCreateBodyVariants(endpoint, payload);
    for (const variant of variants) {
      attempts.push({ endpoint, body: variant.body, label: variant.label });
    }
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    const endpointPath = getEndpointPath(attempt.endpoint);
    if (unavailableEndpoints.has(endpointPath)) continue;
    try {
      const response = await requestZuper(attempt.endpoint, {
        method: "POST",
        body: JSON.stringify(attempt.body),
      });
      const id = extractZuperItemId(response);
      if (id) return { id, errors, successfulResponseWithoutId: false };
      errors.push(`${attempt.endpoint} (${attempt.label}): success response missing item ID`);
      // Stop after first 2xx/payload-success response to avoid duplicate creates
      // across endpoint/body-shape fallbacks.
      return { id: null, errors, successfulResponseWithoutId: true };
    } catch (error) {
      if (isNotFoundError(error)) {
        unavailableEndpoints.add(endpointPath);
      }
      errors.push(`${attempt.endpoint} (${attempt.label}): ${getErrorMessage(error)}`);
    }
  }

  return { id: null, errors, successfulResponseWithoutId: false };
}

export async function getZuperPartById(
  itemId: string,
): Promise<Record<string, unknown> | null> {
  const normalizedId = trimOrUndefined(itemId);
  if (!normalizedId) return null;

  const endpoints = getCatalogEndpoints();
  for (const endpoint of endpoints) {
    const url = `${endpoint}/${encodeURIComponent(normalizedId)}`;
    try {
      const response = await requestZuper(url);
      if (isRecord(response)) {
        // Try common nested shapes
        for (const key of ["item", "part", "product", "data"]) {
          if (isRecord(response[key])) return response[key] as Record<string, unknown>;
        }
        return response;
      }
    } catch {
      // Try next endpoint
    }
  }
  return null;
}

export async function createOrUpdateZuperPart(
  input: UpsertZuperPartInput
): Promise<UpsertZuperPartResult> {
  const brand = trimOrUndefined(input.brand);
  const model = trimOrUndefined(input.model);
  const sku = trimOrUndefined(input.sku) || model;
  const description = trimOrUndefined(input.description);
  const partNumber = trimOrUndefined(input.vendorPartNumber) || model;
  const unitLabel = trimOrUndefined(input.unitLabel);
  const vendorName = trimOrUndefined(input.vendorName);
  const category = trimOrUndefined(input.category) || "Parts";
  const specification = trimOrUndefined(input.specification);

  const name = `${brand || ""} ${model || ""}`.trim();
  if (!name) throw new Error("Zuper item requires brand and model");

  const identity: ZuperIdentity = { name, sku, model, partNumber, category };
  const existingId = await findExistingZuperItemId(identity);
  if (existingId) {
    return { zuperItemId: existingId, created: false };
  }

  const mergedDescription = [description, specification].filter(Boolean).join(" | ");
  const corePayload: JsonRecord = {
    name,
    ...(sku ? { sku } : {}),
    ...(mergedDescription ? { description: mergedDescription } : {}),
    ...(partNumber ? { part_number: partNumber } : {}),
  };

  const optionalPayload: JsonRecord = {
    ...corePayload,
    ...(category ? { category_name: category, category } : {}),
    ...(vendorName ? { vendor_name: vendorName, vendor: vendorName } : {}),
    ...(unitLabel ? { unit: unitLabel } : {}),
    ...(isFiniteNumber(input.sellPrice)
      ? { unit_price: input.sellPrice, price: input.sellPrice, rate: input.sellPrice }
      : {}),
    ...(isFiniteNumber(input.unitCost)
      ? { cost_price: input.unitCost, purchase_rate: input.unitCost, cost: input.unitCost }
      : {}),
  };

  const hasOptional = Object.keys(optionalPayload).length > Object.keys(corePayload).length;
  const allErrors: string[] = [];
  const unavailableCreateEndpoints = new Set<string>();

  const optionalAttempt = await tryCreateWithPayload(optionalPayload, unavailableCreateEndpoints);
  allErrors.push(...optionalAttempt.errors);
  if (optionalAttempt.id) return { zuperItemId: optionalAttempt.id, created: true };
  if (optionalAttempt.successfulResponseWithoutId) {
    const discoveredId = await findExistingZuperItemId(identity);
    if (discoveredId) return { zuperItemId: discoveredId, created: true };
    throw new Error(
      `Failed to resolve created Zuper item ID after successful create response. Attempts: ${
        allErrors.join(" | ") || "no successful endpoint"
      }`
    );
  }

  if (hasOptional) {
    const coreAttempt = await tryCreateWithPayload(corePayload, unavailableCreateEndpoints);
    allErrors.push(...coreAttempt.errors);
    if (coreAttempt.id) return { zuperItemId: coreAttempt.id, created: true };
    if (coreAttempt.successfulResponseWithoutId) {
      const discoveredId = await findExistingZuperItemId(identity);
      if (discoveredId) return { zuperItemId: discoveredId, created: true };
      throw new Error(
        `Failed to resolve created Zuper item ID after successful create response. Attempts: ${
          allErrors.join(" | ") || "no successful endpoint"
        }`
      );
    }
  }

  // Some accounts succeed with sparse/non-standard responses; re-search once before failing.
  const discoveredId = await findExistingZuperItemId(identity);
  if (discoveredId) return { zuperItemId: discoveredId, created: true };

  throw new Error(
    `Failed to create Zuper item. Attempts: ${allErrors.join(" | ") || "no successful endpoint"}`
  );
}

export async function updateZuperPart(
  itemId: string,
  fields: JsonRecord,
): Promise<UpdateZuperPartResult> {
  const normalizedId = trimOrUndefined(itemId);
  if (!normalizedId) {
    return { status: "failed", zuperItemId: itemId, message: "Zuper item ID is required." };
  }

  if (Object.keys(fields).length === 0) {
    return { status: "updated", zuperItemId: normalizedId, message: "No fields to update." };
  }

  const endpoints = getCatalogEndpoints();
  const bodyVariants: Array<{ label: string; body: JsonRecord }> = [
    { label: "item", body: { item: fields } },
    { label: "raw", body: fields },
  ];

  const errors: string[] = [];
  let allUnsupported = true;

  for (const endpoint of endpoints) {
    for (const variant of bodyVariants) {
      const url = `${endpoint}/${encodeURIComponent(normalizedId)}`;
      try {
        await requestZuper(url, {
          method: "PUT",
          body: JSON.stringify(variant.body),
        });
        return { status: "updated", zuperItemId: normalizedId, message: "Zuper item updated." };
      } catch (error) {
        const message = getErrorMessage(error);
        const is404 = /\bHTTP\s*404\b/i.test(message);
        const is405 = /\bHTTP\s*405\b/i.test(message);
        if (!is405) allUnsupported = false;
        if (is404) {
          return {
            status: "not_found",
            zuperItemId: normalizedId,
            message,
            httpStatus: 404,
          };
        }
        errors.push(`${url} (${variant.label}): ${message}`);
      }
    }
  }

  if (allUnsupported && errors.length > 0) {
    return {
      status: "unsupported",
      zuperItemId: normalizedId,
      message: "Zuper API does not support product updates via PUT.",
      httpStatus: 405,
    };
  }

  return {
    status: "failed",
    zuperItemId: normalizedId,
    message: `Failed to update Zuper item. Attempts: ${errors.join(" | ") || "no endpoint available"}`,
  };
}
