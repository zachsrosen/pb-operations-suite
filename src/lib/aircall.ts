/**
 * Aircall Public API client.
 *
 * REST API: https://developer.aircall.io/api-references/
 * Auth: HTTP Basic with API_ID:API_TOKEN.
 * Rate limit: 60 req/min per integration. We backoff on 429 with the
 * `Retry-After` header when present.
 *
 * This module is pure transport — webhook/cron/backfill handlers persist results.
 */

import * as Sentry from "@sentry/nextjs";

const AIRCALL_API_BASE = "https://api.aircall.io/v1";

export interface AircallCall {
  id: number; // Aircall returns numeric IDs; we cast to string before persistence
  direct_link?: string;
  direction: "inbound" | "outbound";
  status: "initial" | "answered" | "done";
  missed_call_reason?: string | null;
  started_at: number; // unix seconds
  answered_at: number | null; // unix seconds
  ended_at: number | null; // unix seconds
  duration: number; // seconds, total wall time
  voicemail?: string | null; // url string when present
  recording?: string | null;
  asset?: string | null;
  raw_digits?: string | null;
  archived?: boolean;
  cost?: string | null;
  number?: { id?: number; name?: string; digits?: string };
  user?: { id: number; name?: string; email?: string };
  contact?: { id?: number | null; first_name?: string; last_name?: string } | null;
  tags?: Array<{ id: number; name: string }>;
  comments?: Array<{ id: number; content: string }>;
  participants?: Array<{ type?: string; id?: number; name?: string }>;
}

export interface AircallUser {
  id: number;
  direct_link?: string;
  name: string;
  email?: string;
  available?: boolean;
  availability_status?: string;
  do_not_disturb?: boolean;
  archived?: boolean;
}

interface AircallListResponse {
  meta: {
    count: number;
    total: number;
    current_page: number;
    per_page: number;
    next_page_link?: string | null;
    previous_page_link?: string | null;
  };
  // Aircall returns either `calls: [...]` or `users: [...]` etc.
  // We discriminate on key at call sites.
  [k: string]: unknown;
}

export interface ListCallsParams {
  from?: Date;
  to?: Date;
  page?: number;
  perPage?: number; // max 50
  direction?: "inbound" | "outbound";
  userId?: string | number;
}

export interface ListUsersParams {
  page?: number;
  perPage?: number;
  archived?: boolean;
}

/** Throwable returned on 4xx/5xx after retries are exhausted. */
export class AircallApiError extends Error {
  constructor(public status: number, public body: string, message?: string) {
    super(message ?? `Aircall API error ${status}: ${body.slice(0, 200)}`);
    this.name = "AircallApiError";
  }
}

const DEFAULT_RETRIES = 3;
const BACKOFF_BASE_MS = 750;

function authHeader(apiId: string, apiToken: string): string {
  const token = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class AircallClient {
  private apiId: string;
  private apiToken: string;

  constructor(apiId: string = process.env.AIRCALL_API_ID ?? "", apiToken: string = process.env.AIRCALL_API_TOKEN ?? "") {
    this.apiId = apiId;
    this.apiToken = apiToken;
  }

  /** True when env-configured and ready for live API calls. */
  isConfigured(): boolean {
    return Boolean(this.apiId && this.apiToken);
  }

  private async fetchWithRetry(url: string, init?: RequestInit, attempt = 0): Promise<Response> {
    if (!this.isConfigured()) {
      throw new AircallApiError(0, "", "Aircall API credentials are not configured (AIRCALL_API_ID/AIRCALL_API_TOKEN).");
    }

    const headers = {
      ...(init?.headers ?? {}),
      Authorization: authHeader(this.apiId, this.apiToken),
      Accept: "application/json",
    } as Record<string, string>;

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      if (attempt >= DEFAULT_RETRIES) throw err;
      const wait = BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(wait);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    if (res.status === 429) {
      if (attempt >= DEFAULT_RETRIES) {
        const body = await res.text().catch(() => "");
        throw new AircallApiError(429, body, "Aircall rate limit exceeded after retries");
      }
      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const wait = retryAfter > 0 ? retryAfter * 1000 : BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(wait);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    if (res.status >= 500 && attempt < DEFAULT_RETRIES) {
      await sleep(BACKOFF_BASE_MS * 2 ** attempt);
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AircallApiError(res.status, body);
    }

    return res;
  }

  async listCalls(params: ListCallsParams = {}): Promise<{ calls: AircallCall[]; meta: AircallListResponse["meta"] }> {
    const search = new URLSearchParams();
    if (params.from) search.set("from", String(Math.floor(params.from.getTime() / 1000)));
    if (params.to) search.set("to", String(Math.floor(params.to.getTime() / 1000)));
    if (params.direction) search.set("direction", params.direction);
    if (params.userId !== undefined) search.set("user_id", String(params.userId));
    search.set("page", String(params.page ?? 1));
    search.set("per_page", String(Math.min(params.perPage ?? 50, 50)));
    search.set("order", "asc");
    search.set("order_by", "started_at");

    const url = `${AIRCALL_API_BASE}/calls?${search.toString()}`;
    const res = await this.fetchWithRetry(url);
    const json = (await res.json()) as AircallListResponse;
    Sentry.addBreadcrumb({ category: "aircall", message: "listCalls", data: { count: (json.calls as AircallCall[] | undefined)?.length ?? 0, page: params.page } });
    return { calls: (json.calls as AircallCall[]) ?? [], meta: json.meta };
  }

  /**
   * Page through all calls in a date range. Sleeps `pageDelayMs` between pages
   * (default 1100ms) to stay safely under the 60 req/min limit during backfill.
   * Yields one page at a time so callers can persist incrementally.
   */
  async *iterateCalls(params: ListCallsParams & { pageDelayMs?: number }): AsyncGenerator<AircallCall[]> {
    let page = params.page ?? 1;
    const pageDelayMs = params.pageDelayMs ?? 1100;
    while (true) {
      const { calls, meta } = await this.listCalls({ ...params, page, perPage: params.perPage ?? 50 });
      yield calls;
      if (!meta.next_page_link || calls.length === 0) return;
      page += 1;
      if (pageDelayMs > 0) await sleep(pageDelayMs);
    }
  }

  async listUsers(params: ListUsersParams = {}): Promise<{ users: AircallUser[]; meta: AircallListResponse["meta"] }> {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("per_page", String(Math.min(params.perPage ?? 50, 50)));
    if (params.archived !== undefined) search.set("archived", String(params.archived));
    const url = `${AIRCALL_API_BASE}/users?${search.toString()}`;
    const res = await this.fetchWithRetry(url);
    const json = (await res.json()) as AircallListResponse;
    return { users: (json.users as AircallUser[]) ?? [], meta: json.meta };
  }

  async getCall(id: number | string): Promise<AircallCall | null> {
    const url = `${AIRCALL_API_BASE}/calls/${id}`;
    try {
      const res = await this.fetchWithRetry(url);
      const json = (await res.json()) as { call: AircallCall };
      return json.call ?? null;
    } catch (err) {
      if (err instanceof AircallApiError && err.status === 404) return null;
      throw err;
    }
  }
}

/** Singleton for app-level use. Tests can construct their own instance. */
export const aircall = new AircallClient();
