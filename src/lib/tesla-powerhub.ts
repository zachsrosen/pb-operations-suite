/**
 * Tesla PowerHub API Client
 *
 * Handles OAuth2 client_credentials authentication, rate limiting,
 * and typed endpoint wrappers for the PowerHub API.
 *
 * Architecture:
 * - Our Vercel functions call a Fly.io reverse proxy (for static IP allowlisting)
 * - The proxy forwards plain HTTPS to Tesla's API (no mTLS needed)
 * - Auth uses OAuth2 client_credentials grant (HTTP Basic Auth → bearer token)
 *   - Token endpoint: POST /v1/auth/token (response wrapped in { meta, data, links })
 * - Data endpoints live under /v2/ prefix (responses wrapped in { data: T })
 * - Tokens are cached in module-level state; expiry derived from JWT `exp` claim
 * - Token bucket rate limiter stays under Tesla's 5 req/sec limit
 *
 * Required env vars:
 * - TESLA_POWERHUB_PROXY_URL      — Fly.io proxy URL (e.g. https://pb-powerhub-proxy.fly.dev)
 * - TESLA_POWERHUB_CLIENT_ID      — Client credential ID from PowerHub portal
 * - TESLA_POWERHUB_CLIENT_SECRET  — Client credential secret (shown once at creation)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Tesla token endpoint response — wrapped in { meta, data, links } */
interface PowerHubTokenEnvelope {
  meta: { request_id: string };
  data: {
    access_token: string;
    token_type: string;
  };
  links: unknown;
}

/** Tesla API response wrapper — all /v2/ endpoints return { data: T } */
interface PowerHubEnvelope<T> {
  data: T;
  metadata?: { request_id: string; next_cursor?: string };
}

export interface PowerHubGroup {
  group_id: string;
  group_name: string;
  sites?: { site_id: string }[];
  child_groups?: PowerHubGroup[];
  parent_id?: string | null;
}

export interface PowerHubSiteDetail {
  site_id: string;
  site_name: string;
  created_datetime?: string;
  updated_datetime?: string;
  aggregator_site_identifier?: string | null;
  battery?: {
    total_nameplate_max_discharge_power: number;
    total_nameplate_max_charge_power: number;
    total_nameplate_energy: number;
    batteries: PowerHubBattery[];
  };
  gateway?: {
    total_gateways: number;
    gateways: PowerHubGateway[];
  };
  inverter?: PowerHubInverter[];
  meter?: PowerHubMeter[];
  evse?: PowerHubEvse[];
}

export interface PowerHubBattery {
  device_id?: string;
  din?: string;
  part_number?: string;
  serial_number?: string;
  nameplate_max_discharge_power_watts?: number;
  nameplate_max_charge_power_watts?: number;
  nameplate_energy_watt_hours?: number;
}

export interface PowerHubGateway {
  device_id: string;
  din?: string;
  part_number?: string;
  serial_number?: string;
  nameplate_max_discharge_power_watts?: number;
  nameplate_max_charge_power_watts?: number;
  nameplate_energy_watt_hours?: number;
}

export interface PowerHubInverter {
  din?: string;
  part_number?: string;
  serial_number?: string;
}

export interface PowerHubMeter {
  din?: string;
  part_number?: string;
  serial_number?: string;
}

export interface PowerHubEvse {
  din?: string;
  part_number?: string;
  serial_number?: string;
}

/** Telemetry signal — each signal returns an array of data_points */
export interface PowerHubTelemetrySignal {
  signal_name: string;
  rollup: string | null;
  derivative: string | null;
  site_id: string;
  data_points: { value: number; timestamp: string }[];
}

export interface PowerHubAlert {
  alert_id: string;
  device_id?: string | null;
  din?: string;
  alert_name: string;
  description: string;
  severity: string; // "Performance", "Critical", "ReturnMerchandiseAuthorization", etc.
  status?: string; // "Open", etc.
  start_time: string;
  end_time?: string | null;
  is_active: boolean;
}

/** Paginated alert response — group-level alerts return up to 100 per page */
export interface PowerHubAlertResponse {
  data: PowerHubAlert[];
  metadata: {
    request_id: string;
    next_cursor?: string;
  };
}

/** Available telemetry signals for a site — maps signal_name → available (true/false) */
export type PowerHubSignalMap = Record<string, boolean>;

