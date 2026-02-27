import * as Sentry from "@sentry/nextjs";

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

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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

  // Tesla Backup Switch (1624171) — paired with PW3 but not in planset BOM
  { pattern: /\bbackup\s+switch\b|\b1624171\b/i,          sku: "1624171-00-J" },

  // 60A non-fused AC disconnect
  { pattern: /\b60a?\s+non.?fused\b/i,                   sku: "DG222URB" },

  // 200A non-fused AC disconnect (utility service upgrade, Burnham-style)
  { pattern: /\b200a?\s+non.?fused\b/i,                  sku: "TGN3324R" },

  // 200A fused AC disconnect
  { pattern: /\b200a?\s+(utility\s+)?fused\b/i,          sku: "D224NRB" },

  // Xcel Energy PV Production Meter → Milbank 200A Meter Housing w/ Bypass
  { pattern: /xcel.*meter|pv\s+production\s+meter/i,     sku: "U4801XL5T9" },

  // 125A sub panel
  { pattern: /\b125a?\s+sub\s*panel\b/i,                 sku: "PAL2412" },

  // IronRidge XR100 Bonded Splice — must come before the XR100 rail pattern below
  { pattern: /\bxr100\s*(?:bonded\s*)?splice\b|\bxr-?100.*splice\b/i, sku: "XR100-BOSS-01-M1" },

  // IronRidge XR100 168" rail (metal/trapezoidal roof) — must come before XR10 pattern
  { pattern: /\bxr100\b|\bxr-100\b/i,                    sku: "XR-100-168A" },

  // IronRidge XR10 Bonded Splice — must come before the XR10 rail pattern below
  { pattern: /\bxr10\s*(?:bonded\s*)?splice\b|\bxr-?10.*splice\b/i,  sku: "XR10-BOSS-01-M1" },

  // IronRidge XR10 168" rail — any remaining XR10 query (no "splice" keyword) → rail
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

  // ── Ops-Standard Additions ─────────────────────────────────────────────────
  // Items always ordered regardless of planset content (critter guard, solobox,
  // meter accessories, tap hardware). The skill outputs these as explicit BOM
  // items so they land in the SO; overrides ensure the right Zoho SKU is used.

  // Critter Guard 6" roll (always 4 boxes per job)
  { pattern: /\bcritter\s+guard\b|\bs6466\b/i,              sku: "S6466" },

  // Heyco SunScreener clip (always 4 boxes per job, paired with critter guard roll)
  { pattern: /\bheyco\b|\bsunscreener\b|\bs6438\b/i,        sku: "S6438" },

  // UNIRAC SOLOBOX COMP-D junction box — used on every job as standard J-box
  // (planset may show a different J-box; always substitute SBOXCOMP-D)
  { pattern: /\bsolobox\b|\bsboxcomp/i,                     sku: "SBOXCOMP-D" },

  // Meter Bypass Jumpers — ordered with every production meter install (1 pair)
  { pattern: /\bmeter\s+bypass\s+jumper|\bk8180\b|\b44341\b/i, sku: "K8180" },

  // Meter Cover — ordered with every production meter install (1 pcs)
  { pattern: /\bmeter\s+cover\b|\b43974\b|\b6003\b/i,       sku: "43974" },

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

  /** Load all Zoho items into a module-level cache (60 min TTL). */
  async getItemsForMatching(): Promise<ZohoInventoryItem[]> {
    if (_itemCache && Date.now() < _itemCache.expiresAt) return _itemCache.items;
    const allItems = await this.listItems();
    // Only match against active items — inactive items cannot be added to SOs/POs
    const items = allItems.filter(i => !i.status || i.status === "active");
    _itemCache = { items, expiresAt: Date.now() + ITEM_CACHE_TTL_MS };
    return items;
  }

  /**
   * Find a Zoho item by matching a BOM item name/model against the cached
   * item list. Tries (in order):
   *   1. Exact normalized match on name
   *   2. Exact normalized match on SKU
   *   3. Zoho item name contains the query (normalized)
   *   4. Query contains the Zoho item name (normalized, min 5 chars)
   *
   * Returns { item_id, zohoName } so callers can verify the match,
   * or null if no match found.
   */
  async findItemIdByName(query: string): Promise<{ item_id: string; zohoName: string } | null> {
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
        return hit ? { item_id: hit.item_id, zohoName: hit.name } : null;
      }
    }

    const q = normalizeName(query);

    // 1. Exact name match
    const exactName = items.find(i => normalizeName(i.name) === q);
    if (exactName) return { item_id: exactName.item_id, zohoName: exactName.name };

    // 2. Exact SKU match
    const exactSku = items.find(i => i.sku && normalizeName(i.sku) === q);
    if (exactSku) return { item_id: exactSku.item_id, zohoName: exactSku.name };

    // 3. Zoho SKU contains query (e.g. query "HIN-T440NF(BK)" → SKU "HYU HIN-T440NF(BK)")
    if (q.length >= 3) {
      const skuContains = items.find(i => i.sku && normalizeName(i.sku).includes(q));
      if (skuContains) return { item_id: skuContains.item_id, zohoName: skuContains.name };
    }

    // 4. Query contains Zoho SKU (only if SKU is substantive)
    const queryContainsSku = items.find(i => {
      if (!i.sku) return false;
      const s = normalizeName(i.sku);
      return s.length >= 5 && q.includes(s);
    });
    if (queryContainsSku) return { item_id: queryContainsSku.item_id, zohoName: queryContainsSku.name };

    // 5. Zoho name contains query
    const nameContains = items.find(i => normalizeName(i.name).includes(q));
    if (nameContains) return { item_id: nameContains.item_id, zohoName: nameContains.name };

    // 6. Query contains Zoho name (only if Zoho name is substantive)
    const queryContains = items.find(i => {
      const n = normalizeName(i.name);
      return n.length >= 5 && q.includes(n);
    });
    if (queryContains) return { item_id: queryContains.item_id, zohoName: queryContains.name };

    return null;
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
  async searchCustomers(query: string): Promise<ZohoVendor[]> {
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

    let token = await this.getAccessToken();
    let response = await doFetch(token);

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
      // Keep raw body as fallback detail.
      json = { message: raw };
    }

    if (!response.ok) {
      const message = typeof json.message === "string"
        ? json.message
        : `Zoho Inventory request failed (${response.status})`;
      throw new Error(message);
    }

    const code = typeof json.code === "number" ? json.code : undefined;
    if (code !== undefined && code !== 0) {
      const message = typeof json.message === "string"
        ? json.message
        : `Zoho Inventory API error (code ${code})`;
      throw new Error(message);
    }

    return json as unknown as T;
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

    let token = await this.getAccessToken();
    let response = await doFetch(token);

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

    if (!response.ok) {
      const message =
        typeof json.message === "string"
          ? json.message
          : `Zoho Inventory request failed (${response.status})`;
      throw new Error(message);
    }

    const code = typeof json.code === "number" ? json.code : undefined;
    if (code !== undefined && code !== 0) {
      const message =
        typeof json.message === "string"
          ? json.message
          : `Zoho Inventory API error (code ${code})`;
      throw new Error(message);
    }

    return json as unknown as T;
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
