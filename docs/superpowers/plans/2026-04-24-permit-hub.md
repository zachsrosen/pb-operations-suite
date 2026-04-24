# Permit Hub Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-pane `/dashboards/permit-hub` workspace (queue + tabbed project detail + status-aware action forms) that lets permit leads work the existing `pi-permit-action-queue` without tab-switching, and that writes back via HubSpot task completion so existing Workflow automation keeps firing.

**Architecture:** Mirrors the proven IDR Meeting Hub (`src/app/dashboards/idr-meeting/`) structurally, but solo-mode only (no presence/sessions). One new small DB table (`PermitHubDraft` for crash recovery), additive `ActivityType` enum values, and ~15 new API routes under `/api/permit-hub/*`. Frontend is React Query + SSE invalidation. No shared-framework extraction until a second consumer (IC Hub) exists.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Prisma 7 on Neon Postgres, Tailwind v4 tokens, React Query v5, SSE via `useSSE`, HubSpot API client for task completion + note engagement + custom object reads, Zod for payload validation.

**Spec:** [docs/superpowers/specs/2026-04-24-permit-hub-design.md](../specs/2026-04-24-permit-hub-design.md)

---

## Chunk 1: Foundation — schema, constants, flags, roles

Lays down the database table, enum values, shared permit-hub constants, feature flags, and role allowlist entries. Must land first so subsequent tasks have a compiled client + permitted routes.

### Task 1.1: Add `PermitHubDraft` model and new `ActivityType` values to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new `ActivityType` enum values**

Locate the `enum ActivityType` block (around line 113). Append a new section before the closing `}`:

```prisma
  // Permit Hub
  PERMIT_SUBMITTED
  PERMIT_RESUBMITTED
  PERMIT_REJECTION_LOGGED
  PERMIT_REVISION_ROUTED
  PERMIT_REVISION_COMPLETED
  PERMIT_FOLLOWUP
  PERMIT_AS_BUILT_STARTED
  PERMIT_AS_BUILT_COMPLETED
  PERMIT_ISSUED
  PERMIT_SOLARAPP_SUBMITTED
  PERMIT_HUB_DRAFT_SAVED
  PERMIT_HUB_DRAFT_DISCARDED
```

- [ ] **Step 2: Add the `PermitHubDraft` model at the end of the schema**

Append at the very end of `prisma/schema.prisma`:

```prisma
// ===========================================
// PERMIT HUB
// ===========================================

model PermitHubDraft {
  id         String   @id @default(cuid())
  userId     String
  dealId     String
  actionKind String // e.g. "SUBMIT_TO_AHJ", "REVIEW_REJECTION"
  payload    Json
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, dealId, actionKind])
  @@index([userId])
  @@index([updatedAt])
}
```

- [ ] **Step 3: Add the back-relation on the User model**

Find `model User` and add `permitHubDrafts PermitHubDraft[]` to the relations block (alongside other back-relations like `activityLogs`, `bookedSlots`, etc.).

- [ ] **Step 4: Generate migration file (do NOT deploy)**

Per feedback memory: subagents never invoke `prisma migrate deploy`. Only create the migration file.

Run: `npx prisma migrate dev --create-only --name add_permit_hub_draft_and_activity_types`

Expected: new folder under `prisma/migrations/<timestamp>_add_permit_hub_draft_and_activity_types/` containing `migration.sql`.

- [ ] **Step 5: Inspect the generated migration**

Open the new `migration.sql`. Verify it contains:
- `ALTER TYPE "ActivityType" ADD VALUE '...'` lines for each of the 12 new values
- `CREATE TABLE "PermitHubDraft" (...)` with matching columns
- `CREATE UNIQUE INDEX` on `(userId, dealId, actionKind)` and `CREATE INDEX` on `userId` and `updatedAt`
- `ALTER TABLE` adding the foreign key to `User`

If any of these are missing, the schema edits above are wrong — fix the schema, regenerate.

- [ ] **Step 6: Regenerate the Prisma client locally**

Run: `npx prisma generate`
Expected: `src/generated/prisma/` updated, `PermitHubDraft` type available.

- [ ] **Step 7: Verify the TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from schema changes.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(permit-hub): add PermitHubDraft model and activity types"
```

**Note on deploy:** per feedback memory `feedback_prisma_migration_before_code.md`, additive migrations like this one should be applied to prod BEFORE merging any code that references the new columns. The user will run `scripts/migrate-prod.sh` (or `prisma migrate deploy`) manually before merging this branch.

---

### Task 1.2: Add `PERMIT_ACTION_TASK_SUBJECTS` constant to pi-statuses

**Files:**
- Modify: `src/lib/pi-statuses.ts`

- [ ] **Step 1: Add "Submitted to AHJ" as a follow-up trigger in `PERMIT_ACTION_STATUSES`**

Open `src/lib/pi-statuses.ts`. `PERMIT_ACTION_STATUSES` does not currently include "Submitted to AHJ", but the spec's `FollowUpForm` needs to fire on it once an item goes stale. Add the entry:

```typescript
  "Submitted to AHJ": "Follow up with AHJ",
```

Place it alphabetically or next to the existing "Resubmitted to AHJ" entry (which already maps to "Follow up with AHJ"). The UI's stale badge (>7 days in status) surfaces when the follow-up becomes actionable.

- [ ] **Step 2: Add the task-subject lookup map and action-kind helper**

After `PERMIT_ACTION_STATUSES`, add:

```typescript
/**
 * Tuple used for Zod enums and exhaustive switches — keep in sync with the
 * object below.
 */
export const PERMIT_ACTION_KINDS = [
  "SUBMIT_TO_AHJ",
  "RESUBMIT_TO_AHJ",
  "REVIEW_REJECTION",
  "FOLLOW_UP",
  "COMPLETE_REVISION",
  "START_AS_BUILT_REVISION",
  "COMPLETE_AS_BUILT",
  "SUBMIT_SOLARAPP",
  "MARK_PERMIT_ISSUED",
] as const;

export type PermitActionKind = (typeof PERMIT_ACTION_KINDS)[number];

/**
 * Maps a permit action kind to candidate HubSpot task subject patterns.
 * When completing an action, the hub looks up an open task on the deal whose
 * subject matches one of these patterns (case-insensitive, substring match).
 * If none match, the action route surfaces a warning + "write status field
 * directly" escape hatch.
 */
export const PERMIT_ACTION_TASK_SUBJECTS: Record<PermitActionKind, readonly string[]> = {
  SUBMIT_TO_AHJ: ["submit to ahj", "submit permit"],
  RESUBMIT_TO_AHJ: ["resubmit to ahj", "resubmit permit"],
  REVIEW_REJECTION: ["review rejection", "permit rejected"],
  FOLLOW_UP: ["follow up with ahj", "permit follow up"],
  COMPLETE_REVISION: ["complete revision", "revision complete"],
  START_AS_BUILT_REVISION: ["start as-built", "as-built revision"],
  COMPLETE_AS_BUILT: ["complete as-built"],
  SUBMIT_SOLARAPP: ["submit solarapp", "solarapp submission"],
  MARK_PERMIT_ISSUED: ["permit issued", "permit approved"],
};

/** Maps a HubSpot `permitting_status` value to the internal action kind. */
export function actionKindForStatus(status: string): PermitActionKind | null {
  const map: Record<string, PermitActionKind> = {
    "Ready For Permitting": "SUBMIT_TO_AHJ",
    "Customer Signature Acquired": "SUBMIT_TO_AHJ",
    "Rejected": "REVIEW_REJECTION",
    "Non-Design Related Rejection": "REVIEW_REJECTION",
    "In Design For Revision": "COMPLETE_REVISION",
    "Returned from Design": "RESUBMIT_TO_AHJ",
    "As-Built Revision Needed": "START_AS_BUILT_REVISION",
    "As-Built Revision In Progress": "COMPLETE_AS_BUILT",
    "As-Built Ready To Resubmit": "RESUBMIT_TO_AHJ",
    "Pending SolarApp": "SUBMIT_SOLARAPP",
    "Submit SolarApp to AHJ": "SUBMIT_SOLARAPP",
    "Submitted to AHJ": "FOLLOW_UP",
    "Resubmitted to AHJ": "FOLLOW_UP",
  };
  return map[status] ?? null;
}
```

- [ ] **Step 2: Verify no import cycles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pi-statuses.ts
git commit -m "feat(permit-hub): add task-subject lookup map for permit actions"
```

---

### Task 1.3: Add feature flags to `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add two new env vars**

Append to `.env.example` under a new `# Permit Hub` header:

```bash
# Permit Hub (P&I workspace)
# Server-side flag — gates dashboard route + /api/permit-hub/* endpoints.
PERMIT_HUB_ENABLED=false
# Client-side flag — gates suite card + nav entry on /suites/permitting-interconnection.
NEXT_PUBLIC_PERMIT_HUB_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat(permit-hub): add env var flags"
```

---

### Task 1.4: Update role allowlist for `/dashboards/permit-hub` and `/api/permit-hub/*`

Per feedback memory `feedback_api_route_role_allowlist.md`: every new API route must be added to every permitted role's `allowedRoutes`, or middleware silently 403s.

**Files:**
- Modify: `src/lib/roles.ts` — this is the authoritative source. `src/lib/role-permissions.ts` is deprecated and just derives from `ROLES[role].allowedRoutes`; do NOT edit it.