export interface PowerHubClient {
  getGroups(): Promise<PowerHubGroup[]>;
  getSiteDetail(siteId: string): Promise<PowerHubSiteDetail>;
  getAvailableSignals(siteId: string): Promise<PowerHubSignalMap>;
  getLastTelemetry(
    targetId: string,
    signals: string[]
  ): Promise<PowerHubTelemetrySignal[]>;
  /** Fetch active alerts for a group (not per-site). Returns paginated results. */
  getActiveAlerts(
    groupId: string,
    cursor?: string
  ): Promise<PowerHubAlertResponse>;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxPerSecond: number) {
    this.maxTokens = maxPerSecond;
    this.tokens = maxPerSecond;
    this.refillRate = maxPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ─── Client Implementation ───────────────────────────────────────────────────

interface CachedToken {
  jwt: string;
  expiresAt: number; // Unix ms
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export function createPowerHubClient(): PowerHubClient {
  if (process.env.POWERHUB_ENABLED !== "true") {
    throw new Error("PowerHub is disabled (POWERHUB_ENABLED != true)");
  }

  const proxyUrl = process.env.TESLA_POWERHUB_PROXY_URL;
  const clientId = process.env.TESLA_POWERHUB_CLIENT_ID;
  const clientSecret = process.env.TESLA_POWERHUB_CLIENT_SECRET;

  if (!proxyUrl || !clientId || !clientSecret) {
    throw new Error(
      "Missing PowerHub env vars: TESLA_POWERHUB_PROXY_URL, TESLA_POWERHUB_CLIENT_ID, TESLA_POWERHUB_CLIENT_SECRET"
    );
  }

  let cachedToken: CachedToken | null = null;
  let tokenPromise: Promise<string> | null = null;
  const rateLimiter = new TokenBucket(4); // 4 req/sec (under Tesla's 5 limit)

  async function getToken(): Promise<string> {
    // Return cached if still valid (with 60s buffer)
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.jwt;
    }

    // Deduplicate concurrent token requests
    if (tokenPromise) {
      return tokenPromise;
    }

    tokenPromise = (async () => {
      try {
        // OAuth2 client_credentials grant per Tesla PowerHub docs:
        // POST /v1/auth/token with Basic Auth (client_id:client_secret)
        // Response: { meta, data: { access_token, token_type }, links }
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        const res = await fetch(`${proxyUrl}/v1/auth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: "grant_type=client_credentials",
        });

        if (!res.ok) {
          throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
        }

        const envelope: PowerHubTokenEnvelope = await res.json();
        const jwt = envelope.data.access_token;

        // Derive expiry from JWT `exp` claim (base64-decode the payload)
        let expiresAt = Date.now() + 600_000; // fallback: 10 minutes
        try {
          const payloadB64 = jwt.split(".")[1];
          const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
          if (payload.exp) {
            expiresAt = payload.exp * 1000;
          }
        } catch {
          // If JWT parsing fails, use the fallback expiry
        }

        cachedToken = { jwt, expiresAt };
        return cachedToken.jwt;
      } finally {
        tokenPromise = null;
      }
    })();

    return tokenPromise;
  }

  function clearToken(): void {
    cachedToken = null;
  }

  /**
   * Make an authenticated API call to the Tesla PowerHub /v2/ data API.
   * All responses are wrapped in { data: T } — this function unwraps automatically.
   */
  async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const token = await getToken();
      const url = `${proxyUrl}/v2${path}`;

      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (res.ok) {
        const envelope = (await res.json()) as PowerHubEnvelope<T>;
        return envelope.data;
      }

      // 401: clear token, re-auth, retry once
      if (res.status === 401 && attempt === 0) {
        clearToken();
        continue;
      }

      // 403: immediate failure (IP allowlist or credentials issue)
      if (res.status === 403) {
        throw new Error(
          `PowerHub API 403 Forbidden: ${path} — check IP allowlist or client credentials`
        );
      }

      // 429 or 5xx: exponential backoff
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`PowerHub API ${res.status}: ${path}`);
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw new Error(`PowerHub API ${res.status}: ${await res.text()}`);
    }

    throw lastError || new Error("PowerHub API: max retries exceeded");
  }

  // ─── Endpoint Wrappers ─────────────────────────────────────────────────────

  return {
    async getGroups() {
      return apiCall<PowerHubGroup[]>("/asset/groups");
    },

    async getSiteDetail(siteId: string) {
      return apiCall<PowerHubSiteDetail>(`/asset/sites/${siteId}`);
    },

    async getAvailableSignals(siteId: string) {
      return apiCall<PowerHubSignalMap>(
        `/telemetry/signals?target_id=${siteId}`
      );
    },

    async getLastTelemetry(targetId: string, signals: string[]) {
      const signalList = signals.join(",");
      return apiCall<PowerHubTelemetrySignal[]>(
        `/telemetry/last?target_id=${targetId}&signals=${signalList}`
      );
    },

    async getActiveAlerts(groupId: string, cursor?: string) {
      let path = `/alerts/last?target_id=${groupId}&active_only=true`;
      if (cursor) {
        path += `&cursor=${cursor}`;
      }
      // This endpoint returns { data, metadata } at top level,
      // but apiCall already unwraps the outer { data } envelope.
      // However, the alerts endpoint wraps differently — it puts
      // data and metadata at the top level. So we need the raw response.
      await rateLimiter.acquire();
      const token = await getToken();
      const url = `${proxyUrl}/v2${path}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        throw new Error(`PowerHub API ${res.status}: ${path}`);
      }
      return (await res.json()) as PowerHubAlertResponse;
    },
  };
}

/**
 * Compute the Tesla GridLogic portal deep-link URL for a site.
 * Template is configurable via TESLA_POWERHUB_PORTAL_URL_TEMPLATE env var.
 * Returns null for empty/whitespace siteId.
 *
 * The {siteId} placeholder is URL-encoded so the function is safe for any
 * site identifier shape Tesla might return (even though current UUIDs are
 * URL-safe).
 */
export function computePortalUrl(siteId: string): string | null {
  const trimmed = siteId?.trim();
  if (!trimmed) return null;
  const template =
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE ||
    "https://gridlogic.tesla.com/sites/{siteId}";
  return template.replaceAll("{siteId}", encodeURIComponent(trimmed));
}
