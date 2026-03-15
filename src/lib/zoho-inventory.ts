import * as Sentry from "@sentry/nextjs";
import { getZohoGroupName } from "./zoho-taxonomy";

export interface ZohoInventoryLocationStock {
  location_id?: string;
  location_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  location_stock_on_hand?: number | string;
  warehouse_stock_on_hand?: number | string;
  warehouse_available_stock?: number | string;
  location_in_store?: number | string;
  location_available_stock?: number | string;
  available_stock?: number | string;
  stock_on_hand?: number | string;
}

export interface ZohoInventoryItem {
  item_id: string;
  name: string;
  sku?: string;
  description?: string;
  status?: string;
  stock_on_hand?: number | string;
  available_stock?: number | string;
  locations?: ZohoInventoryLocationStock[];
  warehouses?: ZohoInventoryLocationStock[];
  rate?: number;                    // sell price
  purchase_rate?: number;           // unit cost
  part_number?: string;             // model/part number
  vendor_id?: string;               // vendor reference
  vendor_name?: string;             // vendor name
  unit?: string;                    // unit of measurement
}

export interface UpsertZohoItemInput {
  brand: string;
  model: string;
  description?: string | null;
  sku?: string | null;
  unitLabel?: string | null;
  vendorName?: string | null;
  vendorPartNumber?: string | null;
  sellPrice?: number | null;
  unitCost?: number | null;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  /** Internal category enum (e.g. "MODULE", "INVERTER") — mapped to Zoho group_name */
  category?: string | null;
}

export interface UpsertZohoItemResult {
  zohoItemId: string;
  created: boolean;
  warnings?: string[];
}

interface ZohoInventoryListItemsResponse {
  code?: number;
  message?: string;
  items?: ZohoInventoryItem[];
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
  };
}

interface ZohoCreateItemResponse {
  code?: number;
  message?: string;
  item?: {
    item_id?: string;
    name?: string;
  };
}

interface ZohoDeleteItemResponse {
  code?: number;
  message?: string;
}

interface ZohoUpdateItemResponse {
  code?: number;
  message?: string;
  item?: {
    item_id?: string;
    name?: string;
  };
}

export interface DeleteZohoItemResult {
  status: "deleted" | "not_found" | "failed";
  message: string;
  httpStatus?: number;
}

export interface UpdateZohoItemResult {
  status: "updated" | "not_found" | "failed";
  zohoItemId: string;
  message: string;
  httpStatus?: number;
}

export interface ZohoAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ZohoVendor {
  contact_id: string;
  contact_name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  billing_address?: ZohoAddress;
  shipping_address?: ZohoAddress;
}

interface ZohoVendorListResponse {
  code?: number;
  message?: string;
  contacts?: ZohoVendor[];
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
  };
}

export interface ZohoPurchaseOrderLineItem {
  item_id?: string;       // Omit when no Zoho SKU match
  name: string;
  quantity: number;
  description?: string;
}

export interface ZohoPurchaseOrderPayload {
  vendor_id: string;
  purchaseorder_number?: string;
  reference_number: string;
  notes?: string;
  status: "draft";
  line_items: ZohoPurchaseOrderLineItem[];
}

interface ZohoPurchaseOrderCreateResponse {
  code?: number;
  message?: string;
  purchaseorder?: {
    purchaseorder_id: string;
    purchaseorder_number: string;
  };
}

export interface ZohoSalesOrderLineItem {
  item_id?: string;       // Omit when no Zoho SKU match
  name: string;
  quantity: number;
  description?: string;
}

export interface ZohoSalesOrderPayload {
  customer_id: string;
  salesorder_number?: string;
  reference_number: string;
  notes?: string;
  status: "draft";
  line_items: ZohoSalesOrderLineItem[];
}

interface ZohoSalesOrderCreateResponse {
  code?: number;
  message?: string;
  salesorder?: {
    salesorder_id: string;
    salesorder_number: string;
  };
}

export interface ZohoSalesOrderRecord {
  salesorder_id: string;
  salesorder_number: string;
  reference_number?: string;
  date?: string;
  status?: string;
  customer_name?: string;
  total?: number;
  delivery_method?: string;
  notes?: string;
  line_items: Array<{
    line_item_id?: string;
    item_id?: string;
    name?: string;
    sku?: string;
    quantity?: number;
    rate?: number;
    amount?: number;
    description?: string;
  }>;
}

interface ZohoSalesOrderGetResponse {
  code?: number;
  message?: string;
  salesorder?: ZohoSalesOrderRecord;
}

interface ZohoSalesOrderListResponse {
  code?: number;
  message?: string;
  salesorders?: ZohoSalesOrderRecord[];
  page_context?: {
    page?: number;
    per_page?: number;
    has_more_page?: boolean;
  };
}

export interface ListSalesOrdersOptions {
  page?: number;
  perPage?: number;
  sortColumn?: string;
  sortOrder?: "A" | "D";
  search?: string;
}

export interface ListSalesOrdersResult {
  salesorders: ZohoSalesOrderRecord[];
  hasMore: boolean;
}

interface ZohoTokenRefreshResponse {
  access_token?: string;
  expires_in?: number;
  expires_in_sec?: number;
  api_domain?: string;
}

const DEFAULT_BASE_URL = "https://www.zohoapis.com/inventory/v1";
const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Module-level item cache (shared across warm serverless instances)
// Populated on first SO/PO creation, reused for 60 min.
// ---------------------------------------------------------------------------
interface ItemCacheEntry {
  items: ZohoInventoryItem[];
  expiresAt: number;
}
let _itemCache: ItemCacheEntry | null = null;
const ITEM_CACHE_TTL_MS = 60 * 60 * 1000; // 60 min
// Inflight coalescing — prevents concurrent cold-cache calls from each
// triggering a separate listItems() fetch (which would burst Zoho's concurrent
// request limit). All callers share the same in-flight promise.
let _itemCacheInflight: Promise<ZohoInventoryItem[]> | null = null;

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSalesOrderLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/_/g, "-");
}