- [ ] **Step 1: Grep for `pi-permit-action-queue` entries to find the role blocks to update**

Run (via Grep tool): pattern `pi-permit-action-queue`, path `src/lib/roles.ts`.
Expected: lines in the `allowedRoutes` arrays for `PERMIT`, `TECH_OPS`, `PROJECT_MANAGER`. `ADMIN` and `EXECUTIVE`/`OWNER` use `"*"` wildcard and don't need changes.

- [ ] **Step 2: For each role block that contains `/dashboards/pi-permit-action-queue`, add two new entries**

Add, each on its own line in the `allowedRoutes` array:

```typescript
    "/dashboards/permit-hub",
    "/api/permit-hub",
```

The middleware uses prefix matching, so `/api/permit-hub` covers all sub-routes.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify middleware prefix match**

Open `src/middleware.ts` and confirm the allowlist check uses prefix matching (not exact match). If it's exact-match only, explicitly list every concrete `/api/permit-hub/...` path instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(permit-hub): add role allowlist entries for new routes"
```

---

### Task 1.5: Add React Query keys

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add permit-hub keys**

Add a new exported object:

```typescript
export const permitHubKeys = {
  all: ["permit-hub"] as const,
  queue: () => [...permitHubKeys.all, "queue"] as const,
  project: (dealId: string) => [...permitHubKeys.all, "project", dealId] as const,
  draft: (dealId: string, actionKind: string) =>
    [...permitHubKeys.all, "draft", dealId, actionKind] as const,
  todayCount: () => [...permitHubKeys.all, "today-count"] as const,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(permit-hub): add React Query keys"
```

---

## Chunk 2: Data layer — shared helpers + queue/project/drafts APIs

Builds the server-side data layer. Each route is a thin wrapper around `src/lib/permit-hub.ts` helpers. Actions come in Chunk 3.

### Task 2.1: Create `src/lib/permit-hub.ts` with types and permission helper

**Files:**
- Create: `src/lib/permit-hub.ts`

- [ ] **Step 1: Write the file skeleton**

```typescript
/**
 * Permit Hub — Business Logic
 *
 * Solo workspace that aggregates context for open permit action items and
 * writes back via HubSpot task completion (preserving existing Workflows).
 * Mirrors lib/idr-meeting.ts structurally; extraction to shared primitives
 * deferred until IC Hub (second consumer).
 */

import { prisma } from "@/lib/db";
import { hubspotClient, searchWithRetry } from "@/lib/hubspot";
import { fetchAHJsForDeal, type AHJRecord } from "@/lib/hubspot-custom-objects";
import {
  PERMIT_ACTION_STATUSES,
  PERMIT_ACTION_TASK_SUBJECTS,
  PERMIT_ACTION_KINDS,
  actionKindForStatus,
  type PermitActionKind,
} from "@/lib/pi-statuses";

// --- Permission + flag helpers -----------------------------------------

export const PERMIT_HUB_ROLES = [
  "ADMIN",
  "EXECUTIVE",
  "OWNER",
  "PROJECT_MANAGER",
  "PERMIT",
  "TECH_OPS",
] as const;

export function isPermitHubAllowedRole(role: string): boolean {
  return (PERMIT_HUB_ROLES as readonly string[]).includes(role);
}

export function isPermitHubEnabled(): boolean {
  return process.env.PERMIT_HUB_ENABLED === "true";
}

/**
 * `requireApiAuth()` returns only `email` (no user id). For foreign-key use
 * (e.g., `PermitHubDraft.userId`, `ActivityLog.userId`), resolve the id here.
 * Returns null if no user row exists (rare — new user created by OAuth but
 * not yet synced — callers should fall back to `userEmail`-only write paths).
 */
export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

// --- Queue + project types ----------------------------------------------

export interface PermitQueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  status: string;
  actionLabel: string;
  daysInStatus: number;
  isStale: boolean;
  permitLead: string | null;
  pm: string | null;
  amount: number | null;
}

export interface PermitProjectDetail {
  deal: {
    id: string;
    name: string;
    address: string | null;
    amount: number | null;
    pbLocation: string | null;
    permitLead: string | null;
    pm: string | null;
    permittingStatus: string;
    actionKind: PermitActionKind | null;
    actionLabel: string | null;
    systemSizeKw: number | null;
    dealStage: string | null;
  };
  ahj: AHJRecord[];
  plansetFolderUrl: string | null;
  correspondenceSearchUrl: string | null;
  statusHistory: Array<{
    property: string;
    value: string | null;
    timestamp: string;
  }>;
  activity: Array<{
    id: string;
    type: "note" | "task" | "email";
    subject: string | null;
    bodyPreview: string | null;
    createdAt: string;
    completed?: boolean;
  }>;
}

export interface PermitDraftRecord {
  id: string;
  dealId: string;
  actionKind: string;
  payload: unknown;
  updatedAt: Date;
}

// Implementation helpers are exported from their own functions in later tasks.
```

- [ ] **Step 2: Verify imports compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permit-hub.ts
git commit -m "feat(permit-hub): add types, permission helper, feature flag check"
```

---

### Task 2.2: Queue fetch helper + `/api/permit-hub/queue` route

**Files:**
- Modify: `src/lib/permit-hub.ts`
- Create: `src/app/api/permit-hub/queue/route.ts`

- [ ] **Step 1: Add `fetchPermitQueue` to `permit-hub.ts`**

Append to `src/lib/permit-hub.ts`. Verify `searchWithRetry`'s signature in `src/lib/hubspot.ts` — the snippet below assumes `searchWithRetry(fn)` wraps a `deals.searchApi.doSearch` call consistent with how `idr-meeting.ts` and others use it. If the wrapper has a different shape in the repo, follow `idr-meeting.ts` as the authoritative example.

```typescript
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { STALE_THRESHOLD_DAYS, getPermitAction, getPermitStatusDisplayName } from "@/lib/pi-statuses";

/** Returns all deals currently sitting in one of the PERMIT_ACTION_STATUSES. */
export async function fetchPermitQueue(): Promise<PermitQueueItem[]> {
  const statuses = Object.keys(PERMIT_ACTION_STATUSES);
  const projectPipelineId = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

  const response = await searchWithRetry(() =>
    hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: projectPipelineId },
            { propertyName: "permitting_status", operator: FilterOperatorEnum.In, values: statuses },
          ],
        },
      ],
      properties: [
        "dealname",
        "address_line_1",
        "city",
        "state",
        "pb_location",
        "permitting_status",
        "hs_lastmodifieddate",
        "amount",
        "hubspot_owner_id",
        "project_manager",
        "permit_lead_name",
        "permit_lead_email",
        "calculated_system_size__kwdc_",
      ],
      limit: 200,
      sorts: ["hs_lastmodifieddate"],
    })
  );

  const items: PermitQueueItem[] = [];
  const now = Date.now();
  for (const deal of response.results ?? []) {
    const props = deal.properties as Record<string, string | null>;
    const status = props.permitting_status ?? "";
    const lastModified = props.hs_lastmodifieddate
      ? new Date(props.hs_lastmodifieddate).getTime()
      : now;
    const daysInStatus = Math.floor((now - lastModified) / (1000 * 60 * 60 * 24));

    items.push({
      dealId: deal.id,
      name: props.dealname ?? "Untitled",
      address: props.address_line_1 ?? null,
      pbLocation: props.pb_location ?? null,
      status: getPermitStatusDisplayName(status),
      actionLabel: getPermitAction(status) ?? "",
      daysInStatus,
      isStale: daysInStatus > STALE_THRESHOLD_DAYS,
      permitLead: props.permit_lead_name ?? null,
      pm: props.project_manager ?? null,
      amount: props.amount ? Number(props.amount) : null,
    });
  }

  // Stalest first
  items.sort((a, b) => b.daysInStatus - a.daysInStatus);
  return items;
}
```

Verify `getPermitAction` and `getPermitStatusDisplayName` exist in `pi-statuses.ts`. If either name differs, fix the import.

- [ ] **Step 2: Create the route**

Write `src/app/api/permit-hub/queue/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchPermitQueue,
  isPermitHubAllowedRole,
  isPermitHubEnabled,
} from "@/lib/permit-hub";

export async function GET() {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const queue = await fetchPermitQueue();
  return NextResponse.json({ queue, lastUpdated: new Date().toISOString() });
}
```

`requireApiAuth` returns `{ email, role, roles, name?, ip, userAgent }` (confirmed in `src/lib/api-auth.ts`). There is **no** `auth.user.id` — when a route needs a user id for a FK, call `resolveUserIdByEmail(auth.email)` (helper in `permit-hub.ts`). The queue endpoint doesn't need a user id, so it's unaffected.

- [ ] **Step 3: Verify the route compiles and responds**

Run: `npx tsc --noEmit`
Expected: no errors.

