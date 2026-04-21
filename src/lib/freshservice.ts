/**
 * Freshservice REST client.
 *
 * Requester filtering uses a two-step documented path:
 *   1. GET /api/v2/requesters?email=<email>  → requester_id
 *   2. GET /api/v2/tickets?requester_id=<id>&per_page=100&page=N
 *
 * Tickets are cached 60s; requester-id lookups 10m (they rarely change).
 *
 * Status codes: 2=Open, 3=Pending, 4=Resolved, 5=Closed.
 * Priority codes: 1=Low, 2=Medium, 3=High, 4=Urgent.
 */

import * as Sentry from "@sentry/nextjs";
import { CacheStore } from "@/lib/cache";

const FRESHSERVICE_API_KEY = process.env.FRESHSERVICE_API_KEY;
const FRESHSERVICE_DOMAIN = process.env.FRESHSERVICE_DOMAIN || "photonbrothers";
const FRESHSERVICE_BASE = `https://${FRESHSERVICE_DOMAIN}.freshservice.com`;

const ticketsCache = new CacheStore(60_000, 120_000);
const requesterCache = new CacheStore(10 * 60_000, 30 * 60_000);

// ─── Types ──────────────────────────────────────────────────────────────

export interface FreshserviceTicket {
  id: number;
  subject: string;
  status: number;
  priority: number;
  created_at: string;
  updated_at: string;
  due_by: string | null;
  fr_due_by: string | null;
  description_text: string;
  requester_id: number;
  responder_id: number | null;
  type: string | null;
  category: string | null;
}

export interface FreshserviceRequester {
  id: number;
  primary_email: string;
  first_name: string;
  last_name: string;
}

export const FRESHSERVICE_STATUS_LABELS: Record<number, string> = {
  2: "Open",
  3: "Pending",
  4: "Resolved",
  5: "Closed",
};

export const FRESHSERVICE_PRIORITY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

// ─── Fetch wrapper ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function freshserviceFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!FRESHSERVICE_API_KEY) {
    throw new Error("FRESHSERVICE_API_KEY not set");
  }

  const auth = Buffer.from(`${FRESHSERVICE_API_KEY}:X`).toString("base64");

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${FRESHSERVICE_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      Sentry.withScope((scope) => {
        scope.setTag("integration", "freshservice");
        scope.setTag(
          "failure_type",
          res.status === 401 || res.status === 403 ? "auth" : "unknown"
        );
        scope.setExtra("endpoint", endpoint);
        scope.setExtra("status", res.status);
        Sentry.captureMessage(`Freshservice ${res.status} on ${endpoint}`);
      });
      const text = await res.text().catch(() => "");
      throw new Error(`Freshservice ${res.status}: ${text.slice(0, 200)}`);
    }

    return res;
  }
  throw new Error("Freshservice: max retries exceeded");
}

// ─── Public API ─────────────────────────────────────────────────────────

export async function fetchRequesterIdByEmail(email: string): Promise<number | null> {
  if (!email) throw new Error("email required");
  const cacheKey = `freshservice:requester-id:${email.toLowerCase()}`;
  const { data } = await requesterCache.getOrFetch<number | null>(cacheKey, async () => {
    const res = await freshserviceFetch(
      `/api/v2/requesters?email=${encodeURIComponent(email)}`
    );
    const body = (await res.json()) as { requesters?: FreshserviceRequester[] };
    const first = body.requesters?.[0];
    return first ? first.id : null;
  });
  return data;
}

export async function fetchTicketsByRequesterId(
  requesterId: number
): Promise<FreshserviceTicket[]> {
  const cacheKey = `freshservice:tickets:${requesterId}`;
  const { data } = await ticketsCache.getOrFetch<FreshserviceTicket[]>(cacheKey, async () => {
    const all: FreshserviceTicket[] = [];
    const perPage = 100;
    let page = 1;
    while (true) {
      const res = await freshserviceFetch(
        `/api/v2/tickets?requester_id=${requesterId}&per_page=${perPage}&page=${page}&order_by=created_at&order_type=desc`
      );
      const body = (await res.json()) as { tickets?: FreshserviceTicket[] };
      const tickets = body.tickets ?? [];
      all.push(...tickets.filter((t) => t.status !== 5)); // drop Closed
      if (tickets.length < perPage) break;
      page++;
      if (page > 20) break; // hard cap
    }
    return all;
  });
  return data;
}

export async function fetchTicketDetail(id: number): Promise<FreshserviceTicket> {
  const cacheKey = `freshservice:ticket:${id}`;
  const { data } = await ticketsCache.getOrFetch<FreshserviceTicket>(cacheKey, async () => {
    const res = await freshserviceFetch(`/api/v2/tickets/${id}?include=stats`);
    const body = (await res.json()) as { ticket: FreshserviceTicket };
    return body.ticket;
  });
  return data;
}