function canonicalSalesOrderNumber(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Static overrides that map known BOM query patterns directly to specific
 * Zoho SKUs, checked BEFORE fuzzy name matching.
 *
 * Purpose: prevent false positives on common items where the fuzzy logic
 * would match the wrong Zoho product (e.g. XR10 rail → splice connector,
 * or HUG attachment → RD structural screw).
 *
 * Rules are checked in order; first matching pattern wins. If the mapped
 * SKU is not found in the active item catalog, the override returns null
 * rather than falling through to fuzzy matching (avoids substituting a
 * wrong product for a known-but-uncataloged item).
 */
const BOM_QUERY_OVERRIDES: ReadonlyArray<{ pattern: RegExp; sku: string }> = [
  // Powerwall 3 — wildcard model (1707000-XX-Y) → exact catalog SKU
  { pattern: /\b1707000\b/i,                              sku: "1707000-21-K" },

  // MCI-2 (all variants, standard or High Current) → always use High Current item
  { pattern: /\bmci-?2\b/i,                               sku: "1879359-15-B" },

  // IMO Rapid Shutdown Device (SI16 series)
  { pattern: /\bimo\b|\bsi16\b/i,                         sku: "IMO SI16-PEL64R-2" },

  // Tesla Backup Switch (1624171-00-x) — paired with PW3 but not in planset BOM
  { pattern: /\bbackup\s+switch\b|\b1624171\b/i,          sku: "1624171-00-x" },

  // 60A non-fused AC disconnect
  { pattern: /\b60a?\s+non.?fused\b/i,                   sku: "DG222URB" },

  // 200A non-fused AC disconnect (utility service upgrade, Burnham-style)
  { pattern: /\b200a?\s+non.?fused\b/i,                  sku: "TGN3324R" },

  // 200A fused AC disconnect
  { pattern: /\b200a?\s+(utility\s+)?fused\b/i,          sku: "D224NRB" },

  // NOTE: Xcel meter override removed — wrong SKU (U9101RLTGKK).
  // Extraction prompt already produces correct meter model; fuzzy match finds it.

  // Generic PV production meter (non-Xcel; Milbank 200A housing we supply)
  { pattern: /pv\s+production\s+meter|200a.?prod/i,      sku: "U4801XL5T9" },

  // 125A sub panel
  { pattern: /\b125a?\s+sub\s*panel\b/i,                 sku: "PAL2412" },

  // IronRidge XR100 Bonded Splice — must come before the XR100 rail pattern below.
  // Matches both keyword-style ("XR100 BONDED SPLICE") AND direct model string ("XR100-BOSS-01-M1").
  // Without the -boss pattern, the model string would fall through to the XR100 rail override below.
  { pattern: /\bxr100\s*(?:bonded\s*)?splice\b|\bxr-?100.*splice\b|\bxr100-boss\b/i, sku: "XR100-BOSS-01-M1" },

  // IronRidge XR100 168" rail (metal/trapezoidal roof) — must come before XR10 pattern
  { pattern: /\bxr100\b|\bxr-100\b/i,                    sku: "XR-100-168A" },

  // IronRidge XR10 Bonded Splice — must come before the XR10 rail pattern below.
  // Matches both keyword-style ("XR10 BONDED SPLICE") AND direct model string ("XR10-BOSS-01-M1").
  // Without the -boss pattern, "XR10" in the model string would match the rail override below.
  { pattern: /\bxr10\s*(?:bonded\s*)?splice\b|\bxr-?10.*splice\b|\bxr10-boss\b/i, sku: "XR10-BOSS-01-M1" },

  // IronRidge XR10 168" rail — any remaining XR10 query (no "splice"/"boss" keyword) → rail
  { pattern: /\bxr10\b|\bxr-10\b/i,                      sku: "XR-10-168M" },

  // IronRidge HUG attachment (Halo UltraGrip) — the word "hug" appears in the
  // RD structural screw name "(HUG Screws)" causing false positives without this
  { pattern: /\bhug\b/i,                                 sku: "2101151" },

  // IronRidge XR10 Bonded Splice (generic "bonded splice" query — default to XR10)
  { pattern: /\bbonded\s+splice\b/i,                     sku: "XR10-BOSS-01-M1" },

  // IronRidge Mid Clamp → UFO mid clamp Black (ops standard for asphalt/trapezoidal roofs)
  // Note: standing seam (S-5-U system) uses A1/Mill — those jobs don't use "mid clamp" phrasing
  { pattern: /\bmid\s+clamp\b/i,                         sku: "UFO-CL-01-B1" },

  // IronRidge End Clamp → UFO end clamp
  { pattern: /\bend\s+clamp\b/i,                         sku: "UFO-END-01-B1" },

  // Grounding lug — prefer IronRidge XR-specific lug over generic ballast lug
  // Matches both "GROUND LUG" (planset description) and "GROUNDING LUG"
  { pattern: /\bground(?:ing)?\s+lug\b/i,                sku: "XR-LUG-03-A1" },

  // Generic "SPLICE KIT" from PV-2 BOM table — default to XR10 splice.
  // XR100 jobs: skill should output "XR100 SPLICE KIT" which is caught by the
  // xr100 splice pattern above. This catches the XR10 job planset literal.
  { pattern: /\bsplice\s+kit\b/i,                        sku: "XR10-BOSS-01-M1" },

  // Main Breaker Enclosure (load center) — from "60A MAIN BREAKER ENCLOSURE" planset line
  { pattern: /\bmain\s+breaker\s+enclosure\b|\btl270rcu\b/i, sku: "TL270RCU" },

  // 60A 2-pole GE breaker — paired with TL270RCU load center, output as separate BOM item
  { pattern: /\bthql2160\b|\b60a?\s+2.?p(?:ole)?\s+(?:ge\s+)?(?:breaker|circuit\s*breaker)\b/i, sku: "THQL2160" },

  // 40A 2-pole GE PV breaker — used on Enphase micro-inverter jobs (not the 60A Powerwall breaker)
  { pattern: /\bthql2140\b|\b40a?\s+2.?p(?:ole)?\s+(?:ge\s+)?(?:pv\s+)?(?:breaker|circuit\s*breaker)\b/i, sku: "THQL2140" },

  // Tesla Backup Gateway-3 (1841000-X1-Y model wildcard)
  { pattern: /\b1841000\b/i,                             sku: "1841000-x1-y" },

  // Tesla Remote Meter Energy Kit (2045796-xx-y) — used on storage-only battery jobs
  // Note: a second item (P2045794-00-D Hardwire Kit) is also added by the extraction prompt;
  // that item is matched by its exact model string so no separate override is needed.
  { pattern: /tesla.*remote.*meter.*energy|remote.*meter.*energy|\b2045796\b/i, sku: "2045796-xx-y" },

  // Tesla Remote Meter Hardwire Kit — paired with Energy Kit on some battery-only jobs
  { pattern: /tesla.*remote.*meter.*hardwire|remote.*meter.*hardwire|\bP2045794\b/i, sku: "P2045794-00-D" },

  // Tesla Remote Meter generic fallback (older plansets may not specify Energy vs Hardwire)
  { pattern: /tesla.*remote.*meter|remote.*meter|\bP2060713\b/i, sku: "2045796-xx-y" },

  // Powerwall 3 Expansion unit (1807000-20-B)
  { pattern: /\b1807000\b|\bpowerwall.*expansion\b|\bexpansion.*unit\b/i, sku: "1807000-20-B" },

  // Powerwall 3 Expansion Wall Mount Kit (1978069-00-x)
  { pattern: /\b1978069\b|\bexpansion.*wall.*mount|expansion.*mount.*kit/i, sku: "1978069-00-x" },

  // Tesla Expansion Harness — 2.0 M (1875157-20-y) and 0.5 M (1875157-05-y)
  { pattern: /\b1875157-20\b|2\.0\s*m.*expansion.*harness|expansion.*harness.*2/i, sku: "1875157-20-y" },
  { pattern: /\b1875157-05\b|0\.5\s*m.*expansion.*harness|expansion.*harness.*0\.5/i, sku: "1875157-05-y" },
  { pattern: /\b1875157\b/i,                              sku: "1875157-20-y" },

  // Enphase Q-Cable (300ft roll) — used on Enphase micro-inverter jobs
  { pattern: /\bq.?cable\b|\bQ-12-RAW\b/i,              sku: "Q-12-RAW-300" },

  // Enphase Q-Cable Portrait Adapter (Q-12-10-240) — needed when modules in portrait orientation
  { pattern: /\bq-12-10-240\b|\bq.*portrait.*cable|portrait.*q.*cable/i, sku: "Q-12-10-240" },

  // Enphase Q-SEAL-10 — waterproof sealing plugs for unused Q-Cable ports
  { pattern: /\bq-?seal\b|\bq-?seal-?10\b/i,           sku: "Q-SEAL-10" },

  // Enphase Q-TERM-10 — termination caps for Q-Cable branch circuit ends
  { pattern: /\bq-?term\b|\bq-?term-?10\b/i,           sku: "Q-TERM-10" },

  // Enphase BHW-MI-01-A1 microinverter mounting clip (also sold as 1275054)
  { pattern: /\bbhw-mi\b|\b1275054\b|\bmicro.*inverter.*clip|inverter.*mounting.*clip/i, sku: "BHW-MI-01-A1" },

  // 10 AWG THHN/THWN-2 wire — prefer the priced Zoho item (68731) over unpriced alternatives.
  // Matches: "10 AWG THHN", "10 AWG THWN-2", "THHN 10 AWG", "THWN-2 10 AWG",
  //          "10 AWG THHN/THWN-2" (standardized model field from extraction prompt).
  // Also catches bare "THWN-2" or "THHN" without gauge only when qty context implies 10 AWG
  // (model alone → override fires → if not in catalog → null, try description fallback).
  { pattern: /\b10\s*awg\b.*\bthh?n|\bthh?n.*\b10\s*awg\b|\b10\s*awg\b.*\bthwn|\bthwn.*\b10\s*awg\b/i, sku: "68731" },

  // ── Ops-Standard Additions ─────────────────────────────────────────────────
  // Items always ordered regardless of planset content (critter guard, solobox,
  // meter accessories, tap hardware). The skill outputs these as explicit BOM
  // items so they land in the SO; overrides ensure the right Zoho SKU is used.

  // Critter Guard 6" roll (qty varies by job size, solar jobs only)
  { pattern: /\bcritter\s+guard\b|\bs6466\b/i,              sku: "S6466" },

  // Heyco SunScreener clip (qty varies by job size, paired with critter guard roll)
  { pattern: /\bheyco\b|\bsunscreener\b|\bs6438\b/i,        sku: "S6438" },

  // UNIRAC SOLOBOX COMP-D junction box — used on every job as standard J-box
  // (planset may show a different J-box; always substitute SBOXCOMP-D)
  { pattern: /\bsolobox\b|\bsboxcomp/i,                     sku: "SBOXCOMP-D" },

  // Meter Bypass Jumpers — ordered with every production meter install (1 pair).
  // No hard SKU override: the Zoho catalog SKU may not be "K8180"; rely on fuzzy name matching.
  // (If override returned null before, item was silently dropped — fuzzy match is strictly better.)

  // Meter Cover — same reasoning: no hard SKU override, rely on fuzzy name matching.

  // Insulation Piercing Connector — required when job has a tap / service upgrade
  { pattern: /\binsulation\s+pierc|\bbipc4\b|\b010s\b/i,    sku: "BIPC4/010S" },
];

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0;
}

