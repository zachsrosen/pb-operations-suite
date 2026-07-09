# RTB-Blocked PM Review Gate — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a mandatory PM review gate between permit issuance and Ready to Build — permit-issued deals park in RTB-Blocked until a PM flips one release flag — so customers are not notified prematurely.

**Architecture:** Phase 1 is pure HubSpot automation: two new deal properties plus two workflow changes that do all the enforcement (works even if the app is down). Phase 2 is an app-side "RTB Review Queue" dashboard that renders the parked deals with read-only context and an Approve button; the button only sets the HubSpot flag — HubSpot workflows remain the single actor that moves the stage.

**Tech Stack:** HubSpot (deal properties + Automation workflows, `updateDealProperty` / `searchWithRetry`), Next.js 16 App Router, React 19 + React Query v5, TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-07-08-rtb-blocked-pm-review-design.md`

**Verified constants (Project Pipeline `6900017`):**
- Permitting & Interconnection stage `20461938`
- **RTB - Blocked** stage `71052436`
- **Ready To Build** stage `22580871`
- Permit-issued signal: `permit_issued_` (bool) + `permit_completion_date` (datetime)
- New properties: `pm_rtb_approved` (bool), `pm_rtb_approved_date` (datetime)
- HubSpot booleans are string-valued: `"true"` / `"false"`.

---

## Chunk 1: Phase 1 — HubSpot configuration (solves ticket #919)

Phase 1 has no automated tests (HubSpot config). Task 1 is a small idempotent script; Task 2 is workflow config Zach applies in HubSpot, with a manual validation checklist.

### Task 1: Property-creation script

Creates the two deal properties. Mirrors the existing precedent `scripts/_create-internal-rejection-hubspot-props.ts` (idempotent, dry-run by default, `--apply` to write, safe to re-run and delete).

**Files:**
- Create: `scripts/_create-rtb-review-hubspot-props.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * One-time idempotent setup: create the RTB PM-Review properties on HubSpot deals.
 *
 * Dry-run:  tsx scripts/_create-rtb-review-hubspot-props.ts
 * Apply:    tsx scripts/_create-rtb-review-hubspot-props.ts --apply
 *
 * Creates (all on the `deals` object, in an "RTB Review" group):
 *   - bool     pm_rtb_approved        (the single PM release control)
 *   - datetime pm_rtb_approved_date   (stamped when pm_rtb_approved flips true)
 *
 * Safe to re-run; skips anything that already exists. Safe to delete after use.
 */
import "dotenv/config";
import { hubspotClient } from "../src/lib/hubspot";

const OBJECT_TYPE = "deals";
const GROUP_NAME = "rtb_review";
const GROUP_LABEL = "RTB Review";
const APPLY = process.argv.includes("--apply");

interface PropDef {
  name: string;
  label: string;
  type: "bool" | "datetime";
  fieldType: "booleancheckbox" | "date";
  description: string;
  options?: { label: string; value: string; displayOrder: number }[];
}

const PROPS: PropDef[] = [
  {
    name: "pm_rtb_approved",
    label: "PM Approved — Release to Build",
    type: "bool",
    fieldType: "booleancheckbox",
    description:
      "When true, a HubSpot workflow advances the deal from RTB - Blocked to Ready to Build. Reset to false on entry to RTB - Blocked.",
    options: [
      { label: "Yes", value: "true", displayOrder: 0 },
      { label: "No", value: "false", displayOrder: 1 },
    ],
  },
  {
    name: "pm_rtb_approved_date",
    label: "PM RTB Approved Date",
    type: "datetime",
    fieldType: "date",
    description: "Timestamp when PM Approved — Release to Build was set true.",
  },
];

async function ensureGroup() {
  try {
    await hubspotClient.crm.properties.groupsApi.getByName(OBJECT_TYPE, GROUP_NAME);
    console.log(`group "${GROUP_NAME}" exists`);
  } catch {
    if (!APPLY) {
      console.log(`[dry-run] would create group "${GROUP_NAME}"`);
      return;
    }
    await hubspotClient.crm.properties.groupsApi.create(OBJECT_TYPE, {
      name: GROUP_NAME,
      label: GROUP_LABEL,
      displayOrder: -1,
    });
    console.log(`created group "${GROUP_NAME}"`);
  }
}

