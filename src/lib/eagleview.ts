/**
 * EagleView Measurement Orders API client.
 *
 * Used to order TrueDesign for Planning (TDP) reports for solar deals.
 * Spec: docs/superpowers/specs/2026-04-24-eagleview-truedesign-auto-pull-design.md
 *
 * Auth flow (OAuth2 client credentials):
 *   1. POST {base}/oauth2/v1/token  with Authorization: Basic <client:secret>
 *      and grant_type=client_credentials
 *   2. Receive { access_token, expires_in: 3600 }
 *   3. Use as Authorization: Bearer <access_token> on subsequent calls
 *
 * IMPORTANT: API requests use camelCase field names (`address`, `latitude`, ...)
 * despite the OpenAPI spec showing PascalCase. Sending PascalCase produces a
 * misleading "latitude must be a number between 16 and 70" error.
 *
 * Confirmed product IDs (verified 2026-04-24 against sandbox):
 *   91 = TrueDesign for Planning (TDP) — what we order in v1
 *   90 = TrueDesign for Sales (TDS) — $0, reserved
 *   62 = Inform Advanced (IA) — reserved
 *   11 = Inform Essentials+ — reserved
 */
import * as Sentry from "@sentry/nextjs";

// ============================================================
// Constants
// ============================================================

/** Production base URL — also serves as the OAuth token host for both envs. */
export const EAGLEVIEW_PROD_BASE = "https://apicenter.eagleview.com";
export const EAGLEVIEW_SANDBOX_BASE = "https://sandbox.apicenter.eagleview.com";

/** OAuth2 token endpoint. Lives on production host even for sandbox apps. */
export const EAGLEVIEW_TOKEN_URL = "https://apicenter.eagleview.com/oauth2/v1/token";

/** Confirmed product IDs (verified via /v2/Product/GetAvailableProducts). */
export const EAGLEVIEW_PRODUCT_ID = {
  TDP: 91, // TrueDesign for Planning — primary v1 target
  TDS: 90, // TrueDesign for Sales — reserved
  IA: 62, // Inform Advanced — reserved
  IE_PLUS: 11, // Inform Essentials+ — reserved
} as const;

/** Default request timeout in ms. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Refresh tokens this many ms before they actually expire. */
const TOKEN_REFRESH_BUFFER_MS = 60_000;

/** Max number of retries on rate limit / 5xx. */
const MAX_RETRIES = 3;

// ============================================================
// Public types
// ============================================================

export interface AddressInput {
  /** "Street, City, State Zip, Country" formatted address. */
  address: string;
  latitude: number;
  longitude: number;
}

export interface AvailabilityStatusEntry {
  isAvailable: boolean;
  productId: number;
}

export interface SolarAvailabilityResponse {
  jobId: string;
  address: string;
  latitude: string; // EV returns these as strings in the response
  longitude: string;
  availabilityStatus: AvailabilityStatusEntry[];
  jobStatus: string;
  requestId: string;
}

export interface AvailableProduct {
  productID: number;
  name: string;
  description: string;
  productGroup: string | null;
  isTemporarilyUnavailable: boolean;
  priceMin: number;
  priceMax: number;
  deliveryProducts?: Array<{
    productID: number;
    name: string;
    description: string;
    isTemporarilyUnavailable: boolean;
    priceMin: number;
    priceMax: number;
  }>;
}

export interface PlaceOrderRequest {
  reportAddresses: {
    primary: {
      street: string;
      city: string;
      state: string;
      zip: string;
      country?: string;
    };
  };
  primaryProductId: number;
  deliveryProductId: number;
  measurementInstructionType: number;
  changesInLast4Years: boolean;
  latitude?: number;
  longitude?: number;
  /** Customer-side reference id; we use the HubSpot deal id. */
  referenceId?: string;
}

export interface PlaceOrderResponse {
  reportId: number;
}

