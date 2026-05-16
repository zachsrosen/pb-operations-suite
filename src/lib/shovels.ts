/**
 * Shovels API Client
 *
 * Typed wrapper around the Shovels construction data API.
 * Used for property enrichment — address search, permit lookup,
 * resident data, contractor details, and credit monitoring.
 *
 * Architecture:
 * - Auth via X-API-Key header (no OAuth, no token refresh)
 * - Token bucket rate limiter (2 req/sec, conservative)
 * - Exponential backoff on 429/5xx
 * - Credit tracking via response headers (X-Credits-Remaining)
 *
 * Required env vars:
 * - SHOVELS_API_KEY — API key from Shovels dashboard
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShovelsAddress {
  street_no: string | null;
  street: string | null;
  city: string | null;
  county: string | null;
  zip_code: string | null;
  zip_code_ext: string | null;
  state: string | null;
  jurisdiction: string | null;
  lat: number | null;
  long: number | null;
  geo_id: string;
  name: string;
}

export interface ShovelsPermit {
  // Property characteristics (from tax assessor records)
  property_census_tract: string | null;
  property_congressional_district: string | null;
  property_type: string | null;
  property_type_detail: string | null;
  property_legal_owner: string | null;
  property_owner_type: string | null;
  property_lot_size: number | null;
  property_building_area: number | null;
  property_story_count: number | null;
  property_unit_count: number | null;
  property_year_built: number | null;
  property_assess_market_value: number | null;

  // Permit fields
  id: string;
  number: string | null;
  description: string | null;
  jurisdiction: string | null;
  job_value: number | null;
  type: string | null;
  subtype: string | null;
  fees: number | null;
  status: string | null;
  file_date: string | null;
  issue_date: string | null;
  final_date: string | null;
  start_date: string | null;
  end_date: string | null;
  total_duration: number | null;
  construction_duration: number | null;
  approval_duration: number | null;
  inspection_pass_rate: number | null;
  contractor_id: string | null;
  tags: string[] | null;

  address: {
    street_no: string | null;
    street: string | null;
    city: string | null;
    county: string | null;
    zip_code: string | null;
    zip_code_ext: string | null;
    state: string | null;
    jurisdiction: string | null;
    latlng: [number | null, number | null];
  };
  geo_ids: {
    address_id: string | null;
    city_id: string | null;
    county_id: string | null;
    jurisdiction_id: string | null;
  };
}

export interface ShovelsResidentRecord {
  name: string | null;
  personal_emails: string | null;
  phone: string | null;
  linkedin_url: string | null;
  net_worth: string | null;
  income_range: string | null;
  is_homeowner: boolean | null;
  street_no: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  zip_code_ext: string | null;
}

export interface ShovelsUsage {
  credits_used: number;
  credit_limit: number | null;
  is_over_limit: boolean;
  available_at: string | null;
  daily_usage: { date: string; credits: number; expires: string }[];
}

interface PaginatedResponse<T> {
  items: T[];
  size: number;
  next_cursor: string | null;
  total_count: { value: number; relation: "eq" | "gte" } | null;
}

export interface ShovelsContractorDetail {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  license: string | null;
  classification_derived: string | null;
  total_permits_count: number | null;
  avg_inspection_pass_rate: number | null;
}

// ─── Token Bucket Rate Limiter ───────────────────────────────────────────────

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

// ─── Client ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.shovels.ai/v2";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

/** Last-observed credits remaining (updated after every API call). */
let lastCreditsRemaining: number | null = null;

export function getLastCreditsRemaining(): number | null {
  return lastCreditsRemaining;
}

export interface ShovelsClient {
  searchAddress(query: string): Promise<ShovelsAddress[]>;
  searchPermits(
    geoId: string,
    opts?: { tags?: string; from?: string; to?: string; size?: number; cursor?: string },
  ): Promise<PaginatedResponse<ShovelsPermit>>;
  getResidents(
    geoId: string,
    opts?: { size?: number; cursor?: string },
  ): Promise<PaginatedResponse<ShovelsResidentRecord>>;
  getContractorById(contractorId: string): Promise<ShovelsContractorDetail | null>;
  getUsage(): Promise<ShovelsUsage>;
}

export function createShovelsClient(): ShovelsClient {
  const apiKey = process.env.SHOVELS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SHOVELS_API_KEY env var");
  }

  const rateLimiter = new TokenBucket(2); // 2 req/sec (conservative)

  async function apiCall<T>(path: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimiter.acquire();

      const url = `${BASE_URL}${path}`;
      const res = await fetch(url, {
        headers: { "X-API-Key": apiKey! },
      });

      // Track credit headers
      const remaining = res.headers.get("X-Credits-Remaining");
      if (remaining) {
        lastCreditsRemaining = parseInt(remaining, 10);
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      // 404 on address search = "no matches" — not an error
      if (res.status === 404) {
        return { items: [], size: 0, next_cursor: null, total_count: null } as T;
      }

      // 402: credit limit exceeded
      if (res.status === 402) {
        throw new Error("Shovels API: credit limit exceeded (HTTP 402)");
      }

      // 422: validation error — don't retry
      if (res.status === 422) {
        const body = await res.text();
        throw new Error(`Shovels API 422: ${body}`);
      }

      // 429 or 5xx: exponential backoff
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Shovels API ${res.status}: ${path}`);
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }

      throw new Error(`Shovels API ${res.status}: ${await res.text()}`);
    }

    throw lastError || new Error("Shovels API: max retries exceeded");
  }

  return {
    async searchAddress(query: string) {
      const encoded = encodeURIComponent(query);
      const res = await apiCall<PaginatedResponse<ShovelsAddress> | { detail: string }>(
        `/addresses/search?q=${encoded}`,
      );
      if ("detail" in res) return []; // "No addresses found."
      return res.items;
    },

    async searchPermits(geoId, opts = {}) {
      const params = new URLSearchParams();
      params.set("geo_id", geoId);
      params.set("permit_from", opts.from ?? "2000-01-01");
      params.set("permit_to", opts.to ?? new Date().toISOString().slice(0, 10));
      if (opts.tags) params.set("permit_tags", opts.tags);
      if (opts.size) params.set("size", String(opts.size));
      if (opts.cursor) params.set("cursor", opts.cursor);
      return apiCall<PaginatedResponse<ShovelsPermit>>(`/permits/search?${params}`);
    },

    async getResidents(geoId, opts = {}) {
      const params = new URLSearchParams();
      if (opts.size) params.set("size", String(opts.size));
      if (opts.cursor) params.set("cursor", opts.cursor);
      const qs = params.toString();
      return apiCall<PaginatedResponse<ShovelsResidentRecord>>(
        `/addresses/${geoId}/residents${qs ? `?${qs}` : ""}`,
      );
    },

    async getContractorById(contractorId: string) {
      try {
        const res = await apiCall<PaginatedResponse<ShovelsContractorDetail>>(
          `/contractors/id?ids=${contractorId}`,
        );
        return res.items[0] ?? null;
      } catch {
        return null; // Non-fatal — contractor data is supplementary
      }
    },

    async getUsage() {
      return apiCall<ShovelsUsage>("/usage");
    },
  };
}