Start dev server locally, toggle `PERMIT_HUB_ENABLED=true` in `.env`, hit `/api/permit-hub/queue` as an authenticated admin. Expected: 200 with `{ queue: [...], lastUpdated: "..." }`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permit-hub.ts src/app/api/permit-hub/queue/route.ts
git commit -m "feat(permit-hub): queue fetch helper + /api/permit-hub/queue endpoint"
```

---

### Task 2.3: Project detail fetch + `/api/permit-hub/project/[dealId]`

**Files:**
- Modify: `src/lib/permit-hub.ts`
- Create: `src/app/api/permit-hub/project/[dealId]/route.ts`

- [ ] **Step 1: Add `fetchPermitProjectDetail` helper**

Append to `src/lib/permit-hub.ts`:

```typescript
export async function fetchPermitProjectDetail(
  dealId: string
): Promise<PermitProjectDetail | null> {
  // Parallel fetch: deal + AHJ records + status history + engagements
  const [dealResp, ahjRecords] = await Promise.all([
    hubspotClient.crm.deals.basicApi.getById(
      dealId,
      [
        "dealname", "address_line_1", "city", "state", "zip",
        "pb_location", "amount", "permit_lead_name", "project_manager",
        "permitting_status", "dealstage",
        "calculated_system_size__kwdc_",
        "planset_drive_folder_url",   // if present in your schema
      ],
      undefined,
      undefined,
      ["contacts", "companies"]
    ),
    fetchAHJsForDeal(dealId),
  ]);

  if (!dealResp) return null;

  const props = dealResp.properties as Record<string, string | null>;
  const permittingStatus = props.permitting_status ?? "";
  const actionLabel = getPermitAction(permittingStatus);
  const resolvedKind: PermitActionKind | null = actionKindForStatus(permittingStatus);

  const fullAddress = [props.address_line_1, props.city, props.state]
    .filter(Boolean)
    .join(", ") || null;

  // Correspondence tab — Gmail search deep-link (no fetching in v1)
  const ahjEmail = ahjRecords[0]?.properties?.email ?? null;
  const correspondenceSearchUrl = ahjEmail && fullAddress
    ? buildGmailSearchUrl(ahjEmail, fullAddress)
    : null;

  // Status history + activity — fetched via dedicated helpers below.
  const [statusHistory, activity] = await Promise.all([
    fetchPermitStatusHistory(dealId),
    fetchPermitActivity(dealId),
  ]);

  return {
    deal: {
      id: dealId,
      name: props.dealname ?? "Untitled",
      address: fullAddress,
      amount: props.amount ? Number(props.amount) : null,
      pbLocation: props.pb_location ?? null,
      permitLead: props.permit_lead_name ?? null,
      pm: props.project_manager ?? null,
      permittingStatus,
      actionKind: resolvedKind,
      actionLabel,
      systemSizeKw: props.calculated_system_size__kwdc_
        ? Number(props.calculated_system_size__kwdc_)
        : null,
      dealStage: props.dealstage ?? null,
    },
    ahj: ahjRecords,
    plansetFolderUrl: props.planset_drive_folder_url ?? null,
    correspondenceSearchUrl,
    statusHistory,
    activity,
  };
}

function buildGmailSearchUrl(ahjEmail: string, address: string): string {
  const query = encodeURIComponent(
    `from:${ahjEmail} OR to:${ahjEmail} "${address}"`
  );
  return `https://mail.google.com/mail/u/0/#search/${query}`;
}

async function fetchPermitStatusHistory(dealId: string) {
  // HubSpot property history API — returns timeline of changes for specific props.
  // See https://developers.hubspot.com/docs/api/crm/properties for prop history.
  try {
    const resp = await (hubspotClient as any).apiRequest({
      method: "GET",
      path: `/crm/v3/objects/deals/${dealId}`,
      qs: { propertiesWithHistory: "permitting_status,permit_submit,permit_issued" },
    });
    const body = await resp.json();
    const history: Array<{ property: string; value: string | null; timestamp: string }> = [];
    const propsWithHistory = body?.propertiesWithHistory ?? {};
    for (const [property, entries] of Object.entries(propsWithHistory)) {
      for (const entry of entries as Array<{ value: string; timestamp: string }>) {
        history.push({ property, value: entry.value, timestamp: entry.timestamp });
      }
    }
    history.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
    return history;
  } catch {
    return [];
  }
}

async function fetchPermitActivity(dealId: string) {
  // Uses getDealEngagements from hubspot-engagements.ts (not fetchDealEngagements).
  // The Engagement type comes from @/components/deal-detail/types. Before editing,
  // open that file and confirm the exact field names (likely: id, type, subject,
  // body/bodyPreview, timestamp/createdAt, status/completed). Adjust the mapper
  // below to match. Engagement.type values may include "email"|"call"|"note"|
  // "meeting"|"task" — for v1 we keep all permit-related and let the UI render by type.
  const { getDealEngagements } = await import("@/lib/hubspot-engagements");
  const engagements = await getDealEngagements(dealId);
  return engagements
    .filter((e: any) => {
      const subject = String(e.subject ?? e.title ?? "").toLowerCase();
      const body = String(e.body ?? e.bodyPreview ?? "").toLowerCase();
      return (
        subject.includes("permit") ||
        body.includes("permit") ||
        subject.includes("ahj") ||
        body.includes("ahj")
      );
    })
    .map((e: any) => ({
      id: String(e.id),
      type: String(e.type) as "note" | "task" | "email",
      subject: e.subject ?? e.title ?? null,
      bodyPreview: e.body ?? e.bodyPreview ?? null,
      createdAt: e.createdAt ?? e.timestamp ?? new Date().toISOString(),
      completed: e.completed ?? (e.status === "COMPLETED") ?? undefined,
    }));
}
```

**Verify the `Engagement` type in `src/components/deal-detail/types.ts` before finalizing the mapper — field names may differ from the `any`-cast assumptions above.** If the type enum has values not in `"note" | "task" | "email"` (e.g., `"call"`, `"meeting"`), widen the `type` union in `PermitProjectDetail.activity` and in the `ActivityTab` component to match.

- [ ] **Step 2: Create the route**

Write `src/app/api/permit-hub/project/[dealId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchPermitProjectDetail,
  isPermitHubAllowedRole,
  isPermitHubEnabled,
} from "@/lib/permit-hub";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const detail = await fetchPermitProjectDetail(dealId);
  if (!detail) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
```

- [ ] **Step 3: Manual smoke test**

With `PERMIT_HUB_ENABLED=true`, pick a deal ID from `/dashboards/pi-permit-action-queue`, hit `/api/permit-hub/project/<dealId>`. Expected: 200 JSON with the shape above; fields populated where HubSpot has data, null where it doesn't.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permit-hub.ts src/app/api/permit-hub/project/
git commit -m "feat(permit-hub): project detail endpoint with AHJ, history, activity"
```

---

### Task 2.4: Draft CRUD routes

**Files:**
- Create: `src/app/api/permit-hub/drafts/route.ts`
- Create: `src/app/api/permit-hub/drafts/[dealId]/[actionKind]/route.ts`

- [ ] **Step 1: POST /api/permit-hub/drafts — upsert draft**

Write `src/app/api/permit-hub/drafts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isPermitHubAllowedRole,
  isPermitHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/permit-hub";
import { PERMIT_ACTION_KINDS } from "@/lib/pi-statuses";

const DraftSchema = z.object({
  dealId: z.string().min(1),
  actionKind: z.enum(PERMIT_ACTION_KINDS),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = await resolveUserIdByEmail(auth.email);
  if (!userId) {
    return NextResponse.json({ error: "User record not found" }, { status: 500 });
  }

  const body = await req.json();
  const parsed = DraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { dealId, actionKind, payload } = parsed.data;
  const draft = await prisma.permitHubDraft.upsert({
    where: { userId_dealId_actionKind: { userId, dealId, actionKind } },
    create: { userId, dealId, actionKind, payload: payload as any },
    update: { payload: payload as any },
  });

  return NextResponse.json({ draft });
}
```

- [ ] **Step 2: GET and DELETE for specific draft**

Write `src/app/api/permit-hub/drafts/[dealId]/[actionKind]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { isPermitHubAllowedRole, isPermitHubEnabled } from "@/lib/permit-hub";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; actionKind: string }> }
) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = await resolveUserIdByEmail(auth.email);
  if (!userId) {
    return NextResponse.json({ error: "User record not found" }, { status: 500 });
  }

  const { dealId, actionKind } = await params;
  const draft = await prisma.permitHubDraft.findUnique({
    where: { userId_dealId_actionKind: { userId, dealId, actionKind } },
  });
  return NextResponse.json({ draft });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; actionKind: string }> }
) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = await resolveUserIdByEmail(auth.email);
  if (!userId) {
    return NextResponse.json({ error: "User record not found" }, { status: 500 });
  }

  const { dealId, actionKind } = await params;
  await prisma.permitHubDraft.deleteMany({
    where: { userId, dealId, actionKind },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Smoke test**

POST a draft: `curl -X POST .../api/permit-hub/drafts -d '{"dealId":"123","actionKind":"SUBMIT_TO_AHJ","payload":{"submitDate":"2026-04-24"}}'` → 200 with draft.
GET it back → 200 with same payload.
DELETE → 200 ok.
GET again → 200 with null.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/permit-hub/drafts/
git commit -m "feat(permit-hub): draft CRUD routes for crash recovery"
```

---

### Task 2.5: Today-count route + cron cleanup

**Files:**
- Create: `src/app/api/permit-hub/today-count/route.ts`
- Create: `src/app/api/cron/permit-hub-drafts-cleanup/route.ts`

- [ ] **Step 1: Today-count route**

