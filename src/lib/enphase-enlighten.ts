/**
 * Enphase Enlighten API Client
 *
 * Handles OAuth2 authorization code grant with refresh token rotation,
 * rate limiting, and typed endpoint wrappers for the Enphase v4 API.
 *
 * Architecture:
 * - Optional Fly.io proxy via ENPHASE_PROXY_URL (for IP allowlisting)
 * - Auth uses OAuth2 authorization code grant (installer account)
 * - Refresh tokens rotate: each refresh returns a NEW token that must be persisted
 * - Refresh token stored in SystemConfig DB row (not env var) for cold-start safety
 * - Token bucket rate limiter stays under Enphase's ~10 req/sec limit
 * - Data endpoints live under /api/v4/ prefix
 *
 * Required env vars:
 * - ENPHASE_API_KEY           — API key from Enphase developer portal
 * - ENPHASE_CLIENT_ID         — OAuth app client ID
 * - ENPHASE_CLIENT_SECRET     — OAuth app client secret
 * - ENPHASE_REFRESH_TOKEN     — Initial seed refresh token (DB takes precedence after first use)
 *
 * Optional env vars:
 * - ENPHASE_PROXY_URL         — Fly.io proxy URL (omit to call api.enphaseenergy.com directly)
 * - ENPHASE_PORTAL_URL_TEMPLATE — Portal deep-link template (default: Enlighten URL)
 */

import { prisma } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnphaseSystem {
  system_id: number;
  system_name: string;
  system_public_name: string;
  status: string;
  timezone: string;
  connection_type: string;
  meta: {
    enroll_date: string;
    operational_date: string;
    last_report_date: string;
    last_energy_at: number;
    operational_at: number;
  };
  energy_lifetime: number;
  energy_today: number;
  system_size: number; // watts DC
  address: {
    state: string;
    country: string;
    postal_code: string;
    city?: string;
    address1?: string;
    address2?: string;
  };
  modules: number;
}

export interface EnphaseSystemSummary {
  system_id: number;
  current_power: number;       // watts
  energy_lifetime: number;     // Wh
  energy_today: number;        // Wh
  last_report_at: number;      // Unix epoch
  status: string;
  modules: number;
  size_w: number;
  summary_date: string;
  last_interval_end_at: number;
  // Consumption (if CT meters present)
  current_consumption?: number;
  consumption_today?: number;
  consumption_lifetime?: number;
}

export interface EnphaseDevices {
  micro_inverters?: EnphaseMicroInverter[];
  batteries?: EnphaseBattery[];
  encharges?: EnphaseEncharge[];
  enpower?: EnphaseEnpower[];
  meters?: EnphaseMeter[];
}

export interface EnphaseMicroInverter {
  id: number;
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  producing: boolean;
}

export interface EnphaseBattery {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  percent_full: number;
}

export interface EnphaseEncharge {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
  percent_full: number;
}

export interface EnphaseEnpower {
  serial_number: string;
  model: string;
  part_number: string;
  status: string;
  last_report_date: string;
}

export interface EnphaseMeter {
  serial_number: string;
  model: string;
  status: string;
  state: string;
}

export interface EnphaseProductionStats {
  system_id: number;
  granularity: string;
  intervals: { end_at: number; wh_del: number; devices_reporting: number }[];
  meta: { status: string; last_report_at: number };
}

export interface EnphaseConsumptionStats {
  system_id: number;
  granularity: string;
  intervals: { end_at: number; wh_del: number; devices_reporting: number }[];
}

export interface EnphaseBatteryTelemetry {
  system_id: number;
  intervals: {
    end_at: number;
    charge_energy_wh: number;
    discharge_energy_wh: number;
    soc: number;
  }[];
}

export interface EnphaseBatteryLifetime {
  system_id: number;
  start_date: string;
  charge_energy_wh: number[];
  discharge_energy_wh: number[];
}

export interface EnphaseClient {
  listSystems(): Promise<EnphaseSystem[]>;
  getSystemSummary(systemId: number): Promise<EnphaseSystemSummary>;
  getSystemDevices(systemId: number): Promise<EnphaseDevices>;
  getProductionStats(systemId: number): Promise<EnphaseProductionStats>;
  getConsumptionStats(systemId: number): Promise<EnphaseConsumptionStats>;
  getBatteryTelemetry(systemId: number): Promise<EnphaseBatteryTelemetry>;
  getBatteryLifetime(systemId: number): Promise<EnphaseBatteryLifetime>;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

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

// ─── Token Persistence ──────────────────────────────────────────────────────

const REFRESH_TOKEN_KEY = "enphase_refresh_token";

/**
 * Read the current refresh token. Priority: DB SystemConfig → env var fallback.
 */
async function readRefreshToken(): Promise<string | null> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: REFRESH_TOKEN_KEY } });
    if (row?.value) return row.value;
  } catch {
    // DB read failure — fall through to env
  }
  return process.env.ENPHASE_REFRESH_TOKEN || null;
}

/**
 * Persist a new refresh token to DB. Called after every successful token refresh
 * because Enphase rotates refresh tokens (old one is invalidated).
 */