function trimOrUndefined(value: string | undefined | null): string | undefined {
  if (isBlank(value)) return undefined;
  return value!.trim();
}

function isNotFoundMessage(value: string): boolean {
  return /not[\s_-]*found|does[\s_-]*not[\s_-]*exist|invalid.*item/i.test(value);
}

function buildUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Rate-limit retry helpers
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 10_000;

/** Messages Zoho returns for concurrent-request throttling (not just HTTP 429) */
const RATE_LIMIT_MESSAGES = [
  "maximum number of in process requests",
  "rate limit exceeded",
  "too many requests",
];

function isRateLimitError(status: number, message: string): boolean {
  if (status === 429 || status === 503) return true;
  const lower = message.toLowerCase();
  return RATE_LIMIT_MESSAGES.some((m) => lower.includes(m));
}

function rateLimitDelay(attempt: number): number {
  const base = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
  const jitter = base * 0.3 * Math.random(); // 0-30% jitter
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ZohoInventoryClient {
  private readonly organizationId: string | undefined;
  private readonly configuredBaseUrl: string;
  private readonly accountsBaseUrl: string;
  private readonly refreshToken: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly staticAccessToken: string | undefined;
  private readonly timeoutMs: number;

  private dynamicAccessToken?: string;
  private dynamicTokenExpiresAtMs = 0;

  constructor() {
    this.organizationId = trimOrUndefined(process.env.ZOHO_INVENTORY_ORG_ID);
    this.configuredBaseUrl = trimOrUndefined(process.env.ZOHO_INVENTORY_API_BASE_URL) || DEFAULT_BASE_URL;
    this.accountsBaseUrl = trimOrUndefined(process.env.ZOHO_ACCOUNTS_BASE_URL) || DEFAULT_ACCOUNTS_URL;
    this.refreshToken = trimOrUndefined(process.env.ZOHO_INVENTORY_REFRESH_TOKEN);
    this.clientId = trimOrUndefined(process.env.ZOHO_INVENTORY_CLIENT_ID);
    this.clientSecret = trimOrUndefined(process.env.ZOHO_INVENTORY_CLIENT_SECRET);
    this.staticAccessToken = trimOrUndefined(process.env.ZOHO_INVENTORY_ACCESS_TOKEN);

    const timeoutStr = trimOrUndefined(process.env.ZOHO_INVENTORY_TIMEOUT_MS);
    const parsedTimeout = timeoutStr ? Number(timeoutStr) : NaN;
    this.timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    if (!this.organizationId) return false;

    const hasStaticToken = !!this.staticAccessToken;
    const hasRefreshConfig = !!(this.refreshToken && this.clientId && this.clientSecret);

    return hasStaticToken || hasRefreshConfig;
  }

  getMissingConfig(): string[] {
    const missing: string[] = [];

    if (!this.organizationId) {
      missing.push("ZOHO_INVENTORY_ORG_ID");
    }

    const hasStaticToken = !!this.staticAccessToken;
    const hasRefreshConfig = !!(this.refreshToken && this.clientId && this.clientSecret);

    if (!hasStaticToken && !hasRefreshConfig) {
      missing.push(
        "ZOHO_INVENTORY_ACCESS_TOKEN (or ZOHO_INVENTORY_REFRESH_TOKEN + ZOHO_INVENTORY_CLIENT_ID + ZOHO_INVENTORY_CLIENT_SECRET)"
      );
    }

    return missing;
  }

  async listItems(): Promise<ZohoInventoryItem[]> {
    const items: ZohoInventoryItem[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const response = await this.request<ZohoInventoryListItemsResponse>("/items", {
        page,
        per_page: perPage,
      });

      const batch = Array.isArray(response.items) ? response.items : [];
      items.push(...batch);

      const hasMore = !!response.page_context?.has_more_page;
      if (!hasMore || batch.length === 0) break;
      page += 1;

      if (page > 1000) {
        throw new Error("Zoho item pagination exceeded safety limit (1000 pages)");
      }
    }

    return items;
  }

  /** Load all Zoho items into a module-level cache (60 min TTL).
   *  Coalesces concurrent callers so only one listItems() request is in flight
   *  at a time — prevents bursting Zoho's concurrent-request limit on cold start. */
  async getItemById(itemId: string): Promise<ZohoInventoryItem | null> {
    const normalizedId = trimOrUndefined(itemId);
    if (!normalizedId) return null;

    try {
      const response = await this.request<{ item?: ZohoInventoryItem }>(
        `/items/${encodeURIComponent(normalizedId)}`
      );
      return response.item ?? null;
    } catch {
      return null;
    }
  }

  async getItemsForMatching(): Promise<ZohoInventoryItem[]> {
    if (_itemCache && Date.now() < _itemCache.expiresAt) return _itemCache.items;
    // If a fetch is already in flight, piggyback on it instead of starting a second one
    if (_itemCacheInflight) return _itemCacheInflight;
    _itemCacheInflight = this.listItems()
      .then((allItems) => {
        const items = allItems.filter(i => !i.status || i.status === "active");
        _itemCache = { items, expiresAt: Date.now() + ITEM_CACHE_TTL_MS };
        return items;
      })
      .finally(() => {
        _itemCacheInflight = null;
      });
    return _itemCacheInflight;
  }

  /**
   * Find a Zoho item by matching a BOM item name/model against the cached
   * item list. Tries (in order):
   *   1. Exact normalized match on name
   *   2. Exact normalized match on SKU
   *   3. Zoho item name contains the query (normalized)
   *   4. Query contains the Zoho item name (normalized, min 5 chars)
   *
   * Returns { item_id, zohoName, zohoSku } so callers can verify the match,
   * or null if no match found.
   */
  async findItemIdByName(query: string): Promise<{ item_id: string; zohoName: string; zohoSku?: string } | null> {
    if (!query || query.trim().length < 2) return null;
    const items = await this.getItemsForMatching();

    // 0. Static overrides — checked first to prevent false positives on known BOM patterns
    //    (e.g. XR10 → rail not splice, HUG → attachment not screw, 1707000 → Powerwall 3)
    for (const override of BOM_QUERY_OVERRIDES) {
      if (override.pattern.test(query)) {
        const skuQ = normalizeName(override.sku);
        const hit = items.find(i => i.sku && normalizeName(i.sku) === skuQ);
        // If override matches but SKU isn't in catalog, return null rather than
        // falling through to fuzzy matching (avoids substituting wrong product)
        return hit ? { item_id: hit.item_id, zohoName: hit.name, zohoSku: hit.sku } : null;
      }
    }

    const q = normalizeName(query);

    // 1. Exact name match
    const exactName = items.find(i => normalizeName(i.name) === q);
    if (exactName) return { item_id: exactName.item_id, zohoName: exactName.name, zohoSku: exactName.sku };

    // 2. Exact SKU match
    const exactSku = items.find(i => i.sku && normalizeName(i.sku) === q);
    if (exactSku) return { item_id: exactSku.item_id, zohoName: exactSku.name, zohoSku: exactSku.sku };

    // 3. Zoho SKU contains query (e.g. query "HIN-T440NF(BK)" → SKU "HYU HIN-T440NF(BK)")
    if (q.length >= 3) {
      const skuContains = items.find(i => i.sku && normalizeName(i.sku).includes(q));
      if (skuContains) return { item_id: skuContains.item_id, zohoName: skuContains.name, zohoSku: skuContains.sku };
    }

    // 4. Query contains Zoho SKU (only if SKU is substantive)
    const queryContainsSku = items.find(i => {
      if (!i.sku) return false;
      const s = normalizeName(i.sku);
      return s.length >= 5 && q.includes(s);
    });
    if (queryContainsSku) return { item_id: queryContainsSku.item_id, zohoName: queryContainsSku.name, zohoSku: queryContainsSku.sku };

    // 5. Zoho name contains query
    const nameContains = items.find(i => normalizeName(i.name).includes(q));
    if (nameContains) return { item_id: nameContains.item_id, zohoName: nameContains.name, zohoSku: nameContains.sku };

    // 6. Query contains Zoho name (only if Zoho name is substantive)
    const queryContains = items.find(i => {
      const n = normalizeName(i.name);
      return n.length >= 5 && q.includes(n);
    });
    if (queryContains) return { item_id: queryContains.item_id, zohoName: queryContains.name, zohoSku: queryContains.sku };

    return null;
  }

  async createOrUpdateItem(input: UpsertZohoItemInput): Promise<UpsertZohoItemResult> {
    const brand = trimOrUndefined(input.brand);
    const model = trimOrUndefined(input.model);
    const sku = trimOrUndefined(input.sku) || model;
    const description = trimOrUndefined(input.description);
    const unitLabel = trimOrUndefined(input.unitLabel);
    const vendorName = trimOrUndefined(input.vendorName);
    const vendorPartNumber = trimOrUndefined(input.vendorPartNumber);

    const name = `${brand || ""} ${model || ""}`.trim();
    if (!name) {
      throw new Error("Zoho item requires brand and model");
    }

    const items = await this.listItems();
    const activeItems = items.filter((i) => !i.status || i.status === "active");

    let existingItemId: string | undefined;

    if (!existingItemId && sku) {
      const skuNorm = normalizeName(sku);
      const bySku = activeItems.find((i) => i.sku && normalizeName(i.sku) === skuNorm);
      if (bySku?.item_id) existingItemId = bySku.item_id;
    }

    if (!existingItemId && model) {
      const partNorm = normalizeName(model);
      const byPart = activeItems.find((i) => i.part_number && normalizeName(i.part_number) === partNorm);
      if (byPart?.item_id) existingItemId = byPart.item_id;
    }

    if (!existingItemId) {
      const nameNorm = normalizeName(name);
      const byName = activeItems.find((i) => normalizeName(i.name) === nameNorm);
      if (byName?.item_id) existingItemId = byName.item_id;
    }

    if (existingItemId) {
      // Apply confirmed group_name to existing items that may be missing it
      const groupName = input.category ? getZohoGroupName(input.category) : undefined;
      if (groupName) {
        try {
          const updateResult = await this.updateItem(existingItemId, { group_name: groupName });
          if (updateResult.status !== "updated") {
            console.warn(
              `[zoho-inventory] Best-effort group_name update on existing item ${existingItemId} ` +
                `returned status "${updateResult.status}": ${updateResult.message}`
            );
          }
        } catch (error) {
          // Truly unexpected errors (network failures, etc.)
          console.warn(
            `[zoho-inventory] Failed to update group_name on existing item ${existingItemId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
      return { zohoItemId: existingItemId, created: false };
    }

    const partNumber = vendorPartNumber || model;
    const groupName = input.category ? getZohoGroupName(input.category) : undefined;
    // Core payload: identity + accounting defaults (must never be dropped on retry)
    const corePayload: Record<string, unknown> = {
      name,
      ...(sku ? { sku } : {}),
      ...(description ? { description } : {}),
      ...(partNumber ? { part_number: partNumber } : {}),
      ...(groupName ? { group_name: groupName } : {}),
      item_type: "inventory",
      tax_preference: "taxable",
      inventory_account_name: "Inventory Asset",
      inventory_valuation_method: "fifo",
      purchase_account_name: "Cost of Goods Sold",
      sales_account_name: "Sales",
    };

    const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    // Optional payload: core + truly optional fields that can be safely dropped
    const optionalPayload: Record<string, unknown> = {
      ...corePayload,
      item_type: "inventory",
      tax_preference: "taxable",
      inventory_account_name: "Inventory Asset",
      inventory_valuation_method: "fifo",
      purchase_account_name: "Cost of Goods Sold",
      sales_account_name: "Sales",
      ...(isNum(input.sellPrice) ? { rate: input.sellPrice } : {}),
      ...(isNum(input.unitCost) ? { purchase_rate: input.unitCost } : {}),
      ...(vendorName ? { vendor_name: vendorName } : {}),
      ...(unitLabel ? { unit: unitLabel } : {}),
      ...(isNum(input.weight) ? { weight: input.weight } : {}),
      ...(isNum(input.length) ? { length: input.length } : {}),
      ...(isNum(input.width) ? { width: input.width } : {}),
    };

    const hasOptionalFields = Object.keys(optionalPayload).length > Object.keys(corePayload).length;

    let response: ZohoCreateItemResponse;
    let zohoWarnings: string[] | undefined;
    try {
      response = await this.requestPost<ZohoCreateItemResponse>("/items", optionalPayload);
    } catch (error) {
      if (!hasOptionalFields) throw error;
      const droppedKeys = Object.keys(optionalPayload).filter((k) => !(k in corePayload));
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[zoho-inventory] Retrying item create with core payload only (dropped: ${droppedKeys.join(", ")}): ${errMsg}`
      );
      zohoWarnings = [
        `Some fields were skipped due to Zoho validation errors: ${droppedKeys.join(", ")}. Original error: ${errMsg}`,
      ];
      response = await this.requestPost<ZohoCreateItemResponse>("/items", corePayload);
    }

    const createdId = trimOrUndefined(response.item?.item_id);
    if (!createdId) {
      throw new Error(response.message ?? "Zoho did not return an item ID");
    }

    // Bust matching cache so subsequent lookups can immediately see the new item.
    _itemCache = null;

    return { zohoItemId: createdId, created: true, ...(zohoWarnings ? { warnings: zohoWarnings } : {}) };
  }

  async deleteItem(itemId: string): Promise<DeleteZohoItemResult> {
    const normalizedId = trimOrUndefined(itemId);
    if (!normalizedId) {
      return { status: "failed", message: "Zoho item ID is required." };
    }

    try {
      const response = await this.requestDelete<ZohoDeleteItemResponse>(
        `/items/${encodeURIComponent(normalizedId)}`
      );
      _itemCache = null;
      const message = trimOrUndefined(response.message) || "Zoho item deleted.";
      return { status: "deleted", message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zoho delete failed";
      const statusMatch = /status:\s*(\d{3})/i.exec(message);
      const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
      if ((httpStatus === 404 || isNotFoundMessage(message))) {
        return {
          status: "not_found",
          message,
          ...(typeof httpStatus === "number" ? { httpStatus } : {}),
        };
      }
      return {
        status: "failed",
        message,
        ...(typeof httpStatus === "number" ? { httpStatus } : {}),
      };
    }
  }

  async updateItem(
    itemId: string,
    fields: Record<string, unknown>,
  ): Promise<UpdateZohoItemResult> {
    const normalizedId = trimOrUndefined(itemId);
    if (!normalizedId) {
      return { status: "failed", zohoItemId: itemId, message: "Zoho item ID is required." };
    }

    if (Object.keys(fields).length === 0) {
      return { status: "updated", zohoItemId: normalizedId, message: "No fields to update." };
    }

    try {
      const response = await this.requestPut<ZohoUpdateItemResponse>(
        `/items/${encodeURIComponent(normalizedId)}`,
        fields,
        { is_partial: "true" },
      );

      _itemCache = null;

      const message = trimOrUndefined(response.message) || "Zoho item updated.";
      return { status: "updated", zohoItemId: normalizedId, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zoho update failed";
      const statusMatch = /status:\s*(\d{3})/i.exec(message);
      const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
      if (httpStatus === 404 || isNotFoundMessage(message)) {
        return {
          status: "not_found",
          zohoItemId: normalizedId,
          message,
          ...(typeof httpStatus === "number" ? { httpStatus } : {}),
        };
      }
      return {
        status: "failed",
        zohoItemId: normalizedId,
        message,
        ...(typeof httpStatus === "number" ? { httpStatus } : {}),
      };
    }
  }

  async listVendors(): Promise<ZohoVendor[]> {
    return this.listContacts("vendor");
  }

  async listCustomers(): Promise<ZohoVendor[]> {
    return this.listContacts("customer");
  }

  /** Fetch a single page of customers (used for parallel cache loading). */
  async fetchCustomerPage(page: number): Promise<{ contacts: ZohoVendor[]; hasMore: boolean }> {
    const response = await this.request<ZohoVendorListResponse>("/contacts", {
      contact_type: "customer",
      per_page: 200,
      page,
      sort_column: "contact_name",
      sort_order: "A",
    });
    return {
      contacts: Array.isArray(response.contacts) ? response.contacts : [],
      hasMore: !!response.page_context?.has_more_page,
    };
  }

  // Kept for backwards-compat; use fetchCustomerPage for cache loading.
  async searchCustomers(_query: string): Promise<ZohoVendor[]> {
    void _query;
    const { contacts } = await this.fetchCustomerPage(1);
    return contacts;
  }

  private async listContacts(contactType: "vendor" | "customer"): Promise<ZohoVendor[]> {
    const contacts: ZohoVendor[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const response = await this.request<ZohoVendorListResponse>("/contacts", {
        contact_type: contactType,
        per_page: perPage,
        page,
      });

      const batch = Array.isArray(response.contacts) ? response.contacts : [];
      contacts.push(...batch);

      const hasMore = !!response.page_context?.has_more_page;
      if (!hasMore || batch.length === 0) break;
      page += 1;

      if (page > 100) {
        throw new Error(`Zoho contacts pagination exceeded safety limit (100 pages)`);
      }
    }

    return contacts;
  }

  async createSalesOrder(
    payload: ZohoSalesOrderPayload
  ): Promise<{ salesorder_id: string; salesorder_number: string }> {
    const result = await this.requestPost<ZohoSalesOrderCreateResponse>(
      "/salesorders",
      payload
    );
    const so = result.salesorder;
    if (!so?.salesorder_id) {
      throw new Error(result.message ?? "Zoho did not return a sales order ID");
    }
    return {
      salesorder_id: so.salesorder_id,
      salesorder_number: so.salesorder_number,
    };
  }

  async getSalesOrder(soNumber: string): Promise<ZohoSalesOrderRecord> {
    const lookup = normalizeSalesOrderLookup(soNumber);
    if (!lookup) {
      throw new Error("Sales order number is required");
    }

    const firstAttempt = await this.listSalesOrders({
      page: 1,
      perPage: 200,
      search: lookup,
      sortColumn: "created_time",
      sortOrder: "D",
    });

    const expected = canonicalSalesOrderNumber(lookup);
    const directMatch =
      firstAttempt.salesorders.find(
        (so) => canonicalSalesOrderNumber(so.salesorder_number) === expected
      ) ||
      firstAttempt.salesorders.find(
        (so) => canonicalSalesOrderNumber(so.reference_number) === expected
      ) ||
      firstAttempt.salesorders[0];

    // If lookup was normalized from underscores to hyphens and we got no hit, retry raw.
    let selected = directMatch;
    if (!selected && lookup !== soNumber.trim()) {
      const rawAttempt = await this.listSalesOrders({
        page: 1,
        perPage: 200,
        search: soNumber.trim(),
        sortColumn: "created_time",
        sortOrder: "D",
      });
      selected =
        rawAttempt.salesorders.find(
          (so) => canonicalSalesOrderNumber(so.salesorder_number) === expected
        ) || rawAttempt.salesorders[0];
    }

    if (!selected?.salesorder_id) {
      throw new Error(`Sales order ${lookup} not found`);
    }

    const detail = await this.request<ZohoSalesOrderGetResponse>(
      `/salesorders/${encodeURIComponent(selected.salesorder_id)}`
    );
    if (detail.salesorder) return detail.salesorder;

    return {
      ...selected,
      line_items: Array.isArray(selected.line_items) ? selected.line_items : [],
    };
  }

  async searchSalesOrders(
    query: string,
    options: { page?: number; perPage?: number } = {}
  ): Promise<ListSalesOrdersResult> {
    return this.listSalesOrders({
      page: options.page,
      perPage: options.perPage,
      search: query,
      sortColumn: "created_time",
      sortOrder: "D",
    });
  }

  async listSalesOrders(
    options: ListSalesOrdersOptions = {}
  ): Promise<ListSalesOrdersResult> {
    const page = Number.isFinite(options.page) && (options.page || 0) > 0
      ? Number(options.page)
      : 1;
    const perPage = Number.isFinite(options.perPage) && (options.perPage || 0) > 0
      ? Math.min(Number(options.perPage), 200)
      : 200;
    const sortColumn = options.sortColumn || "created_time";
    const sortOrder = options.sortOrder || "D";
    const search = trimOrUndefined(options.search);
    const normalizedSearch = search ? normalizeSalesOrderLookup(search) : undefined;

    const response = await this.request<ZohoSalesOrderListResponse>("/salesorders", {
      page,
      per_page: perPage,
      sort_column: sortColumn,
      sort_order: sortOrder,
      ...(normalizedSearch ? { search_text: normalizedSearch } : {}),
    });

    return {
      salesorders: Array.isArray(response.salesorders) ? response.salesorders : [],
      hasMore: !!response.page_context?.has_more_page,
    };
  }

  async createPurchaseOrder(
    payload: ZohoPurchaseOrderPayload
  ): Promise<{ purchaseorder_id: string; purchaseorder_number: string }> {
    const result = await this.requestPost<ZohoPurchaseOrderCreateResponse>(
      "/purchaseorders",
      payload
    );
    const po = result.purchaseorder;
    if (!po?.purchaseorder_id) {
      throw new Error(result.message ?? "Zoho did not return a purchase order ID");
    }
    return {
      purchaseorder_id: po.purchaseorder_id,
      purchaseorder_number: po.purchaseorder_number,
    };
  }

  /**
   * Shared response handler: parse JSON, check for errors, retry on rate limits.
   * Returns the parsed JSON body or throws.
   */
  private async handleResponse<T>(
    doFetch: (token: string) => Promise<Response>,
    attempt = 0,
  ): Promise<T> {
    let token = await this.getAccessToken();
    let response = await doFetch(token);

    // 401 → refresh token and retry once
    if (response.status === 401 && this.canRefreshToken()) {
      this.dynamicAccessToken = undefined;
      this.dynamicTokenExpiresAtMs = 0;
      token = await this.getAccessToken(true);
      response = await doFetch(token);
    }

    const raw = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json = { message: raw };
    }

    const message =
      typeof json.message === "string"
        ? json.message
        : `Zoho Inventory request failed (${response.status})`;

    // Rate-limit retry with exponential backoff + jitter
    if (isRateLimitError(response.status, message) && attempt < RATE_LIMIT_MAX_RETRIES) {
      const delay = rateLimitDelay(attempt);
      console.warn(
        `[zoho] Rate limited (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}), retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
      return this.handleResponse<T>(doFetch, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(`${message} (status: ${response.status})`);
    }

    const code = typeof json.code === "number" ? json.code : undefined;
    if (code !== undefined && code !== 0) {
      const apiMessage =
        typeof json.message === "string"
          ? json.message
          : `Zoho Inventory API error (code ${code})`;

      // Also retry on rate-limit API-level errors (code != 0 but message matches)
      if (isRateLimitError(0, apiMessage) && attempt < RATE_LIMIT_MAX_RETRIES) {
        const delay = rateLimitDelay(attempt);
        console.warn(
          `[zoho] Rate limited via API code (attempt ${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}), retrying in ${Math.round(delay)}ms`
        );
        await sleep(delay);
        return this.handleResponse<T>(doFetch, attempt + 1);
      }

      throw new Error(apiMessage);
    }

    return json as unknown as T;
  }

  private async request<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!this.organizationId) {
      throw new Error("ZOHO_INVENTORY_ORG_ID is not configured");
    }

    const params = new URLSearchParams();
    params.set("organization_id", this.organizationId);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }

    const url = `${buildUrl(this.configuredBaseUrl, path)}?${params.toString()}`;

    const doFetch = async (token: string) => {
      return withTimeout(
        fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }),
        this.timeoutMs
      );
    };

    return this.handleResponse<T>(doFetch);
  }

  private async requestPost<T>(path: string, body: unknown): Promise<T> {
    if (!this.organizationId) {
      throw new Error("ZOHO_INVENTORY_ORG_ID is not configured");
    }

    const params = new URLSearchParams();
    params.set("organization_id", this.organizationId);

    const url = `${buildUrl(this.configuredBaseUrl, path)}?${params.toString()}`;

    const doFetch = async (token: string) => {
      return withTimeout(
        fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        }),
        this.timeoutMs
      );
    };

    return this.handleResponse<T>(doFetch);
  }

  private async requestPut<T>(path: string, body: unknown, extraParams?: Record<string, string>): Promise<T> {
    if (!this.organizationId) {
      throw new Error("ZOHO_INVENTORY_ORG_ID is not configured");
    }

    const params = new URLSearchParams();
    params.set("organization_id", this.organizationId);
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        params.set(k, v);
      }
    }

    const url = `${buildUrl(this.configuredBaseUrl, path)}?${params.toString()}`;

    const doFetch = async (token: string) => {
      return withTimeout(
        fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        }),
        this.timeoutMs
      );
    };

    return this.handleResponse<T>(doFetch);
  }

  private async requestDelete<T>(path: string): Promise<T> {
    if (!this.organizationId) {
      throw new Error("ZOHO_INVENTORY_ORG_ID is not configured");
    }

    const params = new URLSearchParams();
    params.set("organization_id", this.organizationId);

    const url = `${buildUrl(this.configuredBaseUrl, path)}?${params.toString()}`;

    const doFetch = async (token: string) => {
      return withTimeout(
        fetch(url, {
          method: "DELETE",
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        }),
        this.timeoutMs
      );
    };

    return this.handleResponse<T>(doFetch);
  }

  private canRefreshToken(): boolean {
    return !!(this.refreshToken && this.clientId && this.clientSecret);
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      if (this.dynamicAccessToken && Date.now() < this.dynamicTokenExpiresAtMs) {
        return this.dynamicAccessToken;
      }

      if (this.staticAccessToken) {
        return this.staticAccessToken;
      }
    }

    if (!this.canRefreshToken()) {
      if (this.staticAccessToken) return this.staticAccessToken;
      throw new Error("Zoho Inventory credentials are not configured");
    }

    const tokenUrl = buildUrl(this.accountsBaseUrl, "/oauth/v2/token");
    const body = new URLSearchParams({
      refresh_token: this.refreshToken!,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      grant_type: "refresh_token",
    });

    const response = await withTimeout(
      fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
      }),
      this.timeoutMs
    );

    const payload = (await response.json().catch(() => ({}))) as ZohoTokenRefreshResponse & { error?: unknown };

    if (!response.ok || !payload.access_token) {
      const errorText = typeof payload.error === "string"
        ? payload.error
        : `status ${response.status}`;
      throw new Error(`Failed to refresh Zoho Inventory token (${errorText})`);
    }

    const expiresInSec = Number(payload.expires_in_sec || payload.expires_in || 3600);
    const ttlSec = Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 3600;

    this.dynamicAccessToken = payload.access_token;
    this.dynamicTokenExpiresAtMs = Date.now() + Math.max(60, ttlSec - 60) * 1000;

    if (payload.api_domain && payload.api_domain.trim()) {
      // Some regions return a dedicated API domain at refresh time.
      // Keep this as breadcrumb context for troubleshooting.
      Sentry.addBreadcrumb({
        category: "zoho",
        message: "Zoho token refreshed",
        level: "info",
        data: { apiDomain: payload.api_domain },
      });
    }

    return this.dynamicAccessToken;
  }
}

export const zohoInventory = new ZohoInventoryClient();

export async function createOrUpdateZohoItem(
  input: UpsertZohoItemInput
): Promise<UpsertZohoItemResult> {
  return zohoInventory.createOrUpdateItem(input);
}

export async function deleteZohoItem(
  itemId: string
): Promise<DeleteZohoItemResult> {
  return zohoInventory.deleteItem(itemId);
}

export async function updateZohoItem(
  itemId: string,
  fields: Record<string, unknown>,
): Promise<UpdateZohoItemResult> {
  return zohoInventory.updateItem(itemId, fields);
}