Write `src/app/api/permit-hub/today-count/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { isPermitHubAllowedRole, isPermitHubEnabled } from "@/lib/permit-hub";
import type { ActivityType } from "@/generated/prisma";

const PERMIT_HUB_ACTIVITY_TYPES: ActivityType[] = [
  "PERMIT_SUBMITTED",
  "PERMIT_RESUBMITTED",
  "PERMIT_REJECTION_LOGGED",
  "PERMIT_REVISION_ROUTED",
  "PERMIT_REVISION_COMPLETED",
  "PERMIT_FOLLOWUP",
  "PERMIT_AS_BUILT_STARTED",
  "PERMIT_AS_BUILT_COMPLETED",
  "PERMIT_ISSUED",
  "PERMIT_SOLARAPP_SUBMITTED",
];

export async function GET() {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // ActivityLog stores deal references as (entityType="deal", entityId=dealId)
  // — NOT a `dealId` column. Confirmed via schema at prisma/schema.prisma:305.
  const entries = await prisma.activityLog.findMany({
    where: {
      userEmail: auth.email,
      type: { in: PERMIT_HUB_ACTIVITY_TYPES },
      createdAt: { gte: startOfDay },
    },
    select: {
      id: true,
      type: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    count: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      dealId: e.entityType === "deal" ? e.entityId : null,
      createdAt: e.createdAt,
    })),
  });
}
```

Filter by `userEmail` (not `userId`) to avoid the extra lookup — `ActivityLog.userEmail` is populated by `recordPermitActivity` regardless of whether the `User` row exists.

- [ ] **Step 2: Cron cleanup route**

Write `src/app/api/cron/permit-hub-drafts-cleanup/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  // Only allow cron invocation (Vercel Cron passes a bearer token)
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.permitHubDraft.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  return NextResponse.json({ deleted: result.count });
}
```

Check the existing cron pattern in `src/app/api/cron/audit-digest/` (or whichever cron route exists) to ensure the auth pattern matches.

- [ ] **Step 3: Register the cron in `vercel.json` (or whichever config the repo uses)**

Run Grep: pattern `"crons"`, glob `*.json`.
Expected: find `vercel.json` with a `crons` array. Add an entry:

```json
{
  "path": "/api/cron/permit-hub-drafts-cleanup",
  "schedule": "0 4 * * *"
}
```

(Runs daily at 4am UTC — low-traffic window.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/permit-hub/today-count/ src/app/api/cron/permit-hub-drafts-cleanup/ vercel.json
git commit -m "feat(permit-hub): today-count endpoint + daily draft cleanup cron"
```

---

## Chunk 3: Action routes + HubSpot task-completion helper

Chunk 3 builds the shared task-completion helper and the 9 action endpoints. Each action endpoint follows the same 6-step pattern: validate payload → find matching task → complete task (or escape hatch) → create note → ActivityLog entry → delete draft.

### Task 3.1: Shared `completePermitTask` helper

**Files:**
- Modify: `src/lib/permit-hub.ts`

- [ ] **Step 1: Add the helper — reuses `createDealNote` from `hubspot-engagements.ts`**

Append to `src/lib/permit-hub.ts`:

```typescript
import { createDealNote } from "@/lib/hubspot-engagements";

export interface CompleteTaskResult {
  taskCompleted: boolean;
  taskId?: string;
  /** True when no matching open task was found — caller should surface a warning. */
  taskNotFound?: boolean;
}

/**
 * Completes the HubSpot task on `dealId` whose subject matches one of the
 * patterns for this action kind, then attaches a note engagement (via
 * createDealNote) with the captured payload. Returns `taskNotFound: true` if
 * no matching task found — caller decides whether to write status fields.
 *
 * SDK paths confirmed from repo usage:
 *   - src/lib/hubspot-tasks.ts:220 → hubspotClient.crm.objects.tasks.searchApi.doSearch
 *   - src/lib/hubspot-tasks.ts:423 → hubspotClient.crm.objects.tasks.basicApi.update
 *   - src/lib/hubspot-engagements.ts:381 → hubspotClient.crm.objects.notes.basicApi.create
 *
 * Note: the SDK path is `objects.tasks.*`, NOT `objects.tasksApi.*`.
 */
export async function completePermitTask(opts: {
  dealId: string;
  actionKind: PermitActionKind;
  noteBody: string;
  /** Optional — when provided, falls back to updating these deal properties if no task is found. */
  fallbackProperties?: Record<string, string>;
  /** Whether to force fallback path even if task is found. Set by the "escape hatch" UI. */
  forceFallback?: boolean;
}): Promise<CompleteTaskResult> {
  const { dealId, actionKind, noteBody, fallbackProperties, forceFallback } = opts;
  const subjectPatterns = PERMIT_ACTION_TASK_SUBJECTS[actionKind];

  let taskCompleted = false;
  let taskId: string | undefined;

  if (!forceFallback) {
    // Find tasks associated with the deal via the associations API.
    // Verify the exact method shape against the HubSpot SDK version in package.json.
    // Pattern reference: src/lib/hubspot-tasks.ts uses `tasks.searchApi.doSearch`
    // with a deal-association filter — follow that approach if associationsApi
    // isn't available on `crm.deals`.
    try {
      const taskSearchResp = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              { propertyName: "associations.deal", operator: "EQ" as any, value: dealId },
              { propertyName: "hs_task_status", operator: "NEQ" as any, value: "COMPLETED" },
            ],
          },
        ],
        properties: ["hs_task_subject", "hs_task_status"],
        limit: 100,
      });

      const openMatch = (taskSearchResp.results ?? []).find((t: any) => {
        const subject = String(t.properties?.hs_task_subject ?? "").toLowerCase();
        return subjectPatterns.some((p) => subject.includes(p.toLowerCase()));
      });

      if (openMatch) {
        taskId = openMatch.id;
        await hubspotClient.crm.objects.tasks.basicApi.update(openMatch.id, {
          properties: {
            hs_task_status: "COMPLETED",
            hs_task_completion_date: String(Date.now()),
            hs_task_body: noteBody,
          },
        });
        taskCompleted = true;
      }
    } catch (err) {
      // Log but don't fail — let note + fallback proceed.
      console.error("[permit-hub] task search/completion failed", err);
    }
  }

  // Fallback: if task not found (or force), write the fallback deal properties.
  if (!taskCompleted && fallbackProperties) {
    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: fallbackProperties,
    });
  }

  // Always create a note engagement summarizing the action.
  await createDealNote(dealId, noteBody);

  return {
    taskCompleted,
    taskId,
    taskNotFound: !taskCompleted && !forceFallback,
  };
}
```

**Pre-commit verification:** run typecheck (`npx tsc --noEmit`). If `tasks.searchApi.doSearch` complains about the `associations.deal` filter syntax, cross-reference `src/lib/hubspot-tasks.ts:220-280` — that file has a working tasks-search pattern, copy the exact filter shape it uses.

- [ ] **Step 2: Add helper to record activity + delete draft**

Append:

```typescript
import type { ActivityType } from "@/generated/prisma";

/**
 * Writes a permit-hub ActivityLog entry.
 *
 * Schema note (prisma/schema.prisma:305): ActivityLog requires `description`
 * (no `?`), and uses `entityType` + `entityId` (not a `dealId` column) for
 * the affected-entity pointer. `metadata` is the JSON field for structured
 * payload details. Both `userId` and `userEmail` may be set — we set both so
 * queries can filter by either.
 */
export async function recordPermitActivity(opts: {
  userEmail: string;
  userName?: string;
  userId: string | null;
  type: ActivityType;
  dealId: string;
  /** Human-readable sentence — shown in the audit trail UI. */
  description: string;
  /** Structured payload for later analysis. */
  metadata?: unknown;
  /** Optional — deal name or address for the entityName field. */
  entityName?: string;
  /** Optional — deal pb_location. */
  pbLocation?: string;
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      type: opts.type,
      description: opts.description,
      userId: opts.userId ?? undefined,
      userEmail: opts.userEmail,
      userName: opts.userName,
      entityType: "deal",
      entityId: opts.dealId,
      entityName: opts.entityName,
      pbLocation: opts.pbLocation,
      metadata: (opts.metadata ?? {}) as any,
    },
  });
}