async function ensureProp(p: PropDef) {
  try {
    await hubspotClient.crm.properties.coreApi.getByName(OBJECT_TYPE, p.name);
    console.log(`  prop ${p.name} exists — skip`);
    return;
  } catch {
    /* not found — create below */
  }
  if (!APPLY) {
    console.log(`  [dry-run] would create prop ${p.name} (${p.type}/${p.fieldType})`);
    return;
  }
  await hubspotClient.crm.properties.coreApi.create(OBJECT_TYPE, {
    name: p.name,
    label: p.label,
    type: p.type,
    fieldType: p.fieldType,
    groupName: GROUP_NAME,
    description: p.description,
    ...(p.options ? { options: p.options } : {}),
  } as Parameters<typeof hubspotClient.crm.properties.coreApi.create>[1]);
  console.log(`  created prop ${p.name}`);
}

async function main() {
  console.log(APPLY ? "APPLY mode" : "DRY-RUN (pass --apply to write)");
  await ensureGroup();
  for (const p of PROPS) await ensureProp(p);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run to verify it resolves**

Run: `npx tsx scripts/_create-rtb-review-hubspot-props.ts`
Expected: prints `DRY-RUN`, `[dry-run] would create` lines for the group and both props (or "exists — skip" if a re-run), exits 0. No writes.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/_create-rtb-review-hubspot-props.ts
git commit -m "feat(rtb): script to create pm_rtb_approved deal properties"
```

- [ ] **Step 4: Apply (live HubSpot write — approval checkpoint)**

> This writes to production HubSpot. Confirm with Zach before running.
Run: `npx tsx scripts/_create-rtb-review-hubspot-props.ts --apply`
Expected: `created group "rtb_review"`, `created prop pm_rtb_approved`, `created prop pm_rtb_approved_date`. Re-running prints "exists — skip".

### Task 2: HubSpot workflow configuration (applied by Zach in HubSpot)

No code. Two workflow changes; exact config below. HubSpot workflows are Zach's to own/apply.

- [ ] **Step 1: Modify the existing permit-issued → RTB workflow**

Locate the workflow that currently advances permit-issued deals to Ready to Build (deal-based, Project pipeline `6900017`; enrolls on `permit_issued_` = true and/or `permit_completion_date` known). Change:
- **Stage-move action target:** from `Ready To Build` (`22580871`) → **`RTB - Blocked` (`71052436`)**.
- **Add two set-property actions** on entry: `pm_rtb_approved` = `false`, `pm_rtb_approved_date` = clear/empty.
Everything else in that workflow stays the same.

- [ ] **Step 2: Create the new "release" workflow**

- **Type:** Deal-based, Project pipeline `6900017`.
- **Enrollment trigger (both true):** `pm_rtb_approved` is `true` **AND** deal stage is `RTB - Blocked` (`71052436`). Re-enrollment ON for `pm_rtb_approved`.
- **Actions:**
  1. Set deal stage → `Ready To Build` (`22580871`).
  2. Set `pm_rtb_approved_date` = current date/time.

- [ ] **Step 3: Manual validation checklist (HubSpot test deal)**

- [ ] Take a test deal in Permitting & Interconnection; set `permit_issued_` true (fire the modified workflow). Confirm it lands in **RTB - Blocked** with `pm_rtb_approved` = false — **not** Ready to Build.
- [ ] Confirm Olivia does **not** message the customer while the deal sits in RTB - Blocked.
- [ ] Set `pm_rtb_approved` = true on the test deal. Confirm the release workflow moves it to **Ready to Build** and stamps `pm_rtb_approved_date`.
- [ ] Confirm Olivia's Ready-to-Build messaging fires only now.
- [ ] Note (expected, not a bug): manually dragging a deal straight to Ready to Build bypasses the gate — unguarded in v1.

---

## Chunk 2: Phase 2 — App "RTB Review Queue" dashboard

TDD. Queue reads live from HubSpot (no Prisma mirror, no cache in v1 — small PM-facing volume; add later if needed). Approve button writes only the HubSpot flag; the HubSpot release workflow (Chunk 1) moves the stage.

**File structure:**
- Create: `src/lib/rtb-review.ts` — fetch + shape parked deals (`fetchRtbQueue()`)
- Create: `src/app/api/deals/rtb-review/route.ts` — GET list
- Create: `src/app/api/deals/rtb-review/[dealId]/approve/route.ts` — POST approve
- Create: `src/app/dashboards/rtb-review/page.tsx` — server role gate
- Create: `src/app/dashboards/rtb-review/RtbReviewClient.tsx` — client UI
- Modify: `src/lib/roles.ts` — add routes to allowedRoutes
- Modify: `src/app/suites/project-management/page.tsx` — add suite card
- Test: `src/__tests__/lib/rtb-review.test.ts`, `src/__tests__/api/rtb-review.test.ts`

### Task 3: Queue data lib (`fetchRtbQueue`)

Mirror `src/lib/ic-hub.ts` `fetchIcQueue()` (line ~189): build filters, call `searchWithRetry`, map results. Info rows sourced from clean deal properties only (permit, design). Payment/materials full-join deferred (Task 8).

**Files:**
- Create: `src/lib/rtb-review.ts`
- Test: `src/__tests__/lib/rtb-review.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `src/__tests__/lib/chat-tools.test.ts` mock of `searchWithRetry`)