export interface ReportFileLink {
  link: string; // signed URL
  expireTimestamp: string; // ISO datetime
  fileType: string;
}

export interface FileLinksResponse {
  links: ReportFileLink[];
}

export interface GetReportResponse {
  reportId: number;
  statusId?: number;
  subStatusId?: number;
  displayStatus?: string;
  street?: string;
  buildingId?: string;
  // Full schema is large; only declare what callers use.
}

export class EagleViewError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "EagleViewError";
  }
}

// ============================================================
// Helpers
// ============================================================

function trimOrUndefined(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wraps a fetch promise with a timeout. */
async function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`EagleView request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Exponential backoff with jitter for rate-limit retries. */
function backoffDelay(attempt: number): number {
  const base = 500 * Math.pow(2, attempt); // 500, 1000, 2000, 4000
  const jitter = Math.random() * 250;
  return base + jitter;
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ============================================================
// Client
// ============================================================

export interface EagleViewClientOptions {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Override token URL — defaults to EAGLEVIEW_TOKEN_URL. */
  tokenUrl?: string;
}

export class EagleViewClient {
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly timeoutMs: number;

  private cachedToken?: string;
  private cachedTokenExpiresAtMs = 0;
  /** Coalesces concurrent token fetches into one network call. */
  private inflightTokenPromise?: Promise<string>;

  constructor(opts: EagleViewClientOptions = {}) {
    this.clientId = opts.clientId ?? trimOrUndefined(process.env.EAGLEVIEW_CLIENT_ID);
    this.clientSecret =
      opts.clientSecret ?? trimOrUndefined(process.env.EAGLEVIEW_CLIENT_SECRET);
    this.baseUrl =
      opts.baseUrl ??
      trimOrUndefined(process.env.EAGLEVIEW_BASE_URL) ??
      EAGLEVIEW_SANDBOX_BASE;
    this.tokenUrl = opts.tokenUrl ?? EAGLEVIEW_TOKEN_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  getMissingConfig(): string[] {
    const missing: string[] = [];
    if (!this.clientId) missing.push("EAGLEVIEW_CLIENT_ID");
    if (!this.clientSecret) missing.push("EAGLEVIEW_CLIENT_SECRET");
    return missing;
  }

  /**
   * Get a valid access token, refreshing if needed.
   * Coalesces concurrent callers via inflightTokenPromise.
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.cachedToken &&
      Date.now() < this.cachedTokenExpiresAtMs - TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.cachedToken;
    }
    if (this.inflightTokenPromise) return this.inflightTokenPromise;

    this.inflightTokenPromise = this.fetchNewToken();
    try {
      return await this.inflightTokenPromise;
    } finally {
      this.inflightTokenPromise = undefined;
    }
  }

  private async fetchNewToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "EagleView client not configured (missing EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET)",
      );
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await withTimeout(
      fetch(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      }),
      this.timeoutMs,
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      Sentry.captureMessage("eagleview.token.fail", {
        level: "error",
        extra: { status: response.status, body: text.slice(0, 500) },
      });
      throw new EagleViewError(
        `Failed to fetch EagleView access token (status ${response.status})`,
        response.status,
        text,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new EagleViewError("EagleView token response missing access_token", 200);
    }

    this.cachedToken = data.access_token;
    const expiresInMs = (data.expires_in ?? 3600) * 1000;
    this.cachedTokenExpiresAtMs = Date.now() + expiresInMs;
    return data.access_token;
  }

  // ------------------------------------------------------------
  // Public methods
  // ------------------------------------------------------------

  /**
   * GET /v2/Product/GetAvailableProducts — list products enabled on the account.
   */
  async getAvailableProducts(): Promise<AvailableProduct[]> {
    return this.request<AvailableProduct[]>("GET", "/v2/Product/GetAvailableProducts");
  }

  /**
   * POST /v1/Product/SolarProductAvailability — check if requested products
   * are available at the given lat/lng.
   *
   * Sends camelCase fields per API requirement.
   */
  async checkSolarAvailability(
    address: AddressInput,
    productIds: number[],
    opts: { vintageExtension?: boolean } = {},
  ): Promise<SolarAvailabilityResponse> {
    return this.request<SolarAvailabilityResponse>(
      "POST",
      "/v1/Product/SolarProductAvailability",
      {
        body: {
          address: address.address,
          latitude: address.latitude,
          longitude: address.longitude,
          productList: productIds,
          vintageExtension: opts.vintageExtension ?? false,
        },
      },
    );
  }

  /**
   * POST /v2/Order/PlaceOrder — place an order for one product at one address.
   * Returns the EagleView ReportId, which is the durable handle for status + files.
   */
  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    return this.request<PlaceOrderResponse>("POST", "/v2/Order/PlaceOrder", {
      body: req,
    });
  }

  /**
   * GET /v3/Report/GetReport?reportId=… — current status of an existing order.
   */
  async getReport(reportId: number | string): Promise<GetReportResponse> {
    const qs = new URLSearchParams({ reportId: String(reportId) }).toString();
    return this.request<GetReportResponse>("GET", `/v3/Report/GetReport?${qs}`);
  }

  /**
   * GET /v3/Report/{reportId}/file-links — signed URLs for file downloads.
   */
  async getFileLinks(reportId: number | string): Promise<FileLinksResponse> {
    return this.request<FileLinksResponse>(
      "GET",
      `/v3/Report/${encodeURIComponent(String(reportId))}/file-links`,
    );
  }

  /**
   * Download a file from a signed URL returned by getFileLinks.
   * No bearer token required for signed URLs.
   */
  async downloadFile(signedUrl: string): Promise<ArrayBuffer> {
    const response = await withTimeout(
      fetch(signedUrl, { method: "GET" }),
      this.timeoutMs,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new EagleViewError(
        `Failed to download EagleView file (status ${response.status})`,
        response.status,
        text.slice(0, 500),
      );
    }
    return response.arrayBuffer();
  }

  // ------------------------------------------------------------
  // Internal request helper
  // ------------------------------------------------------------

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { body?: unknown } = {},
    attempt = 0,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error(
        `EagleView client missing config: ${this.getMissingConfig().join(", ")}`,
      );
    }

    const url = `${this.baseUrl}${path}`;
    let token = await this.getAccessToken();

    const doFetch = async (bearer: string): Promise<Response> => {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        cache: "no-store",
      };
      if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
      }
      return withTimeout(fetch(url, init), this.timeoutMs);
    };

    let response = await doFetch(token);

    // 401 → force token refresh, retry once
    if (response.status === 401) {
      this.cachedToken = undefined;
      this.cachedTokenExpiresAtMs = 0;
      token = await this.getAccessToken(true);
      response = await doFetch(token);
    }

    if (shouldRetry(response.status) && attempt < MAX_RETRIES) {
      const delay = backoffDelay(attempt);
      Sentry.addBreadcrumb({
        category: "eagleview",
        level: "warning",
        message: `eagleview.retry status=${response.status} attempt=${attempt + 1}`,
      });
      await sleep(delay);
      return this.request<T>(method, path, opts, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      Sentry.captureMessage("eagleview.request.fail", {
        level: "error",
        extra: {
          method,
          path,
          status: response.status,
          body: body.slice(0, 500),
        },
      });
      throw new EagleViewError(
        `EagleView ${method} ${path} failed (status ${response.status})`,
        response.status,
        body.slice(0, 500),
      );
    }

    return (await response.json()) as T;
  }
}

/** Singleton instance for app code. Tests should construct their own. */
let _singleton: EagleViewClient | undefined;
export function getEagleViewClient(): EagleViewClient {
  if (!_singleton) _singleton = new EagleViewClient();
  return _singleton;
}

/** Reset the singleton — for tests only. */
export function __resetEagleViewClientForTests(): void {
  _singleton = undefined;
}