export async function deletePermitDraft(opts: {
  userId: string;
  dealId: string;
  actionKind: string;
}): Promise<void> {
  await prisma.permitHubDraft.deleteMany({
    where: { userId: opts.userId, dealId: opts.dealId, actionKind: opts.actionKind },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permit-hub.ts
git commit -m "feat(permit-hub): shared task-completion + activity log helpers"
```

---

### Task 3.2: `submit-to-ahj` action route (template for others)

**Files:**
- Create: `src/app/api/permit-hub/actions/submit-to-ahj/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import {
  completePermitTask,
  recordPermitActivity,
  deletePermitDraft,
  isPermitHubAllowedRole,
  isPermitHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/permit-hub";

const SubmitToAhjSchema = z.object({
  dealId: z.string().min(1),
  submissionDate: z.string(), // ISO date
  method: z.enum(["portal", "paper", "solarapp_plus", "other"]),
  referenceNumber: z.string().optional(),
  feePaid: z.boolean().optional(),
  notes: z.string().optional(),
  forceFallback: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = SubmitToAhjSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;

  const noteBody = [
    `<b>Submitted to AHJ</b>`,
    `Date: ${p.submissionDate}`,
    `Method: ${p.method}`,
    p.referenceNumber ? `Reference #: ${p.referenceNumber}` : null,
    p.feePaid !== undefined ? `Permit fee paid: ${p.feePaid ? "Yes" : "No"}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
    `Submitted by: ${auth.email}`,
  ].filter(Boolean).join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "SUBMIT_TO_AHJ",
    noteBody,
    fallbackProperties: {
      permit_submit: p.submissionDate,
      permitting_status: "Submitted to AHJ",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_SUBMITTED",
    dealId: p.dealId,
    description: `Submitted permit to AHJ (${p.method}${p.referenceNumber ? `, ref ${p.referenceNumber}` : ""})`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({
      userId,
      dealId: p.dealId,
      actionKind: "SUBMIT_TO_AHJ",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
```

- [ ] **Step 2: Manual smoke test**

Pick a test deal in a HubSpot sandbox (or a real deal with "Ready For Permitting" status in dev). Hit the route with a valid payload. Verify:
- Response 200 with `taskCompleted: true` (or `taskNotFound: true` if no matching task exists)
- A note appears on the deal timeline with the body
- Activity log entry exists: `SELECT * FROM "ActivityLog" WHERE type = 'PERMIT_SUBMITTED' ORDER BY "createdAt" DESC LIMIT 1;`
- No draft row remains for this deal+action

- [ ] **Step 3: Commit**

```bash
git add src/app/api/permit-hub/actions/submit-to-ahj/
git commit -m "feat(permit-hub): submit-to-ahj action route"
```

---

### Task 3.3: Remaining 8 action routes (batch)

Each follows the same shape as `submit-to-ahj`: Zod schema → note body → `completePermitTask` → resolve userId → `recordPermitActivity` (with `description` string) → `deletePermitDraft`. Payloads per spec. Every route uses `auth.email` (not `auth.user.id`) and calls `resolveUserIdByEmail(auth.email)` before draft deletion.

**Files:**
- Create: `src/app/api/permit-hub/actions/resubmit-to-ahj/route.ts`
- Create: `src/app/api/permit-hub/actions/review-rejection/route.ts`
- Create: `src/app/api/permit-hub/actions/follow-up/route.ts`
- Create: `src/app/api/permit-hub/actions/complete-revision/route.ts`
- Create: `src/app/api/permit-hub/actions/start-as-built-revision/route.ts`
- Create: `src/app/api/permit-hub/actions/complete-as-built/route.ts`
- Create: `src/app/api/permit-hub/actions/submit-solarapp/route.ts`
- Create: `src/app/api/permit-hub/actions/mark-permit-issued/route.ts`

- [ ] **Step 1: Build each route using `submit-to-ahj` as template**

For each route:
1. Copy the `submit-to-ahj` scaffold
2. Replace the Zod schema with the action-specific fields (see table below)
3. Replace the action kind and fallback properties
4. Set the correct `ActivityType`

| Route | Schema fields | Action kind | Fallback properties | ActivityType | Description template |
|---|---|---|---|---|---|
| `resubmit-to-ahj` | resubmissionDate, referenceNumber?, whatChanged, notes? | `RESUBMIT_TO_AHJ` | `{ permit_submit: resubmissionDate, permitting_status: "Resubmitted to AHJ" }` | `PERMIT_RESUBMITTED` | `Resubmitted permit to AHJ — ${whatChanged}` |
| `review-rejection` | rejectionDate, category ("design"\|"non_design"\|"paperwork"), reason, route ("design_revision"\|"non_design_fix"\|"paperwork_fix"), notes? | `REVIEW_REJECTION` | `{ permitting_status: <route-specific status> }` — `design_revision` → "In Design For Revision", `non_design_fix` → "Non-Design Related Rejection", `paperwork_fix` → "Rejected" | `PERMIT_REJECTION_LOGGED` PLUS a second call to `recordPermitActivity` with type `PERMIT_REVISION_ROUTED` | `Logged rejection (${category}): ${reason}` for first; `Routed to ${route}` for second |
| `follow-up` | contactDate, contactMethod ("phone"\|"email"\|"portal"\|"in_person"), whatWasSaid, nextFollowUpDate? | `FOLLOW_UP` | no fallback (purely a note) | `PERMIT_FOLLOWUP` | `Followed up with AHJ via ${contactMethod}` |
| `complete-revision` | completionDate, updatedPlansetUrl?, notes? | `COMPLETE_REVISION` | `{ permitting_status: "Returned from Design" }` | `PERMIT_REVISION_COMPLETED` | `Marked revision complete` |
| `start-as-built-revision` | trigger ("ahj_requested"\|"qc_caught"\|"customer"), scopeNotes | `START_AS_BUILT_REVISION` | `{ permitting_status: "As-Built Revision In Progress" }` | `PERMIT_AS_BUILT_STARTED` | `Started as-built revision (${trigger})` |
| `complete-as-built` | completionDate, updatedPlansetUrl?, notes? | `COMPLETE_AS_BUILT` | `{ permitting_status: "As-Built Ready To Resubmit" }` | `PERMIT_AS_BUILT_COMPLETED` | `Completed as-built revision` |
| `submit-solarapp` | submissionDate, solarAppProjectNumber, notes? | `SUBMIT_SOLARAPP` | `{ permit_submit: submissionDate, permitting_status: "Submitted to AHJ" }` | `PERMIT_SOLARAPP_SUBMITTED` | `Submitted SolarApp+ (project ${solarAppProjectNumber})` |
| `mark-permit-issued` | issueDate, permitNumber, expirationDate?, issuedPermitUrl? | `MARK_PERMIT_ISSUED` | `{ permit_issued: issueDate, permitting_status: "Permit Issued" }` | `PERMIT_ISSUED` | `Permit issued (${permitNumber})` |

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors across all 8 new routes.

- [ ] **Step 3: Smoke test 2 of the 8 (pick `review-rejection` and `follow-up` — most different shapes from template)**

Use a test deal in HubSpot sandbox. Verify the note is created with the right body content, the ActivityLog entry matches the new type, and the fallback property is written when task not found.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/permit-hub/actions/
git commit -m "feat(permit-hub): 8 additional action routes (resubmit, rejection, follow-up, revisions, solarapp, issued)"
```

---

## Chunk 4: Frontend — shell, queue, project detail

Chunk 4 ships the non-action UI: page scaffold, session header, left queue pane, right detail pane with tabs. Forms come in Chunk 5.

### Task 4.1: Dashboard page + client shell

**Files:**
- Create: `src/app/dashboards/permit-hub/page.tsx`
- Create: `src/app/dashboards/permit-hub/PermitHubClient.tsx`

- [ ] **Step 1: page.tsx — server component, auth + flag check**

```typescript
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import { PermitHubClient } from "./PermitHubClient";

export default async function PermitHubPage() {
  if (process.env.PERMIT_HUB_ENABLED !== "true") notFound();
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <DashboardShell
      title="Permit Hub"
      accentColor="blue"
      fullWidth
    >
      <PermitHubClient userEmail={session.user.email ?? ""} />
    </DashboardShell>
  );
}
```

- [ ] **Step 2: PermitHubClient.tsx — two-pane shell with selected-deal state**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { permitHubKeys } from "@/lib/query-keys";
import { SessionHeader } from "./SessionHeader";
import { PermitQueue } from "./PermitQueue";
import { ProjectDetail } from "./ProjectDetail";
import type { PermitQueueItem } from "@/lib/permit-hub";

export function PermitHubClient({ userEmail }: { userEmail: string }) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const queueQuery = useQuery<{ queue: PermitQueueItem[]; lastUpdated: string }>({
    queryKey: permitHubKeys.queue(),
    queryFn: async () => {
      const r = await fetch("/api/permit-hub/queue");
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
    staleTime: 30_000,
  });

  useSSE(() => queueQuery.refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "deals:permit",
  });

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] gap-3">
      <SessionHeader userEmail={userEmail} />
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="w-[420px] shrink-0 overflow-hidden rounded-xl border border-t-border bg-surface">
          <PermitQueue
            items={queueQuery.data?.queue ?? []}
            isLoading={queueQuery.isLoading}
            selectedDealId={selectedDealId}
            onSelect={setSelectedDealId}
          />
        </div>
        <div className="flex-1 overflow-hidden rounded-xl border border-t-border bg-surface">
          {selectedDealId ? (
            <ProjectDetail dealId={selectedDealId} />
          ) : (
            <div className="flex h-full items-center justify-center text-muted">
              Select a project from the queue to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + start dev server**

Run: `npm run dev`
Expected: `/dashboards/permit-hub` loads (will show empty because no child components yet render proper content).

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/permit-hub/page.tsx src/app/dashboards/permit-hub/PermitHubClient.tsx
git commit -m "feat(permit-hub): dashboard page scaffold + two-pane client shell"
```

---

### Task 4.2: SessionHeader

**Files:**
- Create: `src/app/dashboards/permit-hub/SessionHeader.tsx`

- [ ] **Step 1: Write SessionHeader**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { permitHubKeys } from "@/lib/query-keys";

export function SessionHeader({ userEmail }: { userEmail: string }) {
  const todayQuery = useQuery<{ count: number; entries: Array<{ type: string; dealId: string }> }>({
    queryKey: permitHubKeys.todayCount(),
    queryFn: async () => {
      const r = await fetch("/api/permit-hub/today-count");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 30_000,
  });

  const count = todayQuery.data?.count ?? 0;

  return (
    <div className="flex items-center justify-between rounded-xl border border-t-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="font-medium text-foreground">{userEmail}</span>
        <span>·</span>
        <span>Solo mode</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Touched today:</span>
        <span
          key={count}
          className="animate-value-flash inline-flex items-center justify-center rounded-full bg-blue-500/10 px-2.5 py-0.5 font-semibold text-blue-600 dark:text-blue-400"
        >
          {count}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/SessionHeader.tsx
git commit -m "feat(permit-hub): session header with touched-today counter"
```

---

### Task 4.3: PermitQueue — filterable, sortable list

**Files:**
- Create: `src/app/dashboards/permit-hub/PermitQueue.tsx`

- [ ] **Step 1: Write PermitQueue**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PermitQueueItem } from "@/lib/permit-hub";

interface Props {
  items: PermitQueueItem[];
  isLoading: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
}

export function PermitQueue({ items, isLoading, selectedDealId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = items;
    if (locationFilter !== "all") {
      list = list.filter((i) => i.pbLocation === locationFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.permitLead?.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, search, locationFilter]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.pbLocation && s.add(i.pbLocation));
    return Array.from(s).sort();
  }, [items]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-t-border px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, address, lead..."
          className="flex-1 rounded-md border border-t-border bg-surface-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="rounded-md border border-t-border bg-surface-2 px-2 py-1.5 text-sm"
        >
          <option value="all">All</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between border-b border-t-border px-4 py-2 text-xs text-muted">
        <span>
          {filtered.length} of {items.length} · sorted by days in status
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No action items in queue
          </div>
        ) : (
          <ul className="divide-y divide-t-border">
            {filtered.map((item) => {
              const selected = item.dealId === selectedDealId;
              return (
                <li key={item.dealId}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.dealId)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      selected
                        ? "bg-blue-500/10"
                        : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="truncate text-xs text-muted">
                          {item.address ?? "—"} · {item.pbLocation ?? "—"}
                        </div>
                      </div>
                      {item.isStale && (
                        <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                          Stale
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted">{item.status}</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {item.actionLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {item.daysInStatus}d · {item.permitLead ?? "Unassigned"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/PermitQueue.tsx
git commit -m "feat(permit-hub): queue pane with search, location filter, stale badge"
```

---

### Task 4.4: ProjectDetail with tab routing

**Files:**
- Create: `src/app/dashboards/permit-hub/ProjectDetail.tsx`

- [ ] **Step 1: Write ProjectDetail**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { permitHubKeys } from "@/lib/query-keys";
import { OverviewTab } from "./tabs/OverviewTab";
import { AhjTab } from "./tabs/AhjTab";
import { PlansetTab } from "./tabs/PlansetTab";
import { CorrespondenceTab } from "./tabs/CorrespondenceTab";
import { StatusHistoryTab } from "./tabs/StatusHistoryTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { ActionPanel } from "./actions/ActionPanel";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PermitProjectDetail } from "@/lib/permit-hub";

type TabKey = "overview" | "ahj" | "planset" | "correspondence" | "history" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "ahj", label: "AHJ" },
  { key: "planset", label: "Planset" },
  { key: "correspondence", label: "Correspondence" },
  { key: "history", label: "Status History" },
  { key: "activity", label: "Activity" },
];

export function ProjectDetail({ dealId }: { dealId: string }) {
  const [tab, setTab] = useState<TabKey>("overview");

  const detailQuery = useQuery<PermitProjectDetail>({
    queryKey: permitHubKeys.project(dealId),
    queryFn: async () => {
      const r = await fetch(`/api/permit-hub/project/${dealId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return <div className="p-6 text-red-500">Failed to load project.</div>;
  }

  const detail = detailQuery.data;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-t-border px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{detail.deal.name}</h2>
          <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            {detail.deal.permittingStatus}
          </span>
        </div>
        <div className="mt-1 text-sm text-muted">
          {detail.deal.address} · {detail.deal.pbLocation}
        </div>
      </div>

      <div className="flex gap-1 border-b border-t-border px-4">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-blue-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "overview" && <OverviewTab detail={detail} />}
        {tab === "ahj" && <AhjTab ahj={detail.ahj} />}
        {tab === "planset" && <PlansetTab url={detail.plansetFolderUrl} />}
        {tab === "correspondence" && (
          <CorrespondenceTab searchUrl={detail.correspondenceSearchUrl} />
        )}
        {tab === "history" && <StatusHistoryTab history={detail.statusHistory} />}
        {tab === "activity" && <ActivityTab activity={detail.activity} />}
      </div>

      {detail.deal.actionKind && (
        <div className="border-t border-t-border bg-surface-2 p-4">
          <ActionPanel dealId={dealId} actionKind={detail.deal.actionKind} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/ProjectDetail.tsx
git commit -m "feat(permit-hub): project detail pane with tab routing + action panel slot"
```

---

## Chunk 5: Context tabs

Chunk 5 fills in the 6 detail tabs. Each is pure presentation — reads from the `PermitProjectDetail` payload the parent already fetched.

### Task 5.1: OverviewTab

**Files:**
- Create: `src/app/dashboards/permit-hub/tabs/OverviewTab.tsx`

- [ ] **Step 1: Write OverviewTab**

```tsx
import { formatMoney } from "@/lib/format";
import type { PermitProjectDetail } from "@/lib/permit-hub";

export function OverviewTab({ detail }: { detail: PermitProjectDetail }) {
  const { deal } = detail;
  const fields: Array<[string, string | null]> = [
    ["Address", deal.address],
    ["Location", deal.pbLocation],
    ["System size", deal.systemSizeKw ? `${deal.systemSizeKw.toFixed(2)} kW` : null],
    ["Amount", deal.amount ? formatMoney(deal.amount) : null],
    ["Permit lead", deal.permitLead],
    ["Project manager", deal.pm],
    ["Current status", deal.permittingStatus],
    ["Next action", deal.actionLabel],
    ["Deal stage", deal.dealStage],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          <dd className="mt-0.5 font-medium">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/tabs/OverviewTab.tsx
git commit -m "feat(permit-hub): overview tab"
```

---

### Task 5.2: AhjTab

**Files:**
- Create: `src/app/dashboards/permit-hub/tabs/AhjTab.tsx`

- [ ] **Step 1: Write AhjTab**

```tsx
import type { AHJRecord } from "@/lib/hubspot-custom-objects";

export function AhjTab({ ahj }: { ahj: AHJRecord[] }) {
  if (!ahj.length) {
    return <div className="text-sm text-muted">No AHJ record associated with this deal.</div>;
  }
  return (
    <div className="space-y-6">
      {ahj.map((record) => {
        const p = record.properties;
        return (
          <div key={record.id} className="rounded-lg border border-t-border p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">{p.record_name ?? "Unnamed AHJ"}</h3>
                <div className="text-xs text-muted">
                  {[p.city, p.county, p.state].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                {p.portal_link && (
                  <a
                    href={p.portal_link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
                  >
                    Portal
                  </a>
                )}
                {p.application_link && (
                  <a
                    href={p.application_link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-surface-2 px-3 py-1 text-xs font-medium"
                  >
                    Application
                  </a>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Submission method" value={p.submission_method} />
              <Field label="Typical turnaround" value={p.average_permit_turnaround_time__365_days_} />
              <Field label="Primary contact" value={p.primary_contact_name} />
              <Field label="Contact email" value={p.email} />
              <Field label="Contact phone" value={p.phone_number} />
              <Field label="Stamping required" value={p.stamping_requirements} />
              <Field label="Customer signature req" value={p.customer_signature_required_on_permit} />
              <Field label="Permits issued (count)" value={p.permit_issued_count} />
              <Field label="Rejections (count)" value={p.permit_rejection_count} />
              <Field label="Avg revisions" value={p.average_permit_revision_count} />
            </dl>
            {p.permit_issues && (
              <div className="mt-4 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <strong>Known issues:</strong> {p.permit_issues}
              </div>
            )}
            {p.general_notes && (
              <div className="mt-2 text-xs text-muted">
                <strong>Notes:</strong> {p.general_notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5">{value != null && value !== "" ? String(value) : "—"}</dd>
    </div>
  );
}
```

Confirm the actual `AHJRecord` shape in `hubspot-custom-objects.ts`. If `.properties` is flat (not nested), adjust accordingly. Field names (e.g. `average_permit_turnaround_time__365_days_`) come from `AHJ_PROPERTIES`.

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/tabs/AhjTab.tsx
git commit -m "feat(permit-hub): AHJ tab with portal links + key stats"
```

---

### Task 5.3: PlansetTab + CorrespondenceTab

**Files:**
- Create: `src/app/dashboards/permit-hub/tabs/PlansetTab.tsx`
- Create: `src/app/dashboards/permit-hub/tabs/CorrespondenceTab.tsx`

- [ ] **Step 1: PlansetTab**

```tsx
export function PlansetTab({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="text-sm text-muted">
        No planset Drive folder URL on this deal. Add it via HubSpot → deal property <code>planset_drive_folder_url</code>.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Stamped planset files live in Google Drive.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
      >
        Open planset folder →
      </a>
    </div>
  );
}
```

- [ ] **Step 2: CorrespondenceTab**

```tsx
export function CorrespondenceTab({ searchUrl }: { searchUrl: string | null }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        v1 opens Gmail pre-filtered to the AHJ email and site address. Thread
        summaries + AI rejection parsing are on the roadmap.
      </p>
      {searchUrl ? (
        <a
          href={searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Open Gmail search →
        </a>
      ) : (
        <div className="text-sm text-muted">
          No AHJ email on file — add AHJ record with email to enable search.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/permit-hub/tabs/PlansetTab.tsx src/app/dashboards/permit-hub/tabs/CorrespondenceTab.tsx
git commit -m "feat(permit-hub): planset + correspondence tabs (deep-link only in v1)"
```

---

### Task 5.4: StatusHistoryTab + ActivityTab

**Files:**
- Create: `src/app/dashboards/permit-hub/tabs/StatusHistoryTab.tsx`
- Create: `src/app/dashboards/permit-hub/tabs/ActivityTab.tsx`

- [ ] **Step 1: StatusHistoryTab**

```tsx
export function StatusHistoryTab({
  history,
}: {
  history: Array<{ property: string; value: string | null; timestamp: string }>;
}) {
  if (!history.length) {
    return <div className="text-sm text-muted">No status history recorded.</div>;
  }
  return (
    <ol className="relative border-l border-t-border pl-6">
      {history.map((entry, i) => (
        <li key={i} className="mb-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-500" />
          <div className="text-xs text-muted">
            {new Date(entry.timestamp).toLocaleString()}
          </div>
          <div className="text-sm">
            <span className="font-mono text-xs text-muted">{entry.property}:</span>{" "}
            <span className="font-medium">{entry.value ?? "—"}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: ActivityTab**

```tsx
export function ActivityTab({
  activity,
}: {
  activity: Array<{
    id: string;
    type: "note" | "task" | "email";
    subject: string | null;
    bodyPreview: string | null;
    createdAt: string;
    completed?: boolean;
  }>;
}) {
  if (!activity.length) {
    return <div className="text-sm text-muted">No permit-related activity on this deal.</div>;
  }
  return (
    <ul className="space-y-3">
      {activity.map((a) => (
        <li key={a.id} className="rounded-lg border border-t-border p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium uppercase">
              {a.type}
            </span>
            <span className="text-xs text-muted">
              {new Date(a.createdAt).toLocaleString()}
            </span>
          </div>
          {a.subject && <div className="text-sm font-medium">{a.subject}</div>}
          {a.bodyPreview && (
            <div className="mt-1 line-clamp-3 text-xs text-muted">{a.bodyPreview}</div>
          )}
          {a.type === "task" && (
            <div className="mt-1 text-xs">
              {a.completed ? (
                <span className="text-emerald-600 dark:text-emerald-400">✓ Completed</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Open</span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/permit-hub/tabs/StatusHistoryTab.tsx src/app/dashboards/permit-hub/tabs/ActivityTab.tsx
git commit -m "feat(permit-hub): status history + activity tabs"
```

---

## Chunk 6: Action forms + form shell

Chunk 6 builds the action panel router, the shared `FormShell` (draft auto-save, submit, error), and the 9 concrete forms.

### Task 6.1: FormShell with draft auto-save

**Files:**
- Create: `src/app/dashboards/permit-hub/actions/FormShell.tsx`

- [ ] **Step 1: Write FormShell**

```tsx
"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { permitHubKeys } from "@/lib/query-keys";

interface Props<TPayload extends Record<string, unknown>> {
  dealId: string;
  actionKind: string;
  title: string;
  children: (
    value: Partial<TPayload>,
    update: (patch: Partial<TPayload>) => void
  ) => ReactNode;
  onSubmit: (payload: TPayload) => Promise<void>;
  validate: (value: Partial<TPayload>) => string | null;
  initialValue?: Partial<TPayload>;
}

export function FormShell<TPayload extends Record<string, unknown>>({
  dealId,
  actionKind,
  title,
  children,
  onSubmit,
  validate,
  initialValue = {},
}: Props<TPayload>) {
  const qc = useQueryClient();
  const [value, setValue] = useState<Partial<TPayload>>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load any existing draft
  const draftQuery = useQuery<{ draft: { payload: Partial<TPayload> } | null }>({
    queryKey: permitHubKeys.draft(dealId, actionKind),
    queryFn: async () => {
      const r = await fetch(`/api/permit-hub/drafts/${dealId}/${actionKind}`);
      if (!r.ok) return { draft: null };
      return r.json();
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (draftQuery.data?.draft?.payload) {
      setValue(draftQuery.data.draft.payload);
    }
  }, [draftQuery.data]);

  // Debounced auto-save
  function update(patch: Partial<TPayload>) {
    setValue((v) => {
      const next = { ...v, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setStatus("saving");
      saveTimer.current = setTimeout(() => {
        fetch("/api/permit-hub/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, actionKind, payload: next }),
        })
          .then(() => setStatus("saved"))
          .catch(() => setStatus("idle"));
      }, 750);
      return next;
    });
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const validationError = validate(value);
      if (validationError) throw new Error(validationError);
      await onSubmit(value as TPayload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: permitHubKeys.queue() });
      qc.invalidateQueries({ queryKey: permitHubKeys.project(dealId) });
      qc.invalidateQueries({ queryKey: permitHubKeys.todayCount() });
      qc.invalidateQueries({ queryKey: permitHubKeys.draft(dealId, actionKind) });
      setValue({});
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitMutation.mutate();
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-xs text-muted">
          {status === "saving" ? "Saving draft…" : status === "saved" ? "Draft saved" : ""}
        </span>
      </div>

      {children(value, update)}

      {error && (
        <div className="rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitMutation.isPending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {submitMutation.isPending ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/actions/FormShell.tsx
git commit -m "feat(permit-hub): reusable form shell with draft auto-save"
```

---

### Task 6.2: ActionPanel router

**Files:**
- Create: `src/app/dashboards/permit-hub/actions/ActionPanel.tsx`

- [ ] **Step 1: Write ActionPanel**

```tsx
"use client";

import type { PermitActionKind } from "@/lib/pi-statuses";
import { SubmitToAhjForm } from "./SubmitToAhjForm";
import { ResubmitToAhjForm } from "./ResubmitToAhjForm";
import { ReviewRejectionForm } from "./ReviewRejectionForm";
import { FollowUpForm } from "./FollowUpForm";
import { CompleteRevisionForm } from "./CompleteRevisionForm";
import { StartAsBuiltRevisionForm } from "./StartAsBuiltRevisionForm";
import { CompleteAsBuiltForm } from "./CompleteAsBuiltForm";
import { SubmitSolarAppForm } from "./SubmitSolarAppForm";
import { MarkPermitIssuedForm } from "./MarkPermitIssuedForm";

export function ActionPanel({
  dealId,
  actionKind,
}: {
  dealId: string;
  actionKind: PermitActionKind;
}) {
  switch (actionKind) {
    case "SUBMIT_TO_AHJ": return <SubmitToAhjForm dealId={dealId} />;
    case "RESUBMIT_TO_AHJ": return <ResubmitToAhjForm dealId={dealId} />;
    case "REVIEW_REJECTION": return <ReviewRejectionForm dealId={dealId} />;
    case "FOLLOW_UP": return <FollowUpForm dealId={dealId} />;
    case "COMPLETE_REVISION": return <CompleteRevisionForm dealId={dealId} />;
    case "START_AS_BUILT_REVISION": return <StartAsBuiltRevisionForm dealId={dealId} />;
    case "COMPLETE_AS_BUILT": return <CompleteAsBuiltForm dealId={dealId} />;
    case "SUBMIT_SOLARAPP": return <SubmitSolarAppForm dealId={dealId} />;
    case "MARK_PERMIT_ISSUED": return <MarkPermitIssuedForm dealId={dealId} />;
    default:
      return <div className="text-sm text-muted">No action form for this status.</div>;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/actions/ActionPanel.tsx
git commit -m "feat(permit-hub): action panel router"
```

---

### Task 6.3: SubmitToAhjForm (template)

**Files:**
- Create: `src/app/dashboards/permit-hub/actions/SubmitToAhjForm.tsx`

- [ ] **Step 1: Write form**

```tsx
"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  submissionDate: string;
  method: "portal" | "paper" | "solarapp_plus" | "other";
  referenceNumber?: string;
  feePaid?: boolean;
  notes?: string;
}

export function SubmitToAhjForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="SUBMIT_TO_AHJ"
      title="Submit to AHJ"
      validate={(v) =>
        !v.submissionDate ? "Submission date required" : !v.method ? "Method required" : null
      }
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/submit-to-ahj", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, ...payload }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      }}
    >
      {(v, update) => (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted">Submission date</span>
            <input
              type="date"
              value={v.submissionDate ?? ""}
              onChange={(e) => update({ submissionDate: e.target.value })}
              className="rounded-md border border-t-border bg-surface-2 px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted">Method</span>
            <select
              value={v.method ?? ""}
              onChange={(e) => update({ method: e.target.value as Payload["method"] })}
              className="rounded-md border border-t-border bg-surface-2 px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="portal">Portal</option>
              <option value="paper">Paper</option>
              <option value="solarapp_plus">SolarApp+</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase text-muted">Reference #</span>
            <input
              type="text"
              value={v.referenceNumber ?? ""}
              onChange={(e) => update({ referenceNumber: e.target.value })}
              className="rounded-md border border-t-border bg-surface-2 px-2 py-1.5"
            />
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              checked={v.feePaid ?? false}
              onChange={(e) => update({ feePaid: e.target.checked })}
            />
            <span className="text-xs uppercase text-muted">Permit fee paid</span>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs uppercase text-muted">Notes</span>
            <textarea
              value={v.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              rows={2}
              className="rounded-md border border-t-border bg-surface-2 px-2 py-1.5"
            />
          </label>
        </div>
      )}
    </FormShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/permit-hub/actions/SubmitToAhjForm.tsx
git commit -m "feat(permit-hub): submit-to-ahj form (template for other action forms)"
```

---

### Task 6.4: Remaining 8 forms (batch)

**Files:**
- Create: 8 form components under `src/app/dashboards/permit-hub/actions/`

- [ ] **Step 1: Build each form using `SubmitToAhjForm` as template**

Each form:
1. Copy `SubmitToAhjForm` scaffold.
2. Rename `Payload` interface fields per the action (see Task 3.3 schema table).
3. Update the form body with the new fields (use same `<label>` / `<input>` pattern).
4. Point `onSubmit` fetch at the correct `/api/permit-hub/actions/<kind>` endpoint.
5. Update the `title` string and `actionKind` prop.
6. Update `validate` to reflect required fields.

| Form | Title | Required fields | Optional fields |
|---|---|---|---|
| ResubmitToAhjForm | Resubmit to AHJ | resubmissionDate, whatChanged | referenceNumber, notes |
| ReviewRejectionForm | Review rejection | rejectionDate, category, reason, route | notes |
| FollowUpForm | Follow up with AHJ | contactDate, contactMethod, whatWasSaid | nextFollowUpDate |
| CompleteRevisionForm | Complete revision | completionDate | updatedPlansetUrl, notes |
| StartAsBuiltRevisionForm | Start as-built revision | trigger, scopeNotes | — |
| CompleteAsBuiltForm | Complete as-built | completionDate | updatedPlansetUrl, notes |
| SubmitSolarAppForm | Submit SolarApp | submissionDate, solarAppProjectNumber | notes |
| MarkPermitIssuedForm | Mark permit issued | issueDate, permitNumber | expirationDate, issuedPermitUrl |

For `ReviewRejectionForm`, category and route are dropdowns:
- category: `design` / `non_design` / `paperwork`
- route: `design_revision` / `non_design_fix` / `paperwork_fix`

- [ ] **Step 2: Typecheck + smoke test one complex form (ReviewRejectionForm) end-to-end**

Run: `npx tsc --noEmit`
Expected: no errors.

Load the page against a deal with `permitting_status = "Rejected"`. Fill out the form, submit. Verify: activity log entry `PERMIT_REJECTION_LOGGED`, HubSpot note on deal with rejection body, queue refetches and the item's status updates (if the workflow fired).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/permit-hub/actions/
git commit -m "feat(permit-hub): 8 additional action forms (resubmit, rejection, follow-up, revisions, solarapp, issued)"
```

---

## Chunk 7: Integration — suite card, route allowlist finalization, smoke test

Chunk 7 wires the new hub into suite navigation, double-checks permission plumbing end-to-end, and runs the full smoke test.

### Task 7.1: Add Permit Hub card to the P&I suite page

**Files:**
- Modify: `src/app/suites/permitting-interconnection/page.tsx`

- [ ] **Step 1: Add a card entry**

Open the file, find the card array or JSX block where dashboard cards are listed. Add a Permit Hub card following the existing card pattern:

```tsx
{process.env.NEXT_PUBLIC_PERMIT_HUB_ENABLED === "true" && (
  <SuiteCard
    title="Permit Hub"
    href="/dashboards/permit-hub"
    description="Workspace for working open permit action items — aggregated AHJ context and task-based writeback."
    icon="..."
    accent="blue"
  />
)}
```

(Exact card component name may differ — use whatever the other cards on that page use.)

- [ ] **Step 2: Commit**

```bash
git add src/app/suites/permitting-interconnection/page.tsx
git commit -m "feat(permit-hub): suite card on /suites/permitting-interconnection (flagged)"
```

---

### Task 7.2: Final route allowlist audit

- [ ] **Step 1: Verify both route prefixes are in every intended role**

Grep for `/dashboards/permit-hub` and `/api/permit-hub` in `src/lib/roles.ts` / `src/lib/role-permissions.ts`. Confirm both prefixes appear for:
- `ADMIN` (via `*` wildcard — no explicit entry needed)
- `EXECUTIVE`/`OWNER` (via `*`)
- `PROJECT_MANAGER`
- `PERMIT`
- `TECH_OPS`

If any are missing, add and commit.

- [ ] **Step 2: Boot the dev server and click through**

- Log in as a PERMIT user (or impersonate via `/admin/users` if admin).
- Navigate to `/suites/permitting-interconnection`. Expected: Permit Hub card visible (with flag on).
- Click the card. Expected: hub loads, queue populates.
- Click a project. Expected: detail pane loads with all 6 tabs, action panel visible.
- Fill out the action form. Expected: draft "Saving…" indicator, then "Saved" after ~1s.
- Submit. Expected: activity log entry created, HubSpot note created, queue refetches.

- [ ] **Step 3: Log as a non-permitted role (e.g., SALES) and verify 403**

Expected:
- `/suites/permitting-interconnection` does not show the card (or shows it but link 403s)
- Direct navigation to `/dashboards/permit-hub` → 403 from middleware
- Direct `curl /api/permit-hub/queue` with that user's cookie → 403

- [ ] **Step 4: If anything fails, fix and loop back through**

- [ ] **Step 5: Commit any fixes found during the audit**

---

### Task 7.3: Type + build verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success, no runtime errors in route collection phase.

- [ ] **Step 4: Commit any fixes**

---

### Task 7.4: Final checklist before handing to Peter

- [ ] **Step 1: Confirm env is set on Vercel preview**

Per feedback memory `feedback_vercel_env_sync.md`: push `PERMIT_HUB_ENABLED` and `NEXT_PUBLIC_PERMIT_HUB_ENABLED` to Vercel preview env (NOT prod yet). Verify with `vercel env ls preview`.

- [ ] **Step 2: Confirm migration has been applied to prod**

Per feedback memory `feedback_prisma_migration_before_code.md`: additive migration must land in prod DB BEFORE merging this code, because `findUnique` / client regen will fail otherwise. Coordinate with user; user will run `scripts/migrate-prod.sh` or equivalent.

- [ ] **Step 3: Deploy preview**

Expected: preview URL accessible. Click through the full flow against a real HubSpot deal (in sandbox or a test deal).

- [ ] **Step 4: Merge to main only after preview smoke passes**

- [ ] **Step 5: Enable flag in prod, invite Peter**

After merge to main:
- Flip `PERMIT_HUB_ENABLED=true` + `NEXT_PUBLIC_PERMIT_HUB_ENABLED=true` on Vercel prod.
- DM Peter the URL and ask him to work one permit through it end-to-end.
- Collect feedback for 1 week.
- After 1 week: decide whether to enable for CA lead; begin IC Hub scoping (which triggers the shared-framework extraction).

---

### Task 7.5: SSE invalidation wiring

The frontend subscribes to `cacheKeyFilter: "deals:permit"`. If nothing publishes that key when permit status changes, the queue won't auto-refetch and Peter will need to reload manually.

- [ ] **Step 1: Grep for `deals:permit` publishers**

Run: Grep for `deals:permit` in `src/app/api/stream/` and `src/lib/cache.ts`.
Expected: either a publisher exists (great, skip to step 3) or nothing matches.

- [ ] **Step 2: If no publisher, add one**

Look at the HubSpot deal webhook handler (likely `src/app/api/webhooks/hubspot/deal-sync/route.ts` or similar). When the incoming change touches `permitting_status`, `permit_submit`, or `permit_issued`, publish an SSE event with key `"deals:permit"` using the existing cache-invalidation helper. Follow the pattern used for other `deals:*` keys.

- [ ] **Step 3: Manual test**

With dev server + HubSpot sandbox: change a deal's `permitting_status` in HubSpot UI. Within ~30 seconds the Permit Hub queue should refetch on its own (no manual reload).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/
git commit -m "feat(permit-hub): publish deals:permit SSE key on permit status changes"
```

---

### Task 7.6: Per-chunk typecheck + lint passes

- [ ] **Step 1: Run the full project typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors in any new file.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

- [ ] **Step 3: Run the existing test suite**

Run: `npm run test`
Expected: all pass. No new tests are required in this plan (spec explicitly scopes tests out — action routes exercise real HubSpot, so manual smoke is the v1 test strategy; if later you want unit tests, mock `completePermitTask` and test the action-route branching).

---

## Appendix: Risks the executor should watch for

- **Task-subject matching is the fragile surface.** If `completePermitTask` returns `taskNotFound: true` on a real deal where the task clearly exists, grep the deal's tasks via HubSpot UI and refine the `PERMIT_ACTION_TASK_SUBJECTS` patterns in `pi-statuses.ts`. Adding a new pattern is cheaper than writing a UI for manual task selection.
- **Property-history API shape.** HubSpot's property-history endpoint is sometimes nested differently than the main properties endpoint. If `fetchPermitStatusHistory` returns empty on deals you know have status changes, log the raw response and adapt the extraction.
- **SSE cache key.** The client uses `cacheKeyFilter: "deals:permit"`. Verify something actually publishes to that key when permit status changes (grep for `"deals:permit"` in `src/app/api/stream/` and `src/lib/cache.ts`). If nothing does, add a publisher in whatever code path handles the HubSpot deal webhook for permit status changes.
- **AHJ record shape.** `AHJRecord` properties live under `record.properties` but may also be flattened in the returned object. Verify by console-logging one record during development.
- **HubSpot note association type ID.** `createDealNote` already handles this (association type 214). Don't hand-roll.