```ts
const mockSearchWithRetry = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: (...args: unknown[]) => mockSearchWithRetry(...args),
}));

import { fetchRtbQueue } from "@/lib/rtb-review";

describe("fetchRtbQueue", () => {
  beforeEach(() => mockSearchWithRetry.mockReset());

  it("shapes RTB-Blocked deals into queue rows", async () => {
    mockSearchWithRetry.mockResolvedValue({
      results: [
        {
          id: "111",
          properties: {
            dealname: "PROJ-1000 - Smith",
            dealstage: "71052436",
            pipeline: "6900017",
            pb_location: "Westminster",
            permit_completion_date: "2026-07-01T00:00:00Z",
            permitting_status: "Issued",
            design_status: "Approved",
            total_revision_count: "2",
            pm_rtb_approved: "false",
            hs_lastmodifieddate: "2026-07-06T00:00:00Z",
          },
        },
      ],
    });

    const rows = await fetchRtbQueue();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dealId: "111",
      dealName: "PROJ-1000 - Smith",
      location: "Westminster",
      permitIssueDate: "2026-07-01T00:00:00Z",
      permittingStatus: "Issued",
      designStatus: "Approved",
      approved: false,
    });
    // filters target pipeline 6900017 + stage 71052436
    const req = mockSearchWithRetry.mock.calls[0][0];
    const flat = JSON.stringify(req.filterGroups);
    expect(flat).toContain("6900017");
    expect(flat).toContain("71052436");
  });

  it("returns [] when no deals are parked", async () => {
    mockSearchWithRetry.mockResolvedValue({ results: [] });
    expect(await fetchRtbQueue()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/rtb-review.test.ts`
Expected: FAIL — cannot find module `@/lib/rtb-review`.

- [ ] **Step 3: Implement `src/lib/rtb-review.ts`**

