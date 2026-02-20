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
  status?: string;
  stock_on_hand?: number | string;
  available_stock?: number | string;
  locations?: ZohoInventoryLocationStock[];
  warehouses?: ZohoInventoryLocationStock[];
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

interface ZohoTokenRefreshResponse {
  access_token?: string;
  expires_in?: number;
  expires_in_sec?: number;
  api_domain?: string;
}

const DEFAULT_BASE_URL = "https://www.zohoapis.com/inventory/v1";
const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com";
const DEFAULT_TIMEOUT_MS = 20_000;

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
