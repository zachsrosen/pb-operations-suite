/**
 * Freshservice REST client — agent-assigned tickets view.
 *
 * The "My Tickets" feature shows tickets ASSIGNED to the logged-in user (as a
 * Freshservice agent), not tickets they filed. Lookup is by agent email;
 * ticket filter uses the `/tickets/filter?query="agent_id:X"` endpoint.
 *
 * Tickets are cached 60s; agent-id lookups 10m (rarely change).
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
const agentCache = new CacheStore(10 * 60_000, 30 * 60_000);

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

export interface FreshserviceAgent {
  id: number;
  email: string;
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

/**
 * Resolve the Freshservice agent_id for the given email. Agents are
 * support-staff records (distinct from requesters). Returns null when no
 * agent exists for the email.
 */
export async function fetchAgentIdByEmail(email: string): Promise<number | null> {
  if (!email) throw new Error("email required");
  const cacheKey = `freshservice:agent-id:${email.toLowerCase()}`;

  // Positive results cached 10m; negative results NOT cached so a newly
  // added agent is visible immediately.
  const cached = agentCache.get<number | null>(cacheKey);
  if (cached.hit && cached.data !== null && !cached.stale) return cached.data;

  const res = await freshserviceFetch(
    `/api/v2/agents?email=${encodeURIComponent(email)}`
  );
  const body = (await res.json()) as { agents?: FreshserviceAgent[] };
  const first = body.agents?.[0];
  const id = first ? first.id : null;
  if (id !== null) agentCache.set(cacheKey, id);
  return id;
}

/**
 * Fetch tickets assigned to the given agent. Uses the /tickets/filter
 * endpoint (query syntax). Drops Closed tickets (status=5) client-side.
 */
export async function fetchTicketsByAgentId(
  agentId: number
): Promise<FreshserviceTicket[]> {
  const cacheKey = `freshservice:tickets:agent:${agentId}`;
  const { data } = await ticketsCache.getOrFetch<FreshserviceTicket[]>(cacheKey, async () => {
    const all: FreshserviceTicket[] = [];
    const perPage = 30; // filter endpoint caps at 30 per page
    let page = 1;
    while (true) {
      // Query fetches all statuses incl. Closed (Freshservice auto-Closes
      // older Resolved tickets, so excluding 5 hides most "done" work).
      const query = `"agent_id:${agentId} AND (status:2 OR status:3 OR status:4 OR status:5)"`;
      const res = await freshserviceFetch(
        `/api/v2/tickets/filter?query=${encodeURIComponent(query)}&page=${page}`
      );
      const body = (await res.json()) as { tickets?: FreshserviceTicket[]; total?: number };
      const tickets = body.tickets ?? [];
      all.push(...tickets);
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


// ─── Requester-side (user's filed tickets) ─────────────────────────────

export interface FreshserviceRequester {
  id: number;
  primary_email: string;
  first_name: string;
  last_name: string;
}

const requesterCache = new CacheStore(10 * 60_000, 30 * 60_000);

/**
 * Resolve a Freshservice requester id by exact email match. Returns null
 * when no requester exists. Negative results are NOT cached so a newly
 * provisioned account is visible immediately.
 */
export async function fetchRequesterIdByEmail(email: string): Promise<number | null> {
  if (!email) throw new Error("email required");
  const cacheKey = `freshservice:requester-id:${email.toLowerCase()}`;
  const cached = requesterCache.get<number | null>(cacheKey);
  if (cached.hit && cached.data !== null && !cached.stale) return cached.data;

  const res = await freshserviceFetch(
    `/api/v2/requesters?email=${encodeURIComponent(email)}`
  );
  const body = (await res.json()) as { requesters?: FreshserviceRequester[] };
  const first = body.requesters?.[0];
  const id = first ? first.id : null;
  if (id !== null) requesterCache.set(cacheKey, id);
  return id;
}

/**
 * Fallback for users whose session email differs from their Freshservice
 * primary_email (e.g., zach@ vs zach.rosen@). Searches by first + last name.
 */
export async function fetchRequesterIdByName(fullName: string): Promise<number | null> {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const cacheKey = `freshservice:requester-id-by-name:${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
  const cached = requesterCache.get<number | null>(cacheKey);
  if (cached.hit && cached.data !== null && !cached.stale) return cached.data;

  const q = `"first_name:'${firstName}' AND last_name:'${lastName}'"`;
  const res = await freshserviceFetch(
    `/api/v2/requesters?query=${encodeURIComponent(q)}`
  );
  const body = (await res.json()) as { requesters?: FreshserviceRequester[] };
  const first = body.requesters?.[0];
  const id = first ? first.id : null;
  if (id !== null) requesterCache.set(cacheKey, id);
  return id;
}

/** Combinator: try email first, then name. */
export async function fetchRequesterId(
  email: string,
  fullName?: string | null
): Promise<number | null> {
  const byEmail = await fetchRequesterIdByEmail(email);
  if (byEmail !== null) return byEmail;
  if (fullName) return fetchRequesterIdByName(fullName);
  return null;
}

/**
 * Tickets filed BY the given requester. Includes Open + Pending + Resolved
 * + Closed (Freshservice auto-Closes older Resolved tickets, so excluding
 * Closed hides most history).
 */
export async function fetchTicketsByRequesterId(
  requesterId: number
): Promise<FreshserviceTicket[]> {
  const cacheKey = `freshservice:tickets:requester:${requesterId}`;
  const { data } = await ticketsCache.getOrFetch<FreshserviceTicket[]>(cacheKey, async () => {
    const all: FreshserviceTicket[] = [];
    const perPage = 30;
    let page = 1;
    while (true) {
      const query = `"requester_id:${requesterId} AND (status:2 OR status:3 OR status:4 OR status:5)"`;
      const res = await freshserviceFetch(
        `/api/v2/tickets/filter?query=${encodeURIComponent(query)}&page=${page}`
      );
      const body = (await res.json()) as { tickets?: FreshserviceTicket[] };
      const tickets = body.tickets ?? [];
      all.push(...tickets);
      if (tickets.length < perPage) break;
      page++;
      if (page > 20) break;
    }
    return all;
  });
  return data;
}