async function persistRefreshToken(token: string): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: REFRESH_TOKEN_KEY },
    create: { key: REFRESH_TOKEN_KEY, value: token },
    update: { value: token },
  });
}

// ─── Client Implementation ───────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const ENPHASE_API_BASE = "https://api.enphaseenergy.com";

export function createEnphaseClient(): EnphaseClient {
  if (process.env.ENPHASE_ENABLED !== "true") {
    throw new Error("Enphase is disabled (ENPHASE_ENABLED != true)");
  }

  const apiKey = process.env.ENPHASE_API_KEY;
  const clientId = process.env.ENPHASE_CLIENT_ID;
  const clientSecret = process.env.ENPHASE_CLIENT_SECRET;

  if (!apiKey || !clientId || !clientSecret) {
    throw new Error(
      "Missing Enphase env vars: ENPHASE_API_KEY, ENPHASE_CLIENT_ID, ENPHASE_CLIENT_SECRET"
    );
  }

  const baseUrl = process.env.ENPHASE_PROXY_URL || ENPHASE_API_BASE;
  let cachedToken: CachedToken | null = null;
  let tokenPromise: Promise<string> | null = null;
  const rateLimiter = new TokenBucket(8);

  async function getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.accessToken;
    }

    if (tokenPromise) return tokenPromise;

    tokenPromise = (async () => {
      try {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) {
          throw new Error(
            "No Enphase refresh token available. Run Partner setup at /api/admin/enphase/oauth/partner-setup (or developer flow at /api/admin/enphase/oauth/authorize)"
          );
        }

        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const res = await fetch(`${ENPHASE_API_BASE}/oauth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Enphase token refresh failed: ${res.status} ${body}`);
        }

        const data = await res.json();
        const accessToken: string = data.access_token;
        const newRefreshToken: string = data.refresh_token;

        // Persist the rotated refresh token — old one is now invalid
        await persistRefreshToken(newRefreshToken);

        // Cache access token with expiry
        const expiresIn = (data.expires_in || 43200) * 1000; // default 12hr
        cachedToken = { accessToken, expiresAt: Date.now() + expiresIn };

        return accessToken;
      } finally {
        tokenPromise = null;
      }
    })();

    return tokenPromise;
  }

  function clearToken(): void {
    cachedToken = null;
  }

  async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const token = await getToken();
      const separator = path.includes("?") ? "&" : "?";
      const url = `${baseUrl}${path}${separator}key=${apiKey}`;

      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 401 && attempt === 0) {
        clearToken();
        continue;
      }

      if (res.status === 403) {
        throw new Error(`Enphase API 403 Forbidden: ${path}`);
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Enphase API ${res.status}: ${path}`);
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw new Error(`Enphase API ${res.status}: ${await res.text()}`);
    }

    throw lastError || new Error("Enphase API: max retries exceeded");
  }

  // ─── Endpoint Wrappers ─────────────────────────────────────────────────────

  return {
    async listSystems() {
      // Enphase paginates with ?next= cursor
      const MAX_PAGES = 100;
      const all: EnphaseSystem[] = [];
      let next: string | undefined;
      let pages = 0;
      do {
        const path = next
          ? `/api/v4/systems?next=${next}`
          : "/api/v4/systems";
        const page = await apiCall<{ systems: EnphaseSystem[]; next?: string }>(path);
        all.push(...(page.systems || []));
        next = page.next;
        pages++;
        if (pages >= MAX_PAGES) {
          console.warn(`[enphase] listSystems hit MAX_PAGES (${MAX_PAGES}), stopping pagination`);
          break;
        }
      } while (next);
      return all;
    },

    async getSystemSummary(systemId: number) {
      return apiCall<EnphaseSystemSummary>(`/api/v4/systems/${systemId}/summary`);
    },

    async getSystemDevices(systemId: number) {
      return apiCall<EnphaseDevices>(`/api/v4/systems/${systemId}/devices`);
    },

    async getProductionStats(systemId: number) {
      return apiCall<EnphaseProductionStats>(
        `/api/v4/systems/${systemId}/telemetry/production_meter`
      );
    },

    async getConsumptionStats(systemId: number) {
      return apiCall<EnphaseConsumptionStats>(
        `/api/v4/systems/${systemId}/telemetry/consumption_meter`
      );
    },

    async getBatteryTelemetry(systemId: number) {
      return apiCall<EnphaseBatteryTelemetry>(
        `/api/v4/systems/${systemId}/telemetry/battery`
      );
    },

    async getBatteryLifetime(systemId: number) {
      return apiCall<EnphaseBatteryLifetime>(
        `/api/v4/systems/${systemId}/battery_lifetime`
      );
    },
  };
}

/**
 * Compute the Enlighten portal deep-link URL for a system.
 */
export function computeEnphasePortalUrl(systemId: number): string | null {
  if (!systemId) return null;
  const template =
    process.env.ENPHASE_PORTAL_URL_TEMPLATE ||
    "https://enlighten.enphaseenergy.com/systems/{systemId}";
  return template.replaceAll("{systemId}", String(systemId));
}
