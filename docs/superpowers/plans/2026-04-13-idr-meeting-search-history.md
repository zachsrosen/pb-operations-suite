# IDR Meeting Search History Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Search History mode to the IDR Meeting Hub so users can search past meetings by deal name/notes/date and view full session history with conclusions, notes, and snapshot context.

**Architecture:** Third mode (`"search"`) in `IdrMeetingClient` alongside prep and meeting. Reuses the existing two-panel layout: left panel shows deal-grouped search results, right panel shows full chronological history for the selected deal. Backend changes are minimal — relax the search route guard for date-only queries and fix inclusive date semantics.

**Tech Stack:** Next.js, React 19, React Query v5, Prisma, Tailwind v4 with CSS variable tokens, existing IDR meeting API infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-13-idr-meeting-search-history-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/idr-meeting.ts` | Update `searchMeetingItems` for empty query + local-day date semantics |
| Modify | `src/app/api/idr-meeting/search/route.ts` | Relax route-level `q` guard |
| Modify | `src/app/api/idr-meeting/presence/route.ts` | Add `mode` to PresenceEntry, exclude search from prep bucket |
| Modify | `src/lib/query-keys.ts` | Add `meetingSearch` key |
| Modify | `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` | Add `mode` state, render `MeetingSearch` in search mode, send mode in presence heartbeat |
| Modify | `src/app/dashboards/idr-meeting/SessionHeader.tsx` | Add "Search History" button, render purple banner in search mode |
| Create | `src/app/dashboards/idr-meeting/MeetingSearch.tsx` | Top-level search mode component (two-panel layout) |
| Create | `src/app/dashboards/idr-meeting/SearchResultsList.tsx` | Left panel: debounced search, date filters, deal-grouped results with pagination merge |
| Create | `src/app/dashboards/idr-meeting/DealHistoryDetail.tsx` | Right panel: full deal history timeline with session cards + standalone notes |
| Modify | `src/__tests__/lib/idr-meeting.test.ts` | Tests for updated `searchMeetingItems` |
| Create | `src/__tests__/api/idr-meeting-search.test.ts` | Route-level tests for date-only search |
| Create | `src/__tests__/api/idr-meeting-presence.test.ts` | Presence mode exclusion test |
| Create | `src/__tests__/components/search-results-grouping.test.ts` | Client-side cross-page merge logic |

---

## Chunk 1: Backend — Search API + Date Semantics

### Task 1: Update `searchMeetingItems` to support empty query and local-day dates

**Files:**
- Modify: `src/lib/idr-meeting.ts:440-488`
- Test: `src/__tests__/lib/idr-meeting.test.ts`

- [ ] **Step 1: Write failing tests for empty-query and date semantics**

Add to `src/__tests__/lib/idr-meeting.test.ts`. First, add `searchMeetingItems` to the existing import:

```ts
import {
  snapshotDealProperties,
  computeReadinessBadge,
  buildHubSpotNoteBody,
  buildHubSpotPropertyUpdates,
  searchMeetingItems,
} from "@/lib/idr-meeting";
```

Then add the new describe block at the end of the file:

```ts
const mockPrisma = jest.requireMock("@/lib/db").prisma;