```ts
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { searchWithRetry } from "@/lib/hubspot";

const PROJECT_PIPELINE = "6900017";
const RTB_BLOCKED_STAGE = "71052436";

export interface RtbQueueItem {
  dealId: string;
  dealName: string;
  location: string | null;
  ownerId: string | null;
  permitIssueDate: string | null;
  permittingStatus: string | null;
  designStatus: string | null;
  revisionCount: number | null;
  approved: boolean;
  lastModified: string | null;
}

const PROPERTIES = [
  "dealname",
  "pb_location",
  "hubspot_owner_id",
  "dealstage",
  "pipeline",
  "permit_completion_date",
  "permitting_status",
  "design_status",
  "total_revision_count",
  "pm_rtb_approved",
  "hs_lastmodifieddate",
];

export async function fetchRtbQueue(): Promise<RtbQueueItem[]> {
  const response = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE },
          { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: RTB_BLOCKED_STAGE },
        ],
      },
    ],
    properties: PROPERTIES,
    limit: 200,
    sorts: ["hs_lastmodifieddate"],
  } as unknown as Parameters<typeof searchWithRetry>[0]);

  return (response.results ?? []).map((r: { id: string; properties: Record<string, string> }) => {
    const p = r.properties ?? {};
    return {
      dealId: r.id,
      dealName: p.dealname ?? "",
      location: p.pb_location ?? null,
      ownerId: p.hubspot_owner_id ?? null,
      permitIssueDate: p.permit_completion_date ?? null,
      permittingStatus: p.permitting_status ?? null,
      designStatus: p.design_status ?? null,
      revisionCount: p.total_revision_count ? Number(p.total_revision_count) : null,
      approved: p.pm_rtb_approved === "true",
      lastModified: p.hs_lastmodifieddate ?? null,
    };
  });
}
```
(Adjust the `FilterOperatorEnum` import path if the codebase imports it elsewhere — grep `FilterOperatorEnum` in `src/lib/ic-hub.ts` and match.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/rtb-review.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rtb-review.ts src/__tests__/lib/rtb-review.test.ts
git commit -m "feat(rtb): fetchRtbQueue — list deals parked in RTB-Blocked"
```

### Task 4: GET list API route

Mirror `src/app/api/pe-crossref/queue/route.ts` (auth guard → data → JSON).

**Files:**
- Create: `src/app/api/deals/rtb-review/route.ts`
- Test: `src/__tests__/api/rtb-review.test.ts`

- [ ] **Step 1: Write the failing test** (mirror `src/__tests__/api/projects.test.ts` mock structure)

```ts
const mockFetchRtbQueue = jest.fn();
jest.mock("@/lib/rtb-review", () => ({ fetchRtbQueue: () => mockFetchRtbQueue() }));
jest.mock("@/lib/api-auth", () => ({ requireApiAuth: jest.fn().mockResolvedValue({ email: "pm@x" }) }));

import { GET } from "@/app/api/deals/rtb-review/route";
import { NextRequest } from "next/server";

it("returns the queue as JSON", async () => {
  mockFetchRtbQueue.mockResolvedValue([{ dealId: "111", dealName: "PROJ-1000", approved: false }]);
  const res = await GET(new NextRequest("http://localhost/api/deals/rtb-review"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].dealId).toBe("111");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/api/rtb-review.test.ts -t "returns the queue"`
Expected: FAIL — cannot find module `@/app/api/deals/rtb-review/route`.

- [ ] **Step 3: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchRtbQueue } from "@/lib/rtb-review";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const items = await fetchRtbQueue();
  return NextResponse.json({ items, lastUpdated: new Date().toISOString() });
}
```
(Confirm `requireApiAuth`'s return convention against `src/app/api/projects/[id]/route.ts:47` — it returns a `NextResponse` on failure.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/api/rtb-review.test.ts -t "returns the queue"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/deals/rtb-review/route.ts src/__tests__/api/rtb-review.test.ts
git commit -m "feat(rtb): GET /api/deals/rtb-review list route"
```

### Task 5: POST approve API route

Sets `pm_rtb_approved="true"` via `updateDealProperty` (`src/lib/hubspot.ts:2057`). HubSpot workflow does the stage move.

**Files:**
- Create: `src/app/api/deals/rtb-review/[dealId]/approve/route.ts`
- Test: add to `src/__tests__/api/rtb-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const mockUpdateDealProperty = jest.fn();
jest.mock("@/lib/hubspot", () => ({ updateDealProperty: (...a: unknown[]) => mockUpdateDealProperty(...a) }));

import { POST } from "@/app/api/deals/rtb-review/[dealId]/approve/route";

it("approves a deal by setting pm_rtb_approved true", async () => {
  mockUpdateDealProperty.mockResolvedValue(true);
  const res = await POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(200);
  expect(mockUpdateDealProperty).toHaveBeenCalledWith("111", { pm_rtb_approved: "true" });
});

it("returns 502 when the HubSpot write fails", async () => {
  mockUpdateDealProperty.mockResolvedValue(false);
  const res = await POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ dealId: "111" }),
  });
  expect(res.status).toBe(502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/api/rtb-review.test.ts -t "approves a deal"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { updateDealProperty } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const { dealId } = await params;
  const ok = await updateDealProperty(dealId, { pm_rtb_approved: "true" });
  if (!ok) {
    return NextResponse.json({ error: "HubSpot update failed" }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/api/rtb-review.test.ts`
Expected: PASS (all cases). Note: the approve test mocks `@/lib/hubspot`; keep it in a separate `describe`/file section from the GET test if mock scopes collide.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/deals/rtb-review/[dealId]/approve/route.ts" src/__tests__/api/rtb-review.test.ts
git commit -m "feat(rtb): POST approve route sets pm_rtb_approved"
```

### Task 6: Role allowlist

Add the page + API routes to `PROJECT_MANAGER` (auto-covers OWNER, which reuses `PROJECT_MANAGER.allowedRoutes`) and `OPERATIONS_MANAGER`. ADMIN/EXECUTIVE already have `"*"`.

**Files:**
- Modify: `src/lib/roles.ts` — `PROJECT_MANAGER.allowedRoutes` (~line 310), `OPERATIONS_MANAGER.allowedRoutes` (~line 138)

- [ ] **Step 1: Add the routes** to both role `allowedRoutes` arrays (prefix match covers sub-paths):

```ts
"/dashboards/rtb-review",
"/api/deals/rtb-review",
```

- [ ] **Step 2: Verify no regression**

Run: `npx jest -t "roles"` (if a roles/user-access test exists; otherwise `npm run lint`)
Expected: PASS. Manually confirm `/api/deals/rtb-review` prefix also authorizes `/api/deals/rtb-review/<id>/approve`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(rtb): allow PM + Ops Mgr access to RTB review routes"
```

### Task 7: Dashboard UI

Server `page.tsx` role gate (mirror `src/app/dashboards/pm-action-queue/page.tsx:5-22`) wrapping a client component built like `pe-action-queue` (React Query list + `useMutation` approve, `DashboardShell`).

**Files:**
- Create: `src/app/dashboards/rtb-review/page.tsx`
- Create: `src/app/dashboards/rtb-review/RtbReviewClient.tsx`

- [ ] **Step 1: Server page (role gate)** — mirror `pm-action-queue/page.tsx` exactly, incl. its role-allowlist check. Note the real import is `@/lib/auth-utils` (NOT `auth-helpers`).

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import RtbReviewClient from "./RtbReviewClient";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
]);

export default async function RtbReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.roles.some((r: string) => ALLOWED_ROLES.has(r))) redirect("/");
  return <RtbReviewClient />;
}
```
(Before implementing, open `src/app/dashboards/pm-action-queue/page.tsx` and copy its exact `getCurrentUser` return shape + role-check idiom — match `user.roles` access and the redirect target precisely.)

- [ ] **Step 2: Client component**

Mirror `src/app/dashboards/pe-action-queue/page.tsx`: `useQuery(["rtb-review"], fetch "/api/deals/rtb-review")` for the list; render each row in a `DashboardShell` table showing **Deal / Location / Permit issued / Permitting status / Design status / Revisions**, with an **"Approved — Release to Build"** button per row that `useMutation`s `POST /api/deals/rtb-review/${dealId}/approve` and on success `invalidateQueries(["rtb-review"])`. Use `<DashboardShell title="RTB Review Queue" accentColor="red" fullWidth lastUpdated={data?.lastUpdated} />`. Show empty-state when `items.length === 0`.

- [ ] **Step 3: Verify it renders (preview)**

Start the dev server and load `/dashboards/rtb-review`. Confirm the list loads (or empty-state), the table columns render, and clicking Approve fires the POST and removes the row after invalidation. Check `preview_console_logs` / `preview_network` for errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/rtb-review/
git commit -m "feat(rtb): RTB Review Queue dashboard UI"
```

### Task 8: Suite card + deferred info enrichment

- [ ] **Step 1: Add the suite card** to `src/app/suites/project-management/page.tsx` `BASE_LINKS` (SuitePageCard; "Action & Triage" section, next to `pm-action-queue`):

```ts
{
  href: "/dashboards/rtb-review",
  title: "RTB Review Queue",
  description: "Permit-issued deals awaiting PM release to Ready to Build.",
  tag: "ACTION",
  icon: "🚦",
  section: "Action & Triage",
},
```

- [ ] **Step 2: Commit**

```bash
git add src/app/suites/project-management/page.tsx
git commit -m "feat(rtb): add RTB Review card to Project Management suite"
```

- [ ] **Step 3 (deferred, optional): richer info rows.** The spec's Payment-milestone and Materials/SO rows need cross-source joins (`effectivePaidStatus` needs the invoice + `side`/`propertyStatus`; SO number lives app-side via the BOM push log). These are **not** required for the gate to function and are deferred. If/when added: extend `RtbQueueItem` + `fetchRtbQueue` to join invoice/BOM data and render two more read-only columns. Track as a follow-up; do not block Phase 2 completion on it.

---

## Rollout notes

- **Order:** Chunk 1 must be live before Chunk 2 is useful (the queue lists deals the Chunk 1 workflows produce). Chunk 1 alone closes ticket #919.
- **Company-wide impact:** every permit-issued project now requires explicit PM approval to leave for build. Announce to PMs before enabling.
- **Deploy:** via GitHub PR → merge (not `vercel --prod`). Property script `--apply` is a manual live step gated on Zach's OK.

## Open items carried from the spec
1. Confirm which payment milestone gates build (deposit vs DA "Paid In Full") — only affects deferred Task 8.
2. Whether the Phase-1 HubSpot deal card should link out for SO/materials status or omit until Phase 2.
3. Identify the exact existing permit-issued workflow to modify (Task 2, Step 1).
