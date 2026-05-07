/**
 * Tesla PowerHub API Client
 *
 * Handles JWT authentication, rate limiting, and typed endpoint wrappers
 * for the PowerHub API.
 *
 * Architecture:
 * - Our Vercel functions call Tesla's API directly (plain HTTPS)
 * - API key + instance ID → JWT token (10-min expiry, cached in module state)
 * - Token bucket rate limiter stays under Tesla's 5 req/sec limit
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PowerHubTokenResponse {
  token: string;
  expires_in: number; // seconds
}

export interface PowerHubGroup {
  group_id: string;
  group_name: string;
  subgroups?: PowerHubGroup[];
  sites?: { site_id: string; site_name: string }[];
}

export interface PowerHubSiteDetail {
  site_id: string;
  site_name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  equipment?: PowerHubDevice[];
}

export interface PowerHubDevice {
  device_id: string;
  din?: string;
  device_type: string; // "gateway", "battery", "inverter", "meter"
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  nameplate_energy_wh?: number;
  nameplate_power_w?: number;
}

export interface PowerHubTelemetrySignal {
  signal_name: string;
  value: number | string | null;
  timestamp: string;
}

export interface PowerHubAlert {
  alert_id: string;
  device_id?: string;
  din?: string;
  alert_name: string;
  description: string;
  severity: "informational" | "performance" | "critical";
  origin: string;
  reported_at: string;
  resolved_at?: string;
  is_active: boolean;
}

export interface PowerHubClient {
  getGroups(): Promise<{ groups: PowerHubGroup[] }>;
  getSites(): Promise<{ sites: { site_id: string; site_name: string }[] }>;
  getSiteDetail(siteId: string): Promise<PowerHubSiteDetail>;
  getLastTelemetry(
    targetId: string,
    signals: string[]
  ): Promise<{ signals: PowerHubTelemetrySignal[] }>;
  getActiveAlerts(
    siteId: string,
    sinceTime?: string
  ): Promise<{ alerts: PowerHubAlert[] }>;
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

  const baseUrl = process.env.TESLA_POWERHUB_BASE_URL || "https://gridlogic-api.sn.tesla.services/v2";
  const instanceId = process.env.TESLA_POWERHUB_INSTANCE_ID;
  const apiKey = process.env.TESLA_POWERHUB_API_KEY;

  if (!instanceId || !apiKey) {
    throw new Error(
      "Missing PowerHub env vars: TESLA_POWERHUB_INSTANCE_ID, TESLA_POWERHUB_API_KEY"
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
        const res = await fetch(`${baseUrl}/asset/tokens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, instance_id: instanceId }),
        });

        if (!res.ok) {
          throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
        }

        const data: PowerHubTokenResponse = await res.json();
        cachedToken = {
          jwt: data.token,
          expiresAt: Date.now() + data.expires_in * 1000,
        };
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

  async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const token = await getToken();
      const url = `${baseUrl}${path}`;

      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (res.ok) {
        return res.json() as Promise<T>;
      }

      // 401: clear token, re-auth, retry once
      if (res.status === 401 && attempt === 0) {
        clearToken();
        continue;
      }

      // 403: immediate failure (IP/cert issue)
      if (res.status === 403) {
        throw new Error(
          `PowerHub API 403 Forbidden: ${path} — check API credentials or IP allowlist`
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
      return apiCall<{ groups: PowerHubGroup[] }>(
        `/asset/groups?instance_id=${instanceId}`
      );
    },

    async getSites() {
      return apiCall<{ sites: { site_id: string; site_name: string }[] }>(
        `/asset/sites?instance_id=${instanceId}`
      );
    },

    async getSiteDetail(siteId: string) {
      return apiCall<PowerHubSiteDetail>(`/asset/sites/${siteId}`);
    },

    async getLastTelemetry(targetId: string, signals: string[]) {
      const signalList = signals.join(",");
      return apiCall<{ signals: PowerHubTelemetrySignal[] }>(
        `/telemetry/last?target_id=${targetId}&signals=${signalList}`
      );
    },

    async getActiveAlerts(siteId: string, sinceTime?: string) {
      let path = `/alerts/last?target_id=${siteId}&active_only=true`;
      if (sinceTime) {
        path += `&since_time=${sinceTime}`;
      }
      return apiCall<{ alerts: PowerHubAlert[] }>(path);
    },
  };
}