describe("searchMeetingItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.idrMeetingItem.findMany.mockResolvedValue([]);
    mockPrisma.idrMeetingItem.count.mockResolvedValue(0);
  });

  it("omits text filter when query is empty and date range is provided", async () => {
    await searchMeetingItems({ query: "", dateFrom: "2026-03-01", dateTo: "2026-03-31" });

    const where = mockPrisma.idrMeetingItem.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("OR");
    expect(where.session.date).toHaveProperty("gte");
    expect(where.session.date).toHaveProperty("lt");
  });

  it("includes text filter when query is provided", async () => {
    await searchMeetingItems({ query: "smith", dateFrom: "2026-03-01" });

    const where = mockPrisma.idrMeetingItem.findMany.mock.calls[0][0].where;
    expect(where).toHaveProperty("OR");
    expect(where.session.date).toHaveProperty("gte");
  });

  it("uses lt-next-local-day for dateTo (inclusive local-day semantics)", async () => {
    await searchMeetingItems({ query: "", dateTo: "2026-03-31" });

    const where = mockPrisma.idrMeetingItem.findMany.mock.calls[0][0].where;
    const ltDate = where.session.date.lt;
    // Next local day in America/Denver: 2026-04-01T06:00:00.000Z (MDT = UTC-6)
    expect(ltDate).toBeInstanceOf(Date);
    expect(ltDate.toISOString()).toBe("2026-04-01T06:00:00.000Z");
  });

  it("uses gte-local-day-start for dateFrom", async () => {
    await searchMeetingItems({ query: "", dateFrom: "2026-03-15" });

    const where = mockPrisma.idrMeetingItem.findMany.mock.calls[0][0].where;
    const gteDate = where.session.date.gte;
    // 2026-03-15 local start in America/Denver: 2026-03-15T06:00:00.000Z (MDT)
    expect(gteDate).toBeInstanceOf(Date);
    expect(gteDate.toISOString()).toBe("2026-03-15T06:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="idr-meeting.test" --verbose`
Expected: FAIL — the `OR` filter is always present, date semantics use `lte` not `lt`.

- [ ] **Step 3: Implement the changes**

In `src/lib/idr-meeting.ts`, replace the `searchMeetingItems` function (lines 440–488):

```ts
/**
 * Convert a YYYY-MM-DD date string to the start of that local day in
 * America/Denver timezone, returned as a UTC Date.
 */
function localDayToUtc(dateStr: string): Date {
  // Build an ISO string that Intl can parse in the target timezone
  const [y, m, d] = dateStr.split("-").map(Number);
  // Create a date at noon UTC to avoid DST-edge issues during formatting
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Get the UTC offset for this date in America/Denver
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(noon);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const localNoon = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
  const offsetMs = noon.getTime() - localNoon.getTime();
  // Start of the requested local day in UTC
  return new Date(Date.UTC(y, m - 1, d) + offsetMs);
}

export async function searchMeetingItems(params: {
  query: string;
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  limit?: number;
}) {
  const { query, dateFrom, dateTo, skip = 0, limit = 50 } = params;

  const textFilter = query
    ? {
        OR: [
          { dealName: { contains: query, mode: "insensitive" as const } },
          { region: { contains: query, mode: "insensitive" as const } },
          { customerNotes: { contains: query, mode: "insensitive" as const } },
          { operationsNotes: { contains: query, mode: "insensitive" as const } },
          { designNotes: { contains: query, mode: "insensitive" as const } },
          { conclusion: { contains: query, mode: "insensitive" as const } },
          { escalationReason: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : {};

  const dateFilter = (dateFrom || dateTo)
    ? {
        session: {
          date: {
            ...(dateFrom ? { gte: localDayToUtc(dateFrom) } : {}),
            ...(dateTo
              ? {
                  // Inclusive: advance to start of next local day, use lt.
                  // Compute next day from parsed YYYY-MM-DD parts to avoid
                  // host-timezone dependency in Date constructor.
                  lt: (() => {
                    const [y, m, d] = dateTo.split("-").map(Number);
                    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
                    const nd = nextDay.toISOString().slice(0, 10);
                    return localDayToUtc(nd);
                  })(),
                }
              : {}),
          },
        },
      }
    : {};

  const where = { ...textFilter, ...dateFilter };

  const [items, total] = await Promise.all([
    prisma.idrMeetingItem.findMany({
      where,
      include: { session: { select: { date: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.idrMeetingItem.count({ where }),
  ]);

  return {
    items,
    total,
    hasMore: skip + items.length < total,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="idr-meeting.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/idr-meeting.ts src/__tests__/lib/idr-meeting.test.ts
git commit -m "feat(idr-meeting): support empty-query search and local-day date semantics"
```

---

### Task 2: Relax route-level search guard

**Files:**
- Modify: `src/app/api/idr-meeting/search/route.ts`
- Test: `src/__tests__/api/idr-meeting-search.test.ts`

- [ ] **Step 1: Write failing test for date-only route request**

Create `src/__tests__/api/idr-meeting-search.test.ts`:

```ts
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN", name: "Test" }),
}));
jest.mock("@/lib/idr-meeting", () => ({
  isIdrAllowedRole: jest.fn().mockReturnValue(true),
  searchMeetingItems: jest.fn().mockResolvedValue({ items: [{ id: "1", dealId: "d1" }], total: 1, hasMore: false }),
}));

import { GET } from "@/app/api/idr-meeting/search/route";
import { searchMeetingItems } from "@/lib/idr-meeting";

const mockSearch = searchMeetingItems as jest.MockedFunction<typeof searchMeetingItems>;

describe("GET /api/idr-meeting/search", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns results for date-only request (no q param)", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search?from=2026-03-01&to=2026-03-31");
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "", dateFrom: "2026-03-01", dateTo: "2026-03-31" }));
    expect(body.items).toHaveLength(1);
  });

  it("returns empty for no q and no date params", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search");
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("returns results for text query", async () => {
    const req = new Request("http://localhost/api/idr-meeting/search?q=smith");
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "smith" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="idr-meeting-search.test" --verbose`
Expected: FAIL — date-only request currently returns empty.

- [ ] **Step 3: Update the route handler**

Replace `src/app/api/idr-meeting/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole, searchMeetingItems } from "@/lib/idr-meeting";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const dateFrom = url.searchParams.get("from") ?? undefined;
  const dateTo = url.searchParams.get("to") ?? undefined;
  const skip = parseInt(url.searchParams.get("skip") ?? "0");

  // Require at least a text query (2+ chars) OR a date range
  if (q.length < 2 && !dateFrom && !dateTo) {
    return NextResponse.json({ items: [], total: 0, hasMore: false });
  }

  const result = await searchMeetingItems({ query: q.length >= 2 ? q : "", dateFrom, dateTo, skip });
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="idr-meeting-search.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/idr-meeting/search/route.ts src/__tests__/api/idr-meeting-search.test.ts
git commit -m "feat(idr-meeting): allow date-only search by relaxing route guard"
```

---

### Task 3: Update presence for search mode exclusion

**Files:**
- Modify: `src/app/api/idr-meeting/presence/route.ts`
- Test: `src/__tests__/api/idr-meeting-presence.test.ts`

- [ ] **Step 1: Write failing test for search-mode exclusion**

Create `src/__tests__/api/idr-meeting-presence.test.ts`:

```ts
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({ email: "test@photonbrothers.com", role: "ADMIN", name: "Test" }),
}));
jest.mock("@/lib/idr-meeting", () => ({
  isIdrAllowedRole: jest.fn().mockReturnValue(true),
}));

import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/idr-meeting/presence/route";

// Use NextRequest so the GET handler can read req.nextUrl.searchParams
function makeReq(url: string, opts?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(new URL(url), {
    method: opts?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("presence search-mode exclusion", () => {
  it("search-mode user does not appear in prep presence list", async () => {
    // Register a search-mode user
    await POST(makeReq("http://localhost/api/idr-meeting/presence", {
      method: "POST",
      body: { sessionId: null, selectedItemId: null, mode: "search" },
    }));

    // Query prep presence (no sessionId param)
    const res = await GET(makeReq("http://localhost/api/idr-meeting/presence"));
    const body = await res.json();

    expect(body.users).toEqual([]);
  });

  it("prep-mode user still appears in prep presence list", async () => {
    await POST(makeReq("http://localhost/api/idr-meeting/presence", {
      method: "POST",
      body: { sessionId: null, selectedItemId: null },
    }));

    const res = await GET(makeReq("http://localhost/api/idr-meeting/presence"));
    const body = await res.json();

    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("test@photonbrothers.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="idr-meeting-presence.test" --verbose`
Expected: FAIL — search user currently appears in prep list.

- [ ] **Step 3: Update presence route handler**

In `src/app/api/idr-meeting/presence/route.ts`:

Update the `PresenceEntry` interface (line 18):
```ts
interface PresenceEntry {
  email: string;
  name: string | null;
  sessionId: string | null;
  selectedItemId: string | null;
  mode: string | null; // "search" | null (null = prep or meeting)
  lastSeen: number;
}
```

Update the POST handler (line 43–52) to persist `mode`:
```ts
  const body = await req.json();
  const { sessionId, selectedItemId, mode } = body;

  presenceMap.set(auth.email, {
    email: auth.email,
    name: auth.name ?? null,
    sessionId: sessionId ?? null,
    selectedItemId: selectedItemId ?? null,
    mode: mode ?? null,
    lastSeen: Date.now(),
  });
```

Update the GET handler filter (line 70) to exclude search mode from prep:
```ts
  const users: PresenceEntry[] = [];
  for (const entry of presenceMap.values()) {
    if (sessionId) {
      if (entry.sessionId === sessionId) users.push(entry);
    } else {
      // Prep bucket: sessionId null AND not in search mode
      if (entry.sessionId === null && entry.mode !== "search") users.push(entry);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="idr-meeting-presence.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/idr-meeting/presence/route.ts src/__tests__/api/idr-meeting-presence.test.ts
git commit -m "feat(idr-meeting): add mode to presence, exclude search from prep bucket"
```

---

### Task 4: Add `meetingSearch` query key

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add the key**

In `src/lib/query-keys.ts`, inside the `idrMeeting` block (after the `escalationQueue` line):

```ts
    meetingSearch: (q: string, from?: string, to?: string) =>
      [...queryKeys.idrMeeting.root, "meeting-search", q, from ?? "", to ?? ""] as const,
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(idr-meeting): add meetingSearch query key"
```

---

## Chunk 2: Frontend — Search Mode UI

### Task 5: Create `DealHistoryDetail.tsx` (right panel)

**Files:**
- Create: `src/app/dashboards/idr-meeting/DealHistoryDetail.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { IdrItem, IdrNote } from "./IdrMeetingClient";

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "7086286";

interface SessionItem {
  id: string;
  type: "IDR" | "ESCALATION";
  dealId: string;
  dealName: string;
  address: string | null;
  region: string | null;
  projectType: string | null;
  systemSizeKw: number | null;
  dealAmount: number | null;
  dealOwner: string | null;
  designStatus: string | null;
  equipmentSummary: string | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  designNotes: string | null;
  conclusion: string | null;
  escalationReason: string | null;
  session: { date: string; status: string };
  createdAt: string;
}

interface DealHistoryResponse {
  items: SessionItem[];
  notes: IdrNote[];
}

interface Props {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
}

type TimelineEntry =
  | { type: "meeting"; date: string; data: SessionItem }
  | { type: "note"; date: string; data: IdrNote };

export function DealHistoryDetail({ dealId, dealName, region, systemSizeKw, projectType }: Props) {
  const historyQuery = useQuery({
    queryKey: queryKeys.idrMeeting.dealHistory(dealId),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/deal-history/${dealId}`);
      if (!res.ok) throw new Error("Failed to fetch deal history");
      return res.json() as Promise<DealHistoryResponse>;
    },
    staleTime: 60 * 1000,
  });

  // Merge items and notes into chronological timeline (newest first)
  const entries: TimelineEntry[] = [];
  if (historyQuery.data) {
    for (const item of historyQuery.data.items) {
      entries.push({ type: "meeting", date: item.session.date, data: item });
    }
    for (const note of historyQuery.data.notes) {
      entries.push({ type: "note", date: note.createdAt, data: note });
    }
  }
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const address = historyQuery.data?.items[0]?.address;

  return (
    <div className="flex-1 rounded-xl border border-t-border bg-surface overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Deal header */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{dealName}</h2>
            <a
              href={`https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded border border-t-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-surface transition-colors"
            >
              HubSpot <span className="text-muted">&#8599;</span>
            </a>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
            {address && <span>{address}</span>}
            {region && <span>{region}</span>}
            {systemSizeKw && <span>{systemSizeKw} kW</span>}
            {projectType && <span>{projectType}</span>}
          </div>
        </div>

        {/* Loading */}
        {historyQuery.isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty */}
        {entries.length === 0 && !historyQuery.isLoading && (
          <p className="text-sm text-muted">No meeting history for this deal.</p>
        )}

        {/* Timeline */}
        {entries.map((entry) =>
          entry.type === "meeting" ? (
            <SessionCard key={`m-${entry.data.id}`} item={entry.data as SessionItem} />
          ) : (
            <StandaloneNoteCard key={`n-${(entry.data as IdrNote).id}`} note={entry.data as IdrNote} />
          ),
        )}
      </div>
    </div>
  );
}

/* ── Session Card ── */

function SessionCard({ item }: { item: SessionItem }) {
  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3 space-y-2">
      {/* Date + type badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-orange-500">
          {new Date(item.session.date).toLocaleDateString()}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            item.type === "ESCALATION"
              ? "bg-orange-500/15 text-orange-500"
              : "bg-surface text-muted"
          }`}
        >
          {item.type}
        </span>
      </div>

      {/* Snapshot context grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <SnapCell label="Design Status" value={item.designStatus} />
        <SnapCell label="Deal Owner" value={item.dealOwner} />
        <SnapCell label="System Size" value={item.systemSizeKw ? `${item.systemSizeKw} kW` : null} />
        <SnapCell label="Equipment" value={item.equipmentSummary} />
      </div>

      {/* Notes */}
      <div className="border-t border-t-border pt-2 space-y-1.5">
        {item.escalationReason && (
          <NoteField label="Escalation Reason" value={item.escalationReason} color="text-orange-500" />
        )}
        {item.conclusion && (
          <NoteField label="Conclusion" value={item.conclusion} color="text-emerald-500" />
        )}
        {item.customerNotes && (
          <NoteField label="Customer Notes" value={item.customerNotes} />
        )}
        {item.operationsNotes && (
          <NoteField label="Ops Notes" value={item.operationsNotes} />
        )}
        {item.designNotes && (
          <NoteField label="Design Notes" value={item.designNotes} />
        )}
        {!item.conclusion && !item.customerNotes && !item.operationsNotes && !item.designNotes && !item.escalationReason && (
          <p className="text-xs text-muted italic">No notes recorded</p>
        )}
      </div>
    </div>
  );
}

function SnapCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs text-foreground truncate">{value}</p>
    </div>
  );
}

function NoteField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`text-[9px] font-semibold uppercase tracking-wider ${color ?? "text-muted"}`}>{label}</p>
      <p className="text-xs text-foreground whitespace-pre-wrap">{value}</p>
    </div>
  );
}

/* ── Standalone Note Card ── */

function StandaloneNoteCard({ note }: { note: IdrNote }) {
  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3 border-l-[3px] border-l-purple-500">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-purple-500">
          {new Date(note.createdAt).toLocaleDateString()}
        </span>
        <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-500">
          Note
        </span>
        <span className="text-[11px] text-muted">{note.author}</span>
      </div>
      <p className="text-xs text-foreground whitespace-pre-wrap">{note.content}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/DealHistoryDetail.tsx
git commit -m "feat(idr-meeting): add DealHistoryDetail component"
```

---

### Task 6: Create `SearchResultsList.tsx` (left panel) with cross-page merge

**Files:**
- Create: `src/app/dashboards/idr-meeting/SearchResultsList.tsx`
- Test: `src/__tests__/components/search-results-grouping.test.ts`

- [ ] **Step 1: Write test for cross-page merge logic**

Create `src/__tests__/components/search-results-grouping.test.ts`:

```ts
/**
 * Test the groupItemsByDeal helper used by SearchResultsList.
 * Verifies cross-page merge: a deal split across two pages
 * produces one group with the correct meeting count.
 */

// Import will be from the component file — extract the helper as a named export
import { groupItemsByDeal, type DealGroup } from "@/app/dashboards/idr-meeting/SearchResultsList";

describe("groupItemsByDeal", () => {
  const makeItem = (dealId: string, dealName: string, conclusion: string | null, sessionDate: string) => ({
    dealId,
    dealName,
    region: "DTC",
    systemSizeKw: 8,
    projectType: "Solar",
    conclusion,
    session: { date: sessionDate, status: "COMPLETED" },
  });

  it("groups items by dealId", () => {
    const items = [
      makeItem("d1", "Smith", "Approved", "2026-04-07"),
      makeItem("d1", "Smith", "Hold for battery", "2026-03-31"),
      makeItem("d2", "Jones", "Go ahead", "2026-04-07"),
    ];

    const groups = groupItemsByDeal(items, new Map());
    expect(groups.size).toBe(2);
    expect(groups.get("d1")!.meetingCount).toBe(2);
    expect(groups.get("d2")!.meetingCount).toBe(1);
  });

  it("merges new items into existing groups (cross-page)", () => {
    const page1 = [
      makeItem("d1", "Smith", "Approved", "2026-04-07"),
      makeItem("d1", "Smith", "Hold", "2026-03-31"),
    ];
    const existing = groupItemsByDeal(page1, new Map());

    const page2 = [
      makeItem("d1", "Smith", "Initial review", "2026-03-10"),
      makeItem("d3", "Lee", "Standard", "2026-04-01"),
    ];
    const merged = groupItemsByDeal(page2, existing);

    expect(merged.get("d1")!.meetingCount).toBe(3);
    expect(merged.get("d1")!.conclusions).toHaveLength(3);
    expect(merged.get("d3")!.meetingCount).toBe(1);
  });

  it("deduplicates conclusions by session date", () => {
    const items = [
      makeItem("d1", "Smith", "Same conclusion", "2026-04-07"),
      makeItem("d1", "Smith", "Same conclusion", "2026-04-07"), // duplicate row
    ];
    const groups = groupItemsByDeal(items, new Map());
    expect(groups.get("d1")!.conclusions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="search-results-grouping" --verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `src/app/dashboards/idr-meeting/SearchResultsList.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/* ── Types ── */

interface SearchItem {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
  conclusion: string | null;
  session: { date: string; status: string };
}

interface SearchResponse {
  items: SearchItem[];
  total: number;
  hasMore: boolean;
}

export interface DealGroup {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
  meetingCount: number;
  conclusions: { date: string; text: string | null }[];
}

/* ── Grouping helper (exported for testing) ── */

export function groupItemsByDeal(
  items: SearchItem[],
  existing: Map<string, DealGroup>,
): Map<string, DealGroup> {
  const groups = new Map(existing);

  for (const item of items) {
    const group = groups.get(item.dealId) ?? {
      dealId: item.dealId,
      dealName: item.dealName,
      region: item.region,
      systemSizeKw: item.systemSizeKw,
      projectType: item.projectType,
      meetingCount: 0,
      conclusions: [],
    };

    // Deduplicate by session date
    const dateKey = item.session.date;
    if (!group.conclusions.some((c) => c.date === dateKey)) {
      group.meetingCount += 1;
      group.conclusions.push({ date: dateKey, text: item.conclusion });
    }

    // Sort conclusions newest-first
    group.conclusions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    groups.set(item.dealId, group);
  }

  return groups;
}

/* ── Component ── */

interface Props {
  selectedDealId: string | null;
  onSelectDeal: (dealId: string, dealName: string, region: string | null, systemSizeKw: number | null, projectType: string | null) => void;
}

export function SearchResultsList({ selectedDealId, onSelectDeal }: Props) {
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [skip, setSkip] = useState(0);
  const [dealGroups, setDealGroups] = useState<Map<string, DealGroup>>(new Map());

  // Debounce search text. Normalize: if text drops below 2 chars and there
  // are no date filters, clear debouncedQ so stale results don't linger.
  useEffect(() => {
    const normalized = searchText.length >= 2 ? searchText : "";
    const timer = setTimeout(() => setDebouncedQ(normalized), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Reset groups and pagination when search params change.
  // Done in an effect (not during render) to avoid unsafe setState-during-render.
  useEffect(() => {
    setDealGroups(new Map());
    setSkip(0);
  }, [debouncedQ, dateFrom, dateTo]);

  const hasQuery = debouncedQ.length >= 2 || dateFrom || dateTo;

  // Include skip in query key so React Query refetches when "Load more" is clicked
  const searchQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.meetingSearch(debouncedQ, dateFrom || undefined, dateTo || undefined), skip],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQ.length >= 2) params.set("q", debouncedQ);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (skip > 0) params.set("skip", String(skip));
      const res = await fetch(`/api/idr-meeting/search?${params}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<SearchResponse>;
    },
    enabled: !!hasQuery,
    staleTime: 30 * 1000,
  });

  // Merge results into groups (useState triggers re-render, unlike useRef)
  useEffect(() => {
    if (searchQuery.data) {
      setDealGroups((prev) => groupItemsByDeal(searchQuery.data.items, prev));
    }
  }, [searchQuery.data]);

  const groups = Array.from(dealGroups.values());
  const hasMore = searchQuery.data?.hasMore ?? false;

  const handleLoadMore = useCallback(() => {
    setSkip((prev) => prev + 50);
  }, []);

  return (
    <div className="w-[380px] shrink-0 border-r border-t-border overflow-y-auto flex flex-col">
      {/* Search input */}
      <div className="p-3 space-y-2 border-b border-t-border">
        <input
          type="text"
          placeholder="Search deals, notes, conclusions..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted"
          autoFocus
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 rounded-lg border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 rounded-lg border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="To"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!hasQuery && (
          <p className="text-sm text-muted text-center py-8">Search for a deal to view its meeting history</p>
        )}

        {searchQuery.isLoading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {hasQuery && !searchQuery.isLoading && groups.length === 0 && (
          <p className="text-sm text-muted text-center py-8">No deals found matching your search</p>
        )}

        {groups.map((group) => (
          <button
            key={group.dealId}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selectedDealId === group.dealId
                ? "border-orange-500 bg-orange-500/8"
                : "border-t-border bg-surface-2 hover:bg-surface"
            }`}
            onClick={() => onSelectDeal(group.dealId, group.dealName, group.region, group.systemSizeKw, group.projectType)}
          >
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-foreground truncate">{group.dealName}</span>
              <span className="text-[10px] text-muted shrink-0">{group.meetingCount} meeting{group.meetingCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              {[group.region, group.systemSizeKw ? `${group.systemSizeKw} kW` : null, group.projectType].filter(Boolean).join(" \u2022 ")}
            </div>

            {/* Inline conclusion previews */}
            {group.conclusions.length > 0 && (
              <div className="mt-2 pl-2 border-l-2 border-orange-500 space-y-1">
                {group.conclusions.slice(0, 3).map((c) => (
                  <div key={c.date} className="flex items-start gap-1.5">
                    <span className="text-[10px] text-orange-500 shrink-0">
                      {new Date(c.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span className="text-[11px] text-muted truncate">
                      {c.text || "No conclusion recorded"}
                    </span>
                  </div>
                ))}
                {group.conclusions.length > 3 && (
                  <span className="text-[10px] text-muted">+{group.conclusions.length - 3} more</span>
                )}
              </div>
            )}
          </button>
        ))}

        {hasMore && (
          <button
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
            onClick={handleLoadMore}
            disabled={searchQuery.isFetching}
          >
            {searchQuery.isFetching ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run grouping tests**

Run: `npm test -- --testPathPattern="search-results-grouping" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/idr-meeting/SearchResultsList.tsx src/__tests__/components/search-results-grouping.test.ts
git commit -m "feat(idr-meeting): add SearchResultsList with cross-page merge"
```

---

### Task 7: Create `MeetingSearch.tsx` (two-panel container)

**Files:**
- Create: `src/app/dashboards/idr-meeting/MeetingSearch.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { SearchResultsList } from "./SearchResultsList";
import { DealHistoryDetail } from "./DealHistoryDetail";

interface SelectedDeal {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
}

export function MeetingSearch() {
  const [selectedDeal, setSelectedDeal] = useState<SelectedDeal | null>(null);

  return (
    <div className="flex gap-0 h-[calc(100vh-13rem)] overflow-hidden rounded-xl border border-t-border">
      <SearchResultsList
        selectedDealId={selectedDeal?.dealId ?? null}
        onSelectDeal={(dealId, dealName, region, systemSizeKw, projectType) =>
          setSelectedDeal({ dealId, dealName, region, systemSizeKw, projectType })
        }
      />

      {selectedDeal ? (
        <DealHistoryDetail
          key={selectedDeal.dealId}
          dealId={selectedDeal.dealId}
          dealName={selectedDeal.dealName}
          region={selectedDeal.region}
          systemSizeKw={selectedDeal.systemSizeKw}
          projectType={selectedDeal.projectType}
        />
      ) : (
        <div className="flex-1 rounded-xl bg-surface flex items-center justify-center">
          <p className="text-sm text-muted">Select a deal from the results to view its history</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/idr-meeting/MeetingSearch.tsx
git commit -m "feat(idr-meeting): add MeetingSearch two-panel container"
```

---

## Chunk 3: Integration — Wire into IdrMeetingClient + SessionHeader

### Task 8: Add search mode to `IdrMeetingClient`

**Files:**
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx`

- [ ] **Step 1: Add mode state and derive isPreview**

Replace lines 126–132 (`const [sessionId...` through `const isPreview`):

```tsx
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEscalationDialog, setShowEscalationDialog] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<"prep" | "meeting" | "search">("prep");

  const isPreview = mode === "prep";
  const isSearch = mode === "search";
```

- [ ] **Step 2: Update setSessionId calls to also set mode**

When a session is selected, mode should become `"meeting"`. When returning to prep, mode should become `"prep"`. Find and update these patterns:

In `onSelectSession` (passed to SessionHeader) — wrap in a helper:

```tsx
  const selectSession = (id: string) => {
    setSessionId(id);
    setMode("meeting");
  };
```

Replace `setSessionId(null)` calls that mean "go to prep" with:

```tsx
  const goToPrep = () => {
    setSessionId(null);
    setMode("prep");
  };
```

Update the auto-init effect (line 284–297) to use `selectSession`:

```tsx
    if (todaySession) selectSession(todaySession.id);
```

Update createSession `onSuccess` to use `selectSession`:

```tsx
    onSuccess: (data) => {
      selectSession(data.session.id);
      ...
    },
```

Update `onViewPreview` to use `goToPrep`, `onSessionEnded` to use `goToPrep`.

- [ ] **Step 3: Update presence heartbeat to include mode**

In the presence heartbeat effect (line 154–169), update the payload:

```tsx
  const presencePayloadRef = useRef({ sessionId, selectedItemId, mode });
  presencePayloadRef.current = { sessionId, selectedItemId, mode };

  useEffect(() => {
    const sendHeartbeat = () => {
      const { sessionId: sid, selectedItemId: selId, mode: m } = presencePayloadRef.current;
      // In search mode, null out session/item so the user doesn't appear
      // in a live meeting's or prep's presence bucket
      const isSearch = m === "search";
      fetch("/api/idr-meeting/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: isSearch ? null : sid,
          selectedItemId: isSearch ? null : selId,
          mode: isSearch ? "search" : undefined,
        }),
      }).catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 8000);
    return () => {
      clearInterval(interval);
      fetch("/api/idr-meeting/presence", { method: "DELETE" }).catch(() => {});
    };
  }, []);
```

Also update the view-change heartbeat effect (line 173–179):

```tsx
  useEffect(() => {
    const isSearch = mode === "search";
    fetch("/api/idr-meeting/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: isSearch ? null : sessionId,
        selectedItemId: isSearch ? null : selectedItemId,
        mode: isSearch ? "search" : undefined,
      }),
    }).catch(() => {});
  }, [sessionId, selectedItemId, mode]);
```

- [ ] **Step 4: Render MeetingSearch in search mode**

Add the import at the top:

```tsx
import { MeetingSearch } from "./MeetingSearch";
```

In the return JSX, before the existing two-panel layout, add a conditional:

```tsx
      {isSearch ? (
        <MeetingSearch />
      ) : (
        <div className="flex gap-4 h-[calc(100vh-13rem)] overflow-hidden">
          {/* existing ProjectQueue + ProjectDetail */}
```

Close the new conditional after the existing `</div>` that closes the two-panel layout:

```tsx
        </div>
      )}
```

- [ ] **Step 5: Pass search handlers to SessionHeader**

Update SessionHeader props to include `onSearchHistory` and `isSearch`:

```tsx
      <SessionHeader
        ...existing props...
        onSearchHistory={() => setMode("search")}
        isSearch={isSearch}
        onViewPreview={goToPrep}
        onSelectSession={selectSession}
        onSessionEnded={goToPrep}
      />
```

- [ ] **Step 6: Do NOT commit yet** — SessionHeader needs updating first to avoid a broken intermediate commit. Proceed directly to Task 9.

---

### Task 9: Update `SessionHeader` for search mode

**Files:**
- Modify: `src/app/dashboards/idr-meeting/SessionHeader.tsx`

- [ ] **Step 1: Add new props to interface**

Update the `Props` interface:

```tsx
interface Props {
  session: IdrSession | null;
  sessions: SessionListItem[];
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenAddDialog: () => void;
  onViewPreview: () => void;
  onSessionEnded: () => void;
  onSearchHistory: () => void;
  creating: boolean;
  isPreview: boolean;
  isSearch: boolean;
  previewCount: number;
  presenceUsers: PresenceUser[];
}
```

Update the destructuring to include the new props.

- [ ] **Step 2: Add search mode banner**

Before the existing `isPreview` ternary (line 95), add a search mode check:

```tsx
      {isSearch ? (
        <div className="rounded-xl border-2 border-dashed border-purple-500/40 bg-purple-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-purple-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Search History
            </span>
            <span className="text-sm font-medium text-foreground">
              Browse past meeting notes
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                className="rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                onClick={onViewPreview}
              >
                &#8592; Prep Mode
              </button>
            </div>
          </div>
        </div>
      ) : isPreview ? (
```

- [ ] **Step 3: Add "Search History" button to Prep and Live modes**

In the Prep mode banner, add before the past meetings dropdown (line 116):

```tsx
              <button
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-500 hover:bg-purple-500/20 transition-colors"
                onClick={onSearchHistory}
              >
                Search History
              </button>
```

In the Live mode banner, add before the "Prep Mode" button (line 183):

```tsx
              <button
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-500 hover:bg-purple-500/20 transition-colors"
                onClick={onSearchHistory}
              >
                Search History
              </button>
```

- [ ] **Step 4: Verify no type errors and build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit IdrMeetingClient + SessionHeader together**

```bash
git add src/app/dashboards/idr-meeting/IdrMeetingClient.tsx src/app/dashboards/idr-meeting/SessionHeader.tsx
git commit -m "feat(idr-meeting): wire search mode into IdrMeetingClient and SessionHeader"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run all tests**

Run: `npm test -- --verbose 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors (or only pre-existing warnings).

- [ ] **Step 4: Run build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Manual smoke test**

1. Navigate to `/dashboards/idr-meeting`
2. Click "Search History" button in prep mode header
3. Verify purple banner appears
4. Type a deal name in the search input — verify results appear grouped by deal
5. Set date range only (no text) — verify results load
6. Click a deal card — verify right panel shows full history with session cards, notes, snapshot context
7. Click "Prep Mode" to return — verify normal prep mode works
8. During a live meeting, verify "Search History" button is accessible

- [ ] **Step 6: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat(idr-meeting): complete search history mode integration"
```
