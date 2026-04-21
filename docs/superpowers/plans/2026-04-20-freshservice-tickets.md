# Freshservice Tickets Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only page listing the current user's open/pending Freshservice tickets, plus a count badge in the UserMenu, read-only v1.

**Architecture:** Typed REST client (`lib/freshservice.ts`) with dedicated `CacheStore` instances (60s ticket cache, 10m requester-id cache) → three Next.js API routes under `/api/admin/freshservice/` → client page at `/admin/freshservice` using existing admin-shell primitives → UserMenu gets gated useEffect that pings the count endpoint when `userRole === "ADMIN"`. Requester filtering uses documented two-step: `/api/v2/requesters?email=` → `/api/v2/tickets?requester_id=`.

**Tech Stack:** Next.js 16, React 19, TypeScript, NextAuth v5, React Query v5, Jest, existing `admin-shell/*` components, existing `lib/cache.ts` `CacheStore`.

**Spec:** `docs/superpowers/specs/2026-04-20-freshservice-tickets-integration-design.md`

---

## File Structure

### New files
- `src/lib/freshservice.ts` — REST client (fetch wrapper + typed helpers + cache instances)
- `src/__tests__/freshservice.test.ts` — unit tests for the client
- `src/app/api/admin/freshservice/tickets/route.ts` — GET list
- `src/app/api/admin/freshservice/tickets/[id]/route.ts` — GET detail with requester_id auth check
- `src/app/api/admin/freshservice/count/route.ts` — GET aggregated counts
- `src/app/admin/freshservice/page.tsx` — admin page (client component)
- `scripts/_grant-freshservice-access.ts` — one-off script: add routes to a user's `extraAllowedRoutes`

### Modified files
- `src/components/UserMenu.tsx` — add gated fetch + menu item with badge
- `src/components/admin-shell/nav.ts` — add Freshservice entry, rename Tickets → Bug reports
- `src/lib/roles.ts` — add two paths to `ADMIN_ONLY_EXCEPTIONS`
- `src/lib/query-keys.ts` — add `freshservice` domain

### Unchanged (verified during design)
- `src/lib/page-directory.ts` — contains route paths only, no labels to rename
- `src/app/handbook/page.tsx:390` — already uses "Bug Reports" title
- `src/middleware.ts` — already enforces `ADMIN_ONLY_ROUTES` + `ADMIN_ONLY_EXCEPTIONS` via `isPathAllowedByAccess`

---

## Chunk 1: Freshservice client + tests

### Task 1: Create the Freshservice REST client

**Files:**
- Create: `src/lib/freshservice.ts`

- [ ] **Step 1: Write the client module**

Create `src/lib/freshservice.ts` with the following content:

```ts
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
        scope.setTag("failure_type", res.status === 401 || res.status === 403 ? "auth" : "unknown");
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/freshservice.ts
git commit -m "feat(freshservice): add REST client with requester/ticket lookups"
```

### Task 2: Unit tests for the Freshservice client

**Files:**
- Create: `src/__tests__/freshservice.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/freshservice.test.ts`:

```ts
import {
  fetchRequesterIdByEmail,
  fetchTicketsByRequesterId,
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
} from "@/lib/freshservice";

// Reset module state between tests to clear the in-module caches.
beforeEach(() => {
  jest.resetModules();
  process.env.FRESHSERVICE_API_KEY = "test-key";
  process.env.FRESHSERVICE_DOMAIN = "testdomain";
  global.fetch = jest.fn() as unknown as typeof fetch;
});

describe("FRESHSERVICE_STATUS_LABELS", () => {
  it("maps status codes to labels", () => {
    expect(FRESHSERVICE_STATUS_LABELS[2]).toBe("Open");
    expect(FRESHSERVICE_STATUS_LABELS[5]).toBe("Closed");
  });
});

describe("FRESHSERVICE_PRIORITY_LABELS", () => {
  it("maps priority codes to labels", () => {
    expect(FRESHSERVICE_PRIORITY_LABELS[1]).toBe("Low");
    expect(FRESHSERVICE_PRIORITY_LABELS[4]).toBe("Urgent");
  });
});

describe("fetchRequesterIdByEmail", () => {
  it("returns null when no requester matches", async () => {
    const { fetchRequesterIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ requesters: [] }),
    });
    const id = await fetchRequesterIdByEmail("nobody@example.com");
    expect(id).toBeNull();
  });

  it("returns the first requester's id", async () => {
    const { fetchRequesterIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requesters: [{ id: 42, primary_email: "x@y.com", first_name: "X", last_name: "Y" }],
      }),
    });
    const id = await fetchRequesterIdByEmail("x@y.com");
    expect(id).toBe(42);
  });

  it("sends HTTP Basic auth header", async () => {
    const { fetchRequesterIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ requesters: [] }),
    });
    await fetchRequesterIdByEmail("x@y.com");
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const expected = `Basic ${Buffer.from("test-key:X").toString("base64")}`;
    expect(opts.headers.Authorization).toBe(expected);
  });
});

describe("fetchTicketsByRequesterId", () => {
  it("paginates until a short page and excludes Closed tickets", async () => {
    const { fetchTicketsByRequesterId } = await import("@/lib/freshservice");
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      subject: `t${i}`,
      status: i % 2 === 0 ? 2 : 5, // half Open, half Closed
      priority: 2,
      created_at: "",
      updated_at: "",
      due_by: null,
      fr_due_by: null,
      description_text: "",
      requester_id: 1,
      responder_id: null,
      type: null,
      category: null,
    }));
    const page2 = [
      {
        id: 1000,
        subject: "tail",
        status: 3,
        priority: 1,
        created_at: "",
        updated_at: "",
        due_by: null,
        fr_due_by: null,
        description_text: "",
        requester_id: 1,
        responder_id: null,
        type: null,
        category: null,
      },
    ];
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tickets: page1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tickets: page2 }) });

    const tickets = await fetchTicketsByRequesterId(1);
    expect(tickets).toHaveLength(51); // 50 Open from page1 + 1 Pending from page2
    expect(tickets.every((t) => t.status !== 5)).toBe(true);
  });
});

describe("freshserviceFetch error handling", () => {
  it("retries on 429 and eventually succeeds", async () => {
    const { fetchRequesterIdByEmail } = await import("@/lib/freshservice");
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ requesters: [{ id: 1, primary_email: "a@b.c", first_name: "A", last_name: "B" }] }),
      });
    const id = await fetchRequesterIdByEmail("a@b.c");
    expect(id).toBe(1);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  }, 10_000);

  it("throws when API key is missing", async () => {
    delete process.env.FRESHSERVICE_API_KEY;
    const { fetchRequesterIdByEmail } = await import("@/lib/freshservice");
    await expect(fetchRequesterIdByEmail("x@y.com")).rejects.toThrow("FRESHSERVICE_API_KEY not set");
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npm test -- freshservice`
Expected: all test cases pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/freshservice.test.ts
git commit -m "test(freshservice): unit tests for client, 429 retry, pagination"
```

---

## Chunk 2: Query keys + API routes

### Task 3: Add `freshservice` domain to query-keys

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add entries**

Insert after the `serviceCustomers` block (around line 72):

```ts
  freshservice: {
    root: ["freshservice"] as const,
    tickets: () => [...queryKeys.freshservice.root, "tickets"] as const,
    ticket: (id: number) => [...queryKeys.freshservice.root, "ticket", id] as const,
    count: () => [...queryKeys.freshservice.root, "count"] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(query-keys): add freshservice domain"
```

### Task 4: API route — list tickets

**Files:**
- Create: `src/app/api/admin/freshservice/tickets/route.ts`

- [ ] **Step 1: Check auth/session pattern used in `/api/admin/tickets/route.ts`**

Read: `src/app/api/admin/tickets/route.ts` (or any `/api/admin/*` route) to confirm how `auth()` is imported (typically `import { auth } from "@/auth"` or `"@/lib/auth"`).

- [ ] **Step 2: Write the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth"; // adjust path if different
import {
  fetchRequesterIdByEmail,
  fetchTicketsByRequesterId,
} from "@/lib/freshservice";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FRESHSERVICE_API_KEY) {
    return NextResponse.json(
      { error: "Freshservice not configured" },
      { status: 500 }
    );
  }

  try {
    const requesterId = await fetchRequesterIdByEmail(session.user.email);
    if (!requesterId) {
      return NextResponse.json(
        {
          tickets: [],
          lastUpdated: new Date().toISOString(),
          requesterFound: false,
        },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    const tickets = await fetchTicketsByRequesterId(requesterId);
    return NextResponse.json(
      {
        tickets,
        lastUpdated: new Date().toISOString(),
        requesterFound: true,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error("Freshservice list failed:", err);
    return NextResponse.json({ error: "Freshservice unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/freshservice/tickets/route.ts
git commit -m "feat(freshservice): GET /api/admin/freshservice/tickets"
```

### Task 5: API route — ticket detail with auth check

**Files:**
- Create: `src/app/api/admin/freshservice/tickets/[id]/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRequesterIdByEmail,
  fetchTicketDetail,
} from "@/lib/freshservice";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FRESHSERVICE_API_KEY) {
    return NextResponse.json(
      { error: "Freshservice not configured" },
      { status: 500 }
    );
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [requesterId, ticket] = await Promise.all([
      fetchRequesterIdByEmail(session.user.email),
      fetchTicketDetail(id),
    ]);

    if (!requesterId || ticket.requester_id !== requesterId) {
      return NextResponse.json(
        { error: "Not authorized to view this ticket" },
        { status: 403 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (err) {
    console.error("Freshservice detail failed:", err);
    return NextResponse.json({ error: "Freshservice unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/freshservice/tickets/\[id\]/route.ts
git commit -m "feat(freshservice): GET /tickets/[id] with requester_id auth"
```

### Task 6: API route — count

**Files:**
- Create: `src/app/api/admin/freshservice/count/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRequesterIdByEmail,
  fetchTicketsByRequesterId,
} from "@/lib/freshservice";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FRESHSERVICE_API_KEY) {
    return NextResponse.json(
      { error: "Freshservice not configured" },
      { status: 500 }
    );
  }

  try {
    const requesterId = await fetchRequesterIdByEmail(session.user.email);
    if (!requesterId) {
      return NextResponse.json(
        { open: 0, pending: 0, total: 0 },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    const tickets = await fetchTicketsByRequesterId(requesterId);
    const open = tickets.filter((t) => t.status === 2).length;
    const pending = tickets.filter((t) => t.status === 3).length;
    return NextResponse.json(
      { open, pending, total: open + pending },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch {
    return NextResponse.json({ error: "Freshservice unavailable" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/freshservice/count/route.ts
git commit -m "feat(freshservice): GET /count for UserMenu badge"
```

---

## Chunk 3: Admin page + UserMenu

### Task 7: Admin page scaffold

**Files:**
- Create: `src/app/admin/freshservice/page.tsx`

- [ ] **Step 1: Study the reference implementation**

Read `src/app/admin/tickets/page.tsx` to mirror the pattern: `AdminPageHeader` + `AdminFilterBar` (status tabs) + `AdminTable` + `AdminDetailDrawer`. Note how `FilterChip` receives `isActive` and counts inline in labels.

- [ ] **Step 2: Write the page**

```tsx
"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, FilterChip } from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import { queryKeys } from "@/lib/query-keys";
import {
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
  type FreshserviceTicket,
} from "@/lib/freshservice";

interface ListResponse {
  tickets: FreshserviceTicket[];
  lastUpdated: string;
  requesterFound: boolean;
}

const STATUS_PILL: Record<number, string> = {
  2: "bg-red-500/15 text-red-400 border-red-500/20",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  4: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const PRIORITY_PILL: Record<number, string> = {
  1: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  2: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  4: "bg-red-500/15 text-red-400 border-red-500/20",
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dueRelative(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: "", overdue: false };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { text: "", overdue: false };
  const diffMins = Math.floor((d.getTime() - Date.now()) / 60_000);
  const overdue = diffMins < 0;
  const absMins = Math.abs(diffMins);
  if (absMins < 60) return { text: `${absMins}m ${overdue ? "overdue" : "left"}`, overdue };
  const hrs = Math.floor(absMins / 60);
  if (hrs < 24) return { text: `${hrs}h ${overdue ? "overdue" : "left"}`, overdue };
  const days = Math.floor(hrs / 24);
  return { text: `${days}d ${overdue ? "overdue" : "left"}`, overdue };
}

export default function FreshserviceTicketsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "pending" | "resolved">("all");
  const [selected, setSelected] = useState<FreshserviceTicket | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.freshservice.tickets(),
    queryFn: async (): Promise<ListResponse> => {
      const r = await fetch("/api/admin/freshservice/tickets");
      if (!r.ok) throw new Error(`failed: ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const tickets = data?.tickets ?? [];
  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 2).length,
    pending: tickets.filter((t) => t.status === 3).length,
    resolved: tickets.filter((t) => t.status === 4).length,
  };
  const filtered = tickets.filter((t) => {
    if (statusFilter === "open") return t.status === 2;
    if (statusFilter === "pending") return t.status === 3;
    if (statusFilter === "resolved") return t.status === 4;
    return true;
  });

  const columns: AdminTableColumn<FreshserviceTicket>[] = [
    {
      key: "id",
      label: "ID",
      render: (t) => <span className="font-mono text-xs text-muted">#{t.id}</span>,
    },
    { key: "subject", label: "Subject", render: (t) => <span className="truncate">{t.subject}</span> },
    {
      key: "status",
      label: "Status",
      render: (t) => (
        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${STATUS_PILL[t.status] ?? ""}`}>
          {FRESHSERVICE_STATUS_LABELS[t.status] ?? t.status}
        </span>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      render: (t) => (
        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${PRIORITY_PILL[t.priority] ?? ""}`}>
          {FRESHSERVICE_PRIORITY_LABELS[t.priority] ?? t.priority}
        </span>
      ),
    },
    { key: "created", label: "Created", render: (t) => relative(t.created_at) },
    {
      key: "due",
      label: "Due",
      render: (t) => {
        const d = dueRelative(t.due_by);
        return <span className={d.overdue ? "text-red-400" : ""}>{d.text}</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Freshservice Tickets"
        breadcrumb={["Admin", "Freshservice"]}
        subtitle="Your open tickets on photonbrothers.freshservice.com."
        actions={
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.freshservice.root })}
            className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            Refresh
          </button>
        }
      />

      {isError ? (
        <AdminError message="Couldn't load Freshservice tickets." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">Loading…</div>
      ) : data && !data.requesterFound ? (
        <AdminEmpty
          title="No Freshservice account linked"
          message="We couldn't find a Freshservice requester record for your email."
        />
      ) : tickets.length === 0 ? (
        <AdminEmpty title="No open tickets 🎉" message="Nothing pending on photonbrothers.freshservice.com." />
      ) : (
        <>
          <AdminFilterBar>
            <FilterChip isActive={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              All ({counts.all})
            </FilterChip>
            <FilterChip isActive={statusFilter === "open"} onClick={() => setStatusFilter("open")}>
              Open ({counts.open})
            </FilterChip>
            <FilterChip isActive={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>
              Pending ({counts.pending})
            </FilterChip>
            <FilterChip isActive={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")}>
              Resolved ({counts.resolved})
            </FilterChip>
          </AdminFilterBar>

          <AdminTable
            data={filtered}
            columns={columns}
            getRowKey={(t) => String(t.id)}
            onRowClick={setSelected}
          />
        </>
      )}

      {selected && (
        <AdminDetailDrawer open onClose={() => setSelected(null)} title={selected.subject}>
          <AdminDetailHeader
            title={selected.subject}
            badges={[
              { label: FRESHSERVICE_STATUS_LABELS[selected.status] ?? "", className: STATUS_PILL[selected.status] },
              { label: FRESHSERVICE_PRIORITY_LABELS[selected.priority] ?? "", className: PRIORITY_PILL[selected.priority] },
            ]}
          />
          <AdminKeyValueGrid
            items={[
              { label: "Status", value: FRESHSERVICE_STATUS_LABELS[selected.status] ?? String(selected.status) },
              { label: "Priority", value: FRESHSERVICE_PRIORITY_LABELS[selected.priority] ?? String(selected.priority) },
              { label: "Created", value: relative(selected.created_at) },
              { label: "Updated", value: relative(selected.updated_at) },
              { label: "Due", value: dueRelative(selected.due_by).text || "—" },
              { label: "Type", value: selected.type ?? "—" },
              { label: "Category", value: selected.category ?? "—" },
            ]}
          />
          {selected.description_text && (
            <div className="rounded-lg border border-t-border bg-surface p-4 text-sm text-foreground whitespace-pre-wrap">
              {selected.description_text}
            </div>
          )}
          <a
            href={`https://photonbrothers.freshservice.com/a/tickets/${selected.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm text-orange-400 hover:text-orange-300"
          >
            View in Freshservice →
          </a>
        </AdminDetailDrawer>
      )}
    </div>
  );
}
```

Notes: the props on `AdminPageHeader`, `AdminDetailDrawer`, `AdminDetailHeader`, `AdminKeyValueGrid`, and `AdminEmpty` must match the actual component APIs — verify by reading each file before running tsc. The task below validates.

- [ ] **Step 3: Verify with typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors in the new file. If props mismatch, adjust to the real API shape of each admin-shell component.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/freshservice/page.tsx
git commit -m "feat(freshservice): admin page with filter tabs + detail drawer"
```

### Task 8: UserMenu badge

**Files:**
- Modify: `src/components/UserMenu.tsx`

- [ ] **Step 1: Add state + gated fetch**

In `src/components/UserMenu.tsx` (see current file for structure):

1. Add import for `useEffect`, `useState` (already imported).
2. Add state `const [ticketCount, setTicketCount] = useState<number | null>(null);` alongside `userRole`.
3. Add a second `useEffect` that fetches the count only when `userRole === "ADMIN"`:

```tsx
useEffect(() => {
  if (userRole !== "ADMIN") return;
  fetch("/api/admin/freshservice/count")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d && setTicketCount(((d.open ?? 0) + (d.pending ?? 0)) || 0))
    .catch(() => {});
}, [userRole]);
```

- [ ] **Step 2: Add the menu item**

In the `<div className="py-1">` block, after the existing `{isAdmin && (<Link href="/admin">...)}`, insert:

```tsx
{isAdmin && (
  <Link
    href="/admin/freshservice"
    onClick={() => setIsOpen(false)}
    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-surface-2 transition-colors"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
    <span>Freshservice</span>
    {ticketCount !== null && ticketCount > 0 && (
      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
        {ticketCount}
      </span>
    )}
  </Link>
)}
```

- [ ] **Step 3: Typecheck + manual render**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/UserMenu.tsx
git commit -m "feat(user-menu): Freshservice link with open-tickets badge"
```

---

## Chunk 4: Nav + roles + grant script

### Task 9: Admin sidebar entry + rename "Tickets" → "Bug reports"

**Files:**
- Modify: `src/components/admin-shell/nav.ts`

- [ ] **Step 1: Edit the Operations group**

In `src/components/admin-shell/nav.ts`, change the Operations group items to:

```ts
items: [
  { label: "Crew availability", href: "/admin/crew-availability", iconName: "calendar" },
  { label: "Bug reports", href: "/admin/tickets", iconName: "ticket" },
  { label: "Freshservice", href: "/admin/freshservice", iconName: "ticket" },
],
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin-shell/nav.ts
git commit -m "feat(admin-nav): add Freshservice, rename Tickets → Bug reports"
```

### Task 10: Allow non-admin routes via ADMIN_ONLY_EXCEPTIONS

**Files:**
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add the two paths**

In `src/lib/roles.ts`, find `ADMIN_ONLY_EXCEPTIONS` (~line 933) and append:

```ts
"/admin/freshservice",
"/api/admin/freshservice",
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(roles): allow /admin/freshservice via extraAllowedRoutes overrides"
```

### Task 11: Grant script for Patrick/Caleb

**Files:**
- Create: `scripts/_grant-freshservice-access.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * Grant /admin/freshservice + /api/admin/freshservice to specified users
 * via `extraAllowedRoutes`. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/_grant-freshservice-access.ts <email> [<email>...]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@/generated/prisma";

const ROUTES = ["/admin/freshservice", "/api/admin/freshservice"];

async function main() {
  const emails = process.argv.slice(2).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error("Usage: tsx scripts/_grant-freshservice-access.ts <email> [<email>...]");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        console.warn(`[skip] No user with email ${email}`);
        continue;
      }
      const existing = new Set(user.extraAllowedRoutes ?? []);
      const before = existing.size;
      for (const r of ROUTES) existing.add(r);
      if (existing.size === before) {
        console.log(`[ok] ${email} already has access — nothing to change.`);
        continue;
      }
      await prisma.user.update({
        where: { email },
        data: { extraAllowedRoutes: Array.from(existing) },
      });
      console.log(`[grant] ${email} → ${ROUTES.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run locally (optional) and commit**

```bash
git add scripts/_grant-freshservice-access.ts
git commit -m "chore(scripts): _grant-freshservice-access.ts"
```

---

## Chunk 5: Verification

### Task 12: Typecheck, lint, and tests

- [ ] **Step 1: Project-wide typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint -- --max-warnings=0 src/lib/freshservice.ts src/app/api/admin/freshservice src/app/admin/freshservice src/components/UserMenu.tsx src/components/admin-shell/nav.ts src/lib/roles.ts src/lib/query-keys.ts`
Expected: no errors.

- [ ] **Step 3: Run tests**

Run: `npm test -- freshservice`
Expected: all tests pass.

### Task 13: Manual QA checklist

Follow the "Manual QA" list in `docs/superpowers/specs/2026-04-20-freshservice-tickets-integration-design.md`:

- [ ] Load `/admin/freshservice` as Zach → verify table renders, filter tabs switch, drawer opens, priority/status colors are correct, external link works.
- [ ] Open UserMenu → verify count badge matches page open+pending.
- [ ] Sign in as a non-admin test user → verify no badge, sidebar lacks Freshservice entry, direct URL hits 403/redirect.
- [ ] Unset `FRESHSERVICE_API_KEY` in `.env` → refresh page → verify `AdminError`.
- [ ] Re-set key → verify recovery.

### Task 14: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/freshservice-tickets
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(freshservice): admin page + UserMenu badge for user's own tickets" --body "$(cat <<'EOF'
## Summary
- Adds `/admin/freshservice` page listing the current user's open/pending Freshservice tickets (requester-id filtered).
- UserMenu gets a count badge linking to the page (ADMIN only in v1; Patrick/Caleb access via per-user `extraAllowedRoutes` applied post-merge).
- Renames admin sidebar "Tickets" → "Bug reports" to disambiguate from Freshservice.

## Test plan
- [ ] Typecheck + lint + unit tests pass locally
- [ ] `/admin/freshservice` renders tickets, filters work, drawer opens, priorities/statuses styled correctly
- [ ] UserMenu badge count matches list open+pending count
- [ ] Non-admin test user gets no badge, 403 on API, redirect on page
- [ ] `FRESHSERVICE_API_KEY` unset → graceful AdminError
- [ ] After `_grant-freshservice-access.ts` for Patrick, verify access works

Spec: `docs/superpowers/specs/2026-04-20-freshservice-tickets-integration-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Post-merge (manual, prod-only)**

Run against prod DB after merge:

```bash
npx tsx scripts/_grant-freshservice-access.ts patrick@photonbrothers.com caleb@photonbrothers.com
```
