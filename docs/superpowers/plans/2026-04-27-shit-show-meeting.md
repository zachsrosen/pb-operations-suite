# Shit Show Meeting Hub Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a session-based "Shit Show Meeting" hub at `/dashboards/shit-show-meeting` for the owner to review problem projects, capture decisions and follow-ups, and write outcomes back to HubSpot. Move the "shit show flagged" boolean from a per-session DB column (`IdrMeetingItem.shitShowFlagged`) to a deal-level HubSpot custom property (`pb_shit_show_flagged`) so the flag is consistent across IDR, the new hub, HubSpot views, and future workflows.

**Architecture:** Mirrors the existing IDR Meeting hub pattern (sessions, presence, project queue, per-project detail pane, end-of-session HubSpot writes). Adds 4 Prisma tables and 5 enums. Routes everything (including cross-namespace dependencies like deal search and IDR notes) under `/api/shit-show-meeting/*` so role allowlist coverage is single-prefix and silent 403s are impossible. The IDR Meeting hub's existing 🔥 toggle is rewired in-place to write to the new HubSpot property instead of `IdrMeetingItem`.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 on Neon Postgres, HubSpot REST API (`searchWithRetry` rate-limit-aware client), NextAuth, React Query, SSE for presence/refresh, Tailwind v4 + theme tokens, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-04-27-shit-show-meeting-design.md`

**Library layout:** matches spec — `src/lib/shit-show/*.ts` directory with one file per module. Initial review considered following IDR's flat-file precedent, but splitting was reverted because (1) the combined file would exceed 800 lines by end of Chunk 2; (2) jest module-mocking is cleaner across module boundaries (mocking `hubspot-flag.ts` from `decision.ts` works; mocking the module under test does not); (3) spec §5 already commits to this shape. Files: `hubspot-flag.ts`, `hubspot-task.ts`, `hubspot-note.ts`, `snapshot.ts`, `decision.ts`.

---

## File Structure

### New files

```
prisma/schema.prisma                                         (modify; add 4 tables, 5 enums)
src/lib/shit-show/hubspot-flag.ts                            (create; deal property read/write)
src/lib/shit-show/hubspot-task.ts                            (create; HubSpot task creation + escalation)
src/lib/shit-show/hubspot-note.ts                            (create; end-of-session timeline note)
src/lib/shit-show/snapshot.ts                                (create; pull flagged deals into a session)
src/lib/shit-show/decision.ts                                (create; applyDecision orchestrator)
scripts/backfill-shit-show-flags.ts                          (create; one-time backfill)

# API
src/app/api/shit-show-meeting/sessions/route.ts                       (GET list, POST create)
src/app/api/shit-show-meeting/sessions/[id]/route.ts                  (GET detail, PATCH, DELETE)
src/app/api/shit-show-meeting/sessions/[id]/snapshot/route.ts         (POST: pull flagged deals)
src/app/api/shit-show-meeting/sessions/[id]/end/route.ts              (POST: end, post HubSpot notes)
src/app/api/shit-show-meeting/items/[id]/route.ts                     (PATCH: notes, decision, rationale)
src/app/api/shit-show-meeting/items/[id]/assignments/route.ts         (GET, POST)
src/app/api/shit-show-meeting/assignments/[id]/route.ts               (PATCH: status updates)
src/app/api/shit-show-meeting/presence/route.ts                       (SSE-style presence)
src/app/api/shit-show-meeting/search/route.ts                         (past sessions)
src/app/api/shit-show-meeting/deal-search/route.ts                    (HubSpot deal search proxy)
src/app/api/shit-show-meeting/flag/route.ts                           (POST: write deal property)
src/app/api/shit-show-meeting/idr-notes/[dealId]/route.ts             (proxy: read IdrMeetingNote)
src/app/api/shit-show-meeting/users/route.ts                          (proxy: list active users)
src/app/api/cron/shit-show-task-sync/route.ts                         (cron: poll task close-back)

# UI
src/app/dashboards/shit-show-meeting/page.tsx                         (server component, role gate)
src/app/dashboards/shit-show-meeting/ShitShowMeetingClient.tsx        (top-level client)
src/app/dashboards/shit-show-meeting/SessionHeader.tsx
src/app/dashboards/shit-show-meeting/ProjectQueue.tsx
src/app/dashboards/shit-show-meeting/AddProjectDialog.tsx
src/app/dashboards/shit-show-meeting/ProjectDetail.tsx
src/app/dashboards/shit-show-meeting/ReasonPanel.tsx
src/app/dashboards/shit-show-meeting/ProjectInfoPanel.tsx
src/app/dashboards/shit-show-meeting/HistoryStrip.tsx
src/app/dashboards/shit-show-meeting/IdrNotesContext.tsx
src/app/dashboards/shit-show-meeting/MeetingNotesForm.tsx
src/app/dashboards/shit-show-meeting/AssignmentsPanel.tsx
src/app/dashboards/shit-show-meeting/DecisionActions.tsx
src/app/dashboards/shit-show-meeting/MeetingSearch.tsx

# Tests
src/__tests__/shit-show-flag.test.ts                                  (HubSpot property reads/writes)
src/__tests__/shit-show-decision.test.ts                              (decision side-effect logic)
src/__tests__/shit-show-snapshot.test.ts                              (snapshot pulls)
src/__tests__/shit-show-end-session.test.ts                           (note idempotency)
src/__tests__/shit-show-escalation.test.ts                            (transaction shape)
src/__tests__/backfill-shit-show.test.ts                              (backfill resumability)
```

### Modified files

```
src/app/api/idr-meeting/items/[id]/route.ts                  (rewire shitShowFlagged write)
src/app/api/idr-meeting/preview/route.ts                     (read flag from HubSpot)
src/app/dashboards/idr-meeting/StatusActionsForm.tsx         (add tooltip on toggle)
src/lib/roles.ts                                             (add allowlist for 15 roles)
src/lib/suite-nav.ts                                         (add Executive suite card)
```

---

## Chunk 1: Foundation — Schema, Library, Backfill, IDR Rewire

The DB and lib changes that everything else depends on. End state: `pb_shit_show_flagged` is the source of truth, IDR's existing 🔥 toggle still works, the four Shit Show tables exist, the backfill has run.

### Task 1.1: Prisma schema additions

**Files:**
- Modify: `prisma/schema.prisma` — append new tables and enums after the existing IDR models (which end around line 2450).

- [ ] **Step 1: Add the four new tables and five new enums**

Append to `prisma/schema.prisma`:

```prisma
// ===========================================================================
// Shit Show Meeting Hub
// ===========================================================================

model ShitShowSession {
  id        String                @id @default(cuid())
  date      DateTime
  status    ShitShowSessionStatus @default(DRAFT)
  createdBy String
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt

  items ShitShowSessionItem[]

  @@index([date])
}

enum ShitShowSessionStatus {
  DRAFT
  ACTIVE
  COMPLETED
}

model ShitShowSessionItem {
  id        String          @id @default(cuid())
  sessionId String
  session   ShitShowSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  dealId    String
  region    String
  sortOrder Int             @default(0)

  // Snapshot fields (populated at session start; refreshed via stale-while-revalidate)
  dealName              String
  dealAmount            Float?
  systemSizeKw          Float?
  stage                 String?
  dealOwner             String?
  reasonSnapshot        String?
  flaggedSince          DateTime?
  address               String?
  projectType           String?
  equipmentSummary      String?
  surveyStatus          String?
  surveyDate            String?
  designStatus          String?
  designApprovalStatus  String?
  plansetDate           String?
  ahj                   String?
  utilityCompany        String?
  projectManager        String?
  operationsManager     String?
  siteSurveyor          String?
  driveFolderUrl        String?
  surveyFolderUrl       String?
  designFolderUrl       String?
  salesFolderUrl        String?
  openSolarUrl          String?
  snapshotUpdatedAt     DateTime @default(now())

  // Filled during the meeting
  meetingNotes      String?
  decision          ShitShowDecision @default(PENDING)
  decisionRationale String?
  resolvedAt        DateTime?
  resolvedBy        String?

  // External writes — IDs stored for idempotency
  hubspotNoteId   String?
  noteSyncStatus  ShitShowSyncStatus @default(PENDING)
  noteSyncError   String?

  // Escalation external IDs (rationale itself lives in decisionRationale)
  idrEscalationQueueId    String?
  hubspotEscalationTaskId String?

  addedBy     ShitShowAddedBy @default(SYSTEM)
  addedByUser String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  assignments ShitShowAssignment[]

  @@unique([sessionId, dealId])
  @@index([sessionId, region])
  @@index([dealId])
}

enum ShitShowDecision {
  PENDING
  RESOLVED
  STILL_PROBLEM
  ESCALATED
  DEFERRED
}

enum ShitShowSyncStatus {
  PENDING
  SYNCED
  FAILED
}

enum ShitShowAddedBy {
  SYSTEM
  MANUAL
}

model ShitShowAssignment {
  id            String              @id @default(cuid())
  sessionItemId String
  sessionItem   ShitShowSessionItem @relation(fields: [sessionItemId], references: [id], onDelete: Cascade)

  assigneeUserId String
  dueDate        DateTime?
  actionText     String

  status ShitShowAssignmentStatus @default(OPEN)

  hubspotTaskId  String?
  taskSyncStatus ShitShowSyncStatus @default(PENDING)
  taskSyncError  String?

  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sessionItemId])
  @@index([assigneeUserId, status])
}

enum ShitShowAssignmentStatus {
  OPEN
  COMPLETED
  CANCELLED
}

model ShitShowBackfillRun {
  id          String    @id @default(cuid())
  startedAt   DateTime  @default(now())
  completedAt DateTime?
  processed   Int       @default(0)
  errors      Int       @default(0)
  errorLog    Json      @default("[]")
  status      String    @default("RUNNING")

  @@index([status])
}
```

- [ ] **Step 2: Generate Prisma client locally**

Run: `npm run build` (which runs `prisma generate && next build`)
Expected: Prisma client regenerates with new models. No build errors yet from new lib (it doesn't exist). If build fails on missing files, that's expected — only verify Prisma generation succeeded.

If the build fails ONLY on missing imports from non-existent lib/route files, that's fine — the schema generation step succeeded, which is what this task verifies.

- [ ] **Step 3: STOP — HUMAN runs migration**

The user must run the migration manually per the project rule (`feedback_subagents_no_migrations.md`):
```bash
npx prisma migrate dev --name add_shit_show_meeting
```
Wait for confirmation before proceeding. Do not run migrations yourself.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(shit-show): Prisma schema for shit show meeting hub

Adds ShitShowSession, ShitShowSessionItem, ShitShowAssignment,
ShitShowBackfillRun tables and 5 enums."
```

### Task 1.2: HubSpot flag library — `setShitShowFlag` / `getShitShowFlag`

**Files:**
- Create: `src/lib/shit-show-meeting.ts`
- Test: `src/__tests__/shit-show-flag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/shit-show-flag.test.ts`:

```typescript
import { setShitShowFlag, readShitShowFlag, SHIT_SHOW_PROPS } from "@/lib/shit-show-meeting";

// Mock the hubspot module
jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn(),
  getDealProperties: jest.fn(),
}));

import { updateDealProperty, getDealProperties } from "@/lib/hubspot";

const mockUpdate = updateDealProperty as jest.MockedFunction<typeof updateDealProperty>;
const mockGet = getDealProperties as jest.MockedFunction<typeof getDealProperties>;

describe("shit-show flag", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("setShitShowFlag(dealId, true, reason)", () => {
    it("sets all 3 properties when flag transitions false→true", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "false",
        pb_shit_show_reason: null,
        pb_shit_show_flagged_since: null,
      });
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", true, "Customer angry");

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const [dealId, properties] = mockUpdate.mock.calls[0];
      expect(dealId).toBe("deal-123");
      expect(properties.pb_shit_show_flagged).toBe("true");
      expect(properties.pb_shit_show_reason).toBe("Customer angry");
      expect(properties.pb_shit_show_flagged_since).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it("does NOT update flagged_since when already true", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "true",
        pb_shit_show_reason: "old reason",
        pb_shit_show_flagged_since: "2026-04-01",
      });
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", true, "new reason");

      const [, properties] = mockUpdate.mock.calls[0];
      expect(properties.pb_shit_show_reason).toBe("new reason");
      expect(properties.pb_shit_show_flagged_since).toBeUndefined();
    });
  });

  describe("setShitShowFlag(dealId, false)", () => {
    it("clears all 3 properties on resolve", async () => {
      mockUpdate.mockResolvedValue(true);

      await setShitShowFlag("deal-123", false);

      const [, properties] = mockUpdate.mock.calls[0];
      expect(properties.pb_shit_show_flagged).toBe("false");
      expect(properties.pb_shit_show_reason).toBe("");
      expect(properties.pb_shit_show_flagged_since).toBe("");
    });
  });

  describe("readShitShowFlag(dealId)", () => {
    it("returns parsed shape", async () => {
      mockGet.mockResolvedValue({
        pb_shit_show_flagged: "true",
        pb_shit_show_reason: "Issue",
        pb_shit_show_flagged_since: "2026-04-15",
      });

      const result = await readShitShowFlag("deal-123");

      expect(result).toEqual({
        flagged: true,
        reason: "Issue",
        flaggedSince: new Date("2026-04-15"),
      });
    });
  });

  it("exports the property names as constants", () => {
    expect(SHIT_SHOW_PROPS.FLAGGED).toBe("pb_shit_show_flagged");
    expect(SHIT_SHOW_PROPS.REASON).toBe("pb_shit_show_reason");
    expect(SHIT_SHOW_PROPS.FLAGGED_SINCE).toBe("pb_shit_show_flagged_since");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/shit-show-flag.test.ts -v`
Expected: FAIL with "Cannot find module @/lib/shit-show-meeting".

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/shit-show-meeting.ts`:

```typescript
/**
 * Shit Show Meeting Hub — Business Logic
 *
 * Helpers for: HubSpot deal property reads/writes (the flag), session snapshot,
 * decision side-effect orchestration, end-of-session HubSpot note posting,
 * and HubSpot task creation for assignments + escalations.
 */

import { updateDealProperty, getDealProperties } from "@/lib/hubspot";

// ---------------------------------------------------------------------------
// HubSpot property names — single point of truth, exported for callers
// ---------------------------------------------------------------------------

export const SHIT_SHOW_PROPS = {
  FLAGGED: "pb_shit_show_flagged",
  REASON: "pb_shit_show_reason",
  FLAGGED_SINCE: "pb_shit_show_flagged_since",
} as const;

// ---------------------------------------------------------------------------
// Flag read/write
// ---------------------------------------------------------------------------

export type ShitShowFlagState = {
  flagged: boolean;
  reason: string | null;
  flaggedSince: Date | null;
};

/**
 * Read the current shit-show flag state for a deal.
 */
export async function readShitShowFlag(dealId: string): Promise<ShitShowFlagState> {
  const props = await getDealProperties(dealId, [
    SHIT_SHOW_PROPS.FLAGGED,
    SHIT_SHOW_PROPS.REASON,
    SHIT_SHOW_PROPS.FLAGGED_SINCE,
  ]);
  return {
    flagged: props?.[SHIT_SHOW_PROPS.FLAGGED] === "true",
    reason: (props?.[SHIT_SHOW_PROPS.REASON] as string) || null,
    flaggedSince: props?.[SHIT_SHOW_PROPS.FLAGGED_SINCE]
      ? new Date(props[SHIT_SHOW_PROPS.FLAGGED_SINCE] as string)
      : null,
  };
}

/**
 * Set or clear the shit-show flag on a deal.
 *
 * - When flagged=true and the deal isn't already flagged, sets flagged_since=now().
 * - When flagged=true and the deal is already flagged, leaves flagged_since alone (just updates reason).
 * - When flagged=false, clears all three properties.
 */
export async function setShitShowFlag(
  dealId: string,
  flagged: boolean,
  reason?: string,
): Promise<void> {
  if (!flagged) {
    await updateDealProperty(dealId, {
      [SHIT_SHOW_PROPS.FLAGGED]: "false",
      [SHIT_SHOW_PROPS.REASON]: "",
      [SHIT_SHOW_PROPS.FLAGGED_SINCE]: "",
    });
    return;
  }

  // flagged=true: check if it's already true to decide whether to stamp flagged_since
  const current = await readShitShowFlag(dealId);
  const properties: Record<string, string> = {
    [SHIT_SHOW_PROPS.FLAGGED]: "true",
    [SHIT_SHOW_PROPS.REASON]: reason ?? "",
  };
  if (!current.flagged) {
    properties[SHIT_SHOW_PROPS.FLAGGED_SINCE] = new Date().toISOString().slice(0, 10);
  }
  await updateDealProperty(dealId, properties);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/shit-show-flag.test.ts -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shit-show-meeting.ts src/__tests__/shit-show-flag.test.ts
git commit -m "feat(shit-show): HubSpot flag read/write helpers"
```

### Task 1.3: Backfill script

**Files:**
- Create: `scripts/backfill-shit-show-flags.ts`
- Test: `src/__tests__/backfill-shit-show.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/backfill-shit-show.test.ts` covering: dedupes by dealId, picks the latest non-null reason, resumes from a partially-completed run, records errors per failed deal.

```typescript
import { runBackfill } from "../../scripts/backfill-shit-show-flags";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    idrMeetingItem: { findMany: jest.fn() },
    shitShowBackfillRun: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/shit-show-meeting", () => ({ setShitShowFlag: jest.fn() }));

import { setShitShowFlag } from "@/lib/shit-show-meeting";

const mockFindMany = prisma.idrMeetingItem.findMany as jest.Mock;
const mockCreate = prisma.shitShowBackfillRun.create as jest.Mock;
const mockUpdate = prisma.shitShowBackfillRun.update as jest.Mock;
const mockFindFirst = prisma.shitShowBackfillRun.findFirst as jest.Mock;
const mockSetFlag = setShitShowFlag as jest.MockedFunction<typeof setShitShowFlag>;

describe("backfill shit-show flags", () => {
  beforeEach(() => jest.clearAllMocks());

  it("dedupes flagged items by dealId, picks latest non-null reason", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "run-1" });
    mockFindMany.mockResolvedValue([
      { dealId: "d1", shitShowReason: "old reason", updatedAt: new Date("2026-04-01") },
      { dealId: "d1", shitShowReason: "newer reason", updatedAt: new Date("2026-04-15") },
      { dealId: "d2", shitShowReason: null, updatedAt: new Date("2026-04-10") },
    ]);
    mockSetFlag.mockResolvedValue();

    await runBackfill();

    expect(mockSetFlag).toHaveBeenCalledTimes(2);
    expect(mockSetFlag).toHaveBeenCalledWith("d1", true, "newer reason");
    expect(mockSetFlag).toHaveBeenCalledWith("d2", true, "");
  });

  it("resumes from existing RUNNING row instead of creating a new one", async () => {
    mockFindFirst.mockResolvedValue({ id: "run-prev", processed: 5 });
    mockFindMany.mockResolvedValue([]);

    await runBackfill();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-prev" },
    }));
  });

  it("records errors per failed deal without aborting the run", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "run-1" });
    mockFindMany.mockResolvedValue([
      { dealId: "d1", shitShowReason: "r1", updatedAt: new Date() },
      { dealId: "d2", shitShowReason: "r2", updatedAt: new Date() },
    ]);
    mockSetFlag
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("HubSpot 500"));

    await runBackfill();

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        processed: 2,
        errors: 1,
        status: "COMPLETED",
      }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/backfill-shit-show.test.ts -v`
Expected: FAIL — script doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/backfill-shit-show-flags.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * One-time backfill: copy IdrMeetingItem.shitShowFlagged + shitShowReason
 * into HubSpot deal properties (pb_shit_show_flagged + pb_shit_show_reason +
 * pb_shit_show_flagged_since). Resumable; tracks progress in ShitShowBackfillRun.
 *
 * Usage: npx tsx scripts/backfill-shit-show-flags.ts
 */
import { prisma } from "@/lib/db";
import { setShitShowFlag } from "@/lib/shit-show-meeting";

export async function runBackfill(): Promise<void> {
  const existing = await prisma.shitShowBackfillRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });

  const run = existing
    ? existing
    : await prisma.shitShowBackfillRun.create({ data: { status: "RUNNING" } });

  const items = await prisma.idrMeetingItem.findMany({
    where: { shitShowFlagged: true },
    select: { dealId: true, shitShowReason: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  // Dedupe by dealId, keeping the most recent non-null reason.
  const byDeal = new Map<string, { reason: string; updatedAt: Date }>();
  for (const item of items) {
    if (!byDeal.has(item.dealId)) {
      byDeal.set(item.dealId, {
        reason: item.shitShowReason ?? "",
        updatedAt: item.updatedAt,
      });
    }
  }

  const errorLog: Array<{ dealId: string; error: string }> = [];
  let processed = 0;
  for (const [dealId, { reason }] of byDeal) {
    try {
      await setShitShowFlag(dealId, true, reason);
      processed += 1;
    } catch (e) {
      errorLog.push({
        dealId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await prisma.shitShowBackfillRun.update({
    where: { id: run.id },
    data: {
      processed,
      errors: errorLog.length,
      errorLog,
      completedAt: new Date(),
      status: "COMPLETED",
    },
  });

  console.log(`[backfill] processed=${processed} errors=${errorLog.length}`);
}

if (require.main === module) {
  runBackfill().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/backfill-shit-show.test.ts -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-shit-show-flags.ts src/__tests__/backfill-shit-show.test.ts
git commit -m "feat(shit-show): resumable backfill from IdrMeetingItem to HubSpot"
```

### Task 1.4: IDR rewire — `items/[id]/route.ts`

**Files:**
- Modify: `src/app/api/idr-meeting/items/[id]/route.ts` — when the PATCH body has `shitShowFlagged` or `shitShowReason`, write to HubSpot via `setShitShowFlag` instead of (or in addition to, during the bake period) the local column.

- [ ] **Step 1: Read current implementation**

Read the file. Find the editable-fields whitelist (around line 13) and the PATCH handler.

- [ ] **Step 2: Write the change**

Strategy for the bake period: write to BOTH (HubSpot property AND existing column) so the IDR queue's existing render path still works without changes. After bake the column drop migration retires the column write.

Find the PATCH handler. After parsing the body, if `body.shitShowFlagged !== undefined` or `body.shitShowReason !== undefined`:

```typescript
import { setShitShowFlag } from "@/lib/shit-show-meeting";
import { prisma } from "@/lib/db";

// ... existing PATCH handler ...
const item = await prisma.idrMeetingItem.findUnique({ where: { id }, select: { dealId: true } });
if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

if (body.shitShowFlagged !== undefined) {
  // Write to HubSpot property — single source of truth
  try {
    await setShitShowFlag(
      item.dealId,
      body.shitShowFlagged,
      body.shitShowFlagged ? (body.shitShowReason ?? "") : undefined,
    );
  } catch (e) {
    console.error("[idr-items] failed to set shit-show flag in HubSpot", e);
    // Continue — the local column still updates so we don't fail the user's PATCH
  }
}
```

Keep the existing column write in place during bake. The column will be dropped in a separate migration after one week.

- [ ] **Step 3: Run any existing IDR test**

Run: `npx jest src/__tests__/idr-adder-persistence.test.ts -v`
Expected: PASS (no changes to that test's surface area).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/idr-meeting/items/[id]/route.ts
git commit -m "feat(idr): mirror shit-show flag writes to HubSpot deal property"
```

### Task 1.5: IDR rewire — `preview/route.ts`

**Files:**
- Modify: `src/app/api/idr-meeting/preview/route.ts` — `shitShowFlagged: false` defaults read from HubSpot during the bake period (with column as fallback). Note: per the spec, the IDR preview reads `IdrMeetingItem.shitShowFlagged` today; we want the new HubSpot value to win.

- [ ] **Step 1: Read current implementation**

Find the two `shitShowFlagged: false` defaults (lines ~121, ~201).

- [ ] **Step 2: Replace with batched HubSpot reads**

```typescript
import { readShitShowFlag, SHIT_SHOW_PROPS } from "@/lib/shit-show-meeting";
import { getDealProperties } from "@/lib/hubspot";

// At the top of the function that builds the preview list, after we have the dealIds:
const flagsByDeal = new Map<string, { flagged: boolean; reason: string | null }>();
await Promise.all(
  dealIds.map(async (dealId) => {
    try {
      const flag = await readShitShowFlag(dealId);
      flagsByDeal.set(dealId, { flagged: flag.flagged, reason: flag.reason });
    } catch {
      flagsByDeal.set(dealId, { flagged: false, reason: null });
    }
  }),
);

// Then where the defaults are:
shitShowFlagged: flagsByDeal.get(dealId)?.flagged ?? false,
shitShowReason: flagsByDeal.get(dealId)?.reason ?? null,
```

- [ ] **Step 3: Smoke test manually**

`npm run dev` + visit `/dashboards/idr-meeting`. Verify the preview loads and the existing 🔥 toggle still works.

(There are no existing automated tests for the preview route; we'll add a lightweight one in Chunk 2 when we test the new namespace.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/idr-meeting/preview/route.ts
git commit -m "feat(idr): preview reads shit-show flag from HubSpot"
```

### Task 1.6: IDR rewire — `StatusActionsForm.tsx` tooltip

**Files:**
- Modify: `src/app/dashboards/idr-meeting/StatusActionsForm.tsx` — add a tooltip on the 🔥 toggle.

- [ ] **Step 1: Add the tooltip**

Find the `🔥 Add to Shit Show Meeting` label (line ~104). Add a `title=` attribute or use the codebase's tooltip primitive (check what neighboring forms use). Minimal version:

```tsx
<label
  className="..."
  title="This flags the deal globally — clear it from the Shit Show meeting's Resolved action."
>
  🔥 Add to Shit Show Meeting
</label>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/idr-meeting/StatusActionsForm.tsx
git commit -m "feat(idr): tooltip clarifies shit-show flag is global"
```

### Task 1.7: STOP — HUMAN actions before continuing

- [ ] **Step 1: Confirm HubSpot properties are created**

Ask the user to verify they've created in HubSpot:
- `pb_shit_show_flagged` (Single checkbox)
- `pb_shit_show_reason` (Multi-line text)
- `pb_shit_show_flagged_since` (Date)

- [ ] **Step 2: Run the backfill (HUMAN executes)**

```bash
npx tsx scripts/backfill-shit-show-flags.ts
```

Verify in DB:
```sql
SELECT * FROM "ShitShowBackfillRun" ORDER BY "startedAt" DESC LIMIT 1;
```
`status` should be `COMPLETED`, `errors` should be 0.

Spot-check 2-3 deals in HubSpot UI: `pb_shit_show_flagged = true` matches the IDR `shitShowFlagged = true` records.

---

## Chunk 2: API Layer

All `/api/shit-show-meeting/*` routes plus the cron route. End state: every endpoint enumerated in §5 of the spec exists, has tests, and can be hit from a browser session.

### Task 2.1: Decision side-effect logic — `applyDecision`

**Files:**
- Modify: `src/lib/shit-show-meeting.ts` — add `applyDecision()` and supporting types.
- Test: `src/__tests__/shit-show-decision.test.ts`

- [ ] **Step 1: Write the failing test**

Cover: each of the 5 decisions writes the right DB updates and invokes (or doesn't invoke) the right external writes. Use mocks for prisma + setShitShowFlag + escalation/task helpers.

```typescript
import { applyDecision } from "@/lib/shit-show-meeting";

jest.mock("@/lib/db", () => ({
  prisma: {
    $transaction: jest.fn((cb) => cb({
      shitShowSessionItem: { update: jest.fn().mockResolvedValue({}) },
      idrEscalationQueue: { create: jest.fn().mockResolvedValue({ id: "esc-1" }) },
    })),
    shitShowSessionItem: { update: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock("@/lib/shit-show-meeting", () => {
  const actual = jest.requireActual("@/lib/shit-show-meeting");
  return {
    ...actual,
    setShitShowFlag: jest.fn(),
    scheduleHubspotEscalationTask: jest.fn(),
  };
});

import { setShitShowFlag, scheduleHubspotEscalationTask } from "@/lib/shit-show-meeting";

describe("applyDecision", () => {
  beforeEach(() => jest.clearAllMocks());

  it("RESOLVED clears the HubSpot flag", async () => {
    await applyDecision({
      itemId: "item-1",
      dealId: "d1",
      decision: "RESOLVED",
      decisionRationale: null,
      userEmail: "u@x.com",
      dealName: "Test",
      region: "Westy",
    });
    expect(setShitShowFlag).toHaveBeenCalledWith("d1", false);
    expect(scheduleHubspotEscalationTask).not.toHaveBeenCalled();
  });

  it("STILL_PROBLEM does NOT clear the flag", async () => {
    await applyDecision({
      itemId: "item-1",
      dealId: "d1",
      decision: "STILL_PROBLEM",
      decisionRationale: "still broken",
      userEmail: "u@x.com",
      dealName: "Test",
      region: "Westy",
    });
    expect(setShitShowFlag).not.toHaveBeenCalled();
  });

  it("ESCALATED creates IdrEscalationQueue row + schedules HubSpot task; flag stays", async () => {
    await applyDecision({
      itemId: "item-1",
      dealId: "d1",
      decision: "ESCALATED",
      decisionRationale: "owner pls help",
      userEmail: "u@x.com",
      dealName: "Test",
      region: "Westy",
    });
    expect(setShitShowFlag).not.toHaveBeenCalled();
    expect(scheduleHubspotEscalationTask).toHaveBeenCalledWith(expect.objectContaining({
      sessionItemId: "item-1",
      dealId: "d1",
      reason: "owner pls help",
    }));
  });

  it("DEFERRED does NOT clear the flag and does not escalate", async () => {
    await applyDecision({
      itemId: "item-1",
      dealId: "d1",
      decision: "DEFERRED",
      decisionRationale: "not today",
      userEmail: "u@x.com",
      dealName: "Test",
      region: "Westy",
    });
    expect(setShitShowFlag).not.toHaveBeenCalled();
    expect(scheduleHubspotEscalationTask).not.toHaveBeenCalled();
  });

  it("rejects when STILL_PROBLEM/ESCALATED/DEFERRED has no rationale", async () => {
    await expect(applyDecision({
      itemId: "item-1",
      dealId: "d1",
      decision: "STILL_PROBLEM",
      decisionRationale: null,
      userEmail: "u@x.com",
      dealName: "Test",
      region: "Westy",
    })).rejects.toThrow(/rationale required/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/shit-show-decision.test.ts -v`
Expected: FAIL — `applyDecision` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/shit-show-meeting.ts`:

```typescript
import { prisma } from "@/lib/db";

export type ShitShowDecisionValue = "RESOLVED" | "STILL_PROBLEM" | "ESCALATED" | "DEFERRED";

export type ApplyDecisionInput = {
  itemId: string;
  dealId: string;
  decision: ShitShowDecisionValue;
  decisionRationale: string | null;
  userEmail: string;
  dealName: string;
  region: string;
};

const RATIONALE_REQUIRED: ReadonlySet<ShitShowDecisionValue> = new Set([
  "STILL_PROBLEM", "ESCALATED", "DEFERRED",
]);

export async function applyDecision(input: ApplyDecisionInput): Promise<void> {
  if (RATIONALE_REQUIRED.has(input.decision) && !input.decisionRationale?.trim()) {
    throw new Error("decisionRationale required for this decision");
  }

  const now = new Date();

  if (input.decision === "ESCALATED") {
    // Atomic: update item + create IdrEscalationQueue row in one transaction.
    let escalationRowId: string | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.shitShowSessionItem.update({
        where: { id: input.itemId },
        data: {
          decision: "ESCALATED",
          decisionRationale: input.decisionRationale,
          resolvedAt: now,
          resolvedBy: input.userEmail,
        },
      });
      const row = await tx.idrEscalationQueue.create({
        data: {
          dealId: input.dealId,
          dealName: input.dealName,
          region: input.region,
          queueType: "ESCALATION",
          reason: input.decisionRationale!,
          requestedBy: input.userEmail,
        },
      });
      escalationRowId = row.id;
    });

    if (escalationRowId) {
      await prisma.shitShowSessionItem.update({
        where: { id: input.itemId },
        data: { idrEscalationQueueId: escalationRowId },
      });
    }

    // Best-effort HubSpot task (separate from transaction).
    try {
      await scheduleHubspotEscalationTask({
        sessionItemId: input.itemId,
        dealId: input.dealId,
        reason: input.decisionRationale!,
      });
    } catch (e) {
      console.error("[shit-show] escalation task scheduling failed", e);
    }
    return;
  }

  // Non-escalation decisions: simple update + maybe clear flag.
  await prisma.shitShowSessionItem.update({
    where: { id: input.itemId },
    data: {
      decision: input.decision,
      decisionRationale: input.decisionRationale,
      resolvedAt: now,
      resolvedBy: input.userEmail,
    },
  });

  if (input.decision === "RESOLVED") {
    await setShitShowFlag(input.dealId, false);
  }
}

// Stub — real implementation in Task 2.2
export async function scheduleHubspotEscalationTask(params: {
  sessionItemId: string;
  dealId: string;
  reason: string;
}): Promise<void> {
  // TODO: implement in Task 2.2
  void params;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/shit-show-decision.test.ts -v`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shit-show-meeting.ts src/__tests__/shit-show-decision.test.ts
git commit -m "feat(shit-show): applyDecision orchestrator with transaction + escalation"
```

### Task 2.2: HubSpot task creation + close-back

**Files:**
- Modify: `src/lib/shit-show-meeting.ts` — implement `createHubspotTaskForAssignment` and `scheduleHubspotEscalationTask`. Reuse the pattern from `src/lib/admin-workflows/actions/create-hubspot-task.ts:59`.
- Test: extend `src/__tests__/shit-show-decision.test.ts` or new file `src/__tests__/shit-show-task.test.ts`.

- [ ] **Step 1: Read the existing task-create pattern**

Read `src/lib/admin-workflows/actions/create-hubspot-task.ts` lines 1-100. Note the request body shape and association format.

- [ ] **Step 2: Write the failing test**

```typescript
// src/__tests__/shit-show-task.test.ts
import { createHubspotTaskForAssignment } from "@/lib/shit-show-meeting";

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
});

it("creates a HubSpot task associated with the deal", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "task-789" }),
  });
  const taskId = await createHubspotTaskForAssignment({
    dealId: "deal-1",
    assigneeHubspotOwnerId: "owner-42",
    subject: "Shit Show follow-up",
    body: "Talk to customer",
    dueDate: new Date("2026-05-01"),
  });
  expect(taskId).toBe("task-789");
  const callArgs = mockFetch.mock.calls[0];
  expect(callArgs[0]).toBe("https://api.hubapi.com/crm/v3/objects/tasks");
  const requestBody = JSON.parse(callArgs[1].body as string);
  expect(requestBody.properties.hs_task_subject).toBe("Shit Show follow-up");
  expect(requestBody.properties.hubspot_owner_id).toBe("owner-42");
});

it("returns null when HubSpot returns 4xx; doesn't throw", async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 400, text: async () => "bad" });
  const taskId = await createHubspotTaskForAssignment({
    dealId: "deal-1",
    assigneeHubspotOwnerId: "owner-42",
    subject: "X",
    body: "Y",
    dueDate: null,
  });
  expect(taskId).toBeNull();
});
```

- [ ] **Step 3: Implement**

Append to `src/lib/shit-show-meeting.ts`:

```typescript
export async function createHubspotTaskForAssignment(params: {
  dealId: string;
  assigneeHubspotOwnerId: string | null;
  subject: string;
  body: string;
  dueDate: Date | null;
}): Promise<string | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN missing");

  const requestBody = {
    properties: {
      hs_task_subject: params.subject,
      hs_task_body: params.body,
      hs_task_status: "NOT_STARTED",
      hs_task_priority: "HIGH",
      hs_task_type: "TODO",
      ...(params.assigneeHubspotOwnerId
        ? { hubspot_owner_id: params.assigneeHubspotOwnerId }
        : {}),
      ...(params.dueDate
        ? { hs_timestamp: params.dueDate.getTime().toString() }
        : { hs_timestamp: Date.now().toString() }),
    },
    associations: [{
      to: { id: params.dealId },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }], // task→deal
    }],
  };

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    console.error("[shit-show] HubSpot task create failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.id ?? null;
}

// Replace the stub from Task 2.1
export async function scheduleHubspotEscalationTask(params: {
  sessionItemId: string;
  dealId: string;
  reason: string;
}): Promise<void> {
  // Look up deal owner — try the existing helper from src/lib/hubspot.ts
  const { getDealOwnerContact } = await import("@/lib/hubspot");
  const owner = await getDealOwnerContact(params.dealId);

  const taskId = await createHubspotTaskForAssignment({
    dealId: params.dealId,
    assigneeHubspotOwnerId: owner?.hubspotOwnerId ?? null,
    subject: `🔥 Shit Show Escalation: ${params.dealId}`,
    body: params.reason,
    dueDate: null,
  });

  if (taskId) {
    await prisma.shitShowSessionItem.update({
      where: { id: params.sessionItemId },
      data: { hubspotEscalationTaskId: taskId },
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/shit-show-task.test.ts src/__tests__/shit-show-decision.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shit-show-meeting.ts src/__tests__/shit-show-task.test.ts
git commit -m "feat(shit-show): HubSpot task creation for assignments + escalation"
```

### Task 2.3: Snapshot — pull flagged deals into a session

**Files:**
- Modify: `src/lib/shit-show-meeting.ts` — add `snapshotFlaggedDeals(sessionId)`.
- Test: `src/__tests__/shit-show-snapshot.test.ts`.

- [ ] **Step 1: Write the failing test**

Cover: searches HubSpot for `pb_shit_show_flagged = true`, creates one ShitShowSessionItem per deal with snapshot fields, idempotent on re-run (won't double-create same `(sessionId, dealId)`).

```typescript
// src/__tests__/shit-show-snapshot.test.ts (skeleton — fill in body)
import { snapshotFlaggedDeals } from "@/lib/shit-show-meeting";
// ... mock prisma + searchWithRetry from @/lib/hubspot ...

it("creates one ShitShowSessionItem per flagged deal", async () => {
  // mock HubSpot search returns [deal-1, deal-2]
  // mock prisma.shitShowSessionItem.upsert
  await snapshotFlaggedDeals("session-1");
  // assert upsert called twice with snapshotted fields
});

it("is idempotent — re-running doesn't double-create", async () => {
  // second invocation should rely on the @@unique([sessionId, dealId])
});
```

- [ ] **Step 2-4: Implement, verify, commit**

Implementation sketch (append to `src/lib/shit-show-meeting.ts`):

```typescript
export async function snapshotFlaggedDeals(sessionId: string): Promise<{
  created: number;
  skipped: number;
}> {
  const { hubspotClient } = await import("@/lib/hubspot");
  const { FilterOperatorEnum } = await import(
    "@hubspot/api-client/lib/codegen/crm/deals"
  );

  const properties = [
    "dealname", "amount", "system_size_kw", "dealstage", "hubspot_owner_id",
    SHIT_SHOW_PROPS.REASON, SHIT_SHOW_PROPS.FLAGGED_SINCE,
    "address", "project_type", "equipment_summary", "pb_location",
    "survey_status", "survey_date", "design_status", "layout_status",
    "planset_date", "ahj", "utility_company",
    "hubspot_owner_id", "project_manager", "operations_manager", "site_surveyor",
    "drive_folder_url", "survey_folder_url", "design_folder_url",
    "sales_documents", "open_solar_url",
  ];

  const results = await hubspotClient.crm.deals.searchApi.doSearch({
    filterGroups: [{
      filters: [{
        propertyName: SHIT_SHOW_PROPS.FLAGGED,
        operator: FilterOperatorEnum.Eq,
        value: "true",
      }],
    }],
    properties,
    limit: 100,
  });

  let created = 0, skipped = 0;
  for (const deal of results.results) {
    const p = deal.properties;
    try {
      await prisma.shitShowSessionItem.create({
        data: {
          sessionId,
          dealId: deal.id,
          region: p.pb_location ?? "Unknown",
          dealName: p.dealname ?? "(no name)",
          dealAmount: p.amount ? Number(p.amount) : null,
          systemSizeKw: p.system_size_kw ? Number(p.system_size_kw) : null,
          stage: p.dealstage ?? null,
          dealOwner: p.hubspot_owner_id ?? null,
          reasonSnapshot: p[SHIT_SHOW_PROPS.REASON] ?? null,
          flaggedSince: p[SHIT_SHOW_PROPS.FLAGGED_SINCE]
            ? new Date(p[SHIT_SHOW_PROPS.FLAGGED_SINCE])
            : null,
          address: p.address ?? null,
          projectType: p.project_type ?? null,
          equipmentSummary: p.equipment_summary ?? null,
          surveyStatus: p.survey_status ?? null,
          surveyDate: p.survey_date ?? null,
          designStatus: p.design_status ?? null,
          designApprovalStatus: p.layout_status ?? null,
          plansetDate: p.planset_date ?? null,
          ahj: p.ahj ?? null,
          utilityCompany: p.utility_company ?? null,
          projectManager: p.project_manager ?? null,
          operationsManager: p.operations_manager ?? null,
          siteSurveyor: p.site_surveyor ?? null,
          driveFolderUrl: p.drive_folder_url ?? null,
          surveyFolderUrl: p.survey_folder_url ?? null,
          designFolderUrl: p.design_folder_url ?? null,
          salesFolderUrl: p.sales_documents ?? null,
          openSolarUrl: p.open_solar_url ?? null,
          addedBy: "SYSTEM",
        },
      });
      created += 1;
    } catch (e) {
      // P2002 unique constraint = already snapshotted; treat as skipped not error
      if (e instanceof Error && e.message.includes("P2002")) {
        skipped += 1;
      } else throw e;
    }
  }
  return { created, skipped };
}
```

Test, then commit:
```bash
git commit -m "feat(shit-show): snapshot flagged deals into a session"
```

### Task 2.4: End-of-session HubSpot note posting

**Files:**
- Modify: `src/lib/shit-show-meeting.ts` — add `postEndOfSessionNote(itemId)` and `endSession(sessionId)`.
- Test: `src/__tests__/shit-show-end-session.test.ts`.

- [ ] **Step 1: Write failing test**

Cover: posts one note per item, format is correct, idempotent (`hubspotNoteId` set means skip), failures recorded as `noteSyncStatus = FAILED`.

- [ ] **Step 2: Implement**

```typescript
export async function postEndOfSessionNote(itemId: string): Promise<{
  noteId: string | null;
  status: "SYNCED" | "FAILED" | "SKIPPED";
}> {
  const item = await prisma.shitShowSessionItem.findUnique({
    where: { id: itemId },
    include: { assignments: true, session: true },
  });
  if (!item) return { noteId: null, status: "FAILED" };
  if (item.hubspotNoteId) return { noteId: item.hubspotNoteId, status: "SKIPPED" };

  const decisionLabel = formatDecision(item.decision);
  const assignments = item.assignments
    .map((a) => {
      const due = a.dueDate ? ` (due ${a.dueDate.toISOString().slice(0, 10)})` : "";
      return `- ${a.assigneeUserId}: ${a.actionText}${due}`;
    })
    .join("\n") || "(none)";
  const body = [
    `🔥 Shit Show Meeting — ${item.session.date.toISOString().slice(0, 10)}`,
    "",
    `Decision: ${decisionLabel}`,
    `Decision rationale: ${item.decisionRationale ?? "(none)"}`,
    `Reason at time of meeting: ${item.reasonSnapshot ?? "(none)"}`,
    "",
    "Notes from discussion:",
    item.meetingNotes ?? "(none)",
    "",
    "Follow-ups assigned:",
    assignments,
  ].join("\n");

  try {
    const noteId = await postHubspotNote(item.dealId, body);
    await prisma.shitShowSessionItem.update({
      where: { id: itemId },
      data: { hubspotNoteId: noteId, noteSyncStatus: "SYNCED" },
    });
    return { noteId, status: "SYNCED" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.shitShowSessionItem.update({
      where: { id: itemId },
      data: { noteSyncStatus: "FAILED", noteSyncError: msg },
    });
    return { noteId: null, status: "FAILED" };
  }
}

function formatDecision(d: string): string {
  return ({
    PENDING: "Pending",
    RESOLVED: "Resolved",
    STILL_PROBLEM: "Still a problem",
    ESCALATED: "Escalated",
    DEFERRED: "Deferred",
  } as Record<string, string>)[d] ?? d;
}

async function postHubspotNote(dealId: string, body: string): Promise<string> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN!;
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: { hs_note_body: body, hs_timestamp: Date.now().toString() },
      associations: [{
        to: { id: dealId },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }], // note→deal
      }],
    }),
  });
  if (!res.ok) throw new Error(`HubSpot note create failed: ${res.status}`);
  const data = await res.json();
  return data.id;
}

export async function endSession(sessionId: string): Promise<{
  posted: number; failed: number; skipped: number;
}> {
  const items = await prisma.shitShowSessionItem.findMany({ where: { sessionId } });
  let posted = 0, failed = 0, skipped = 0;
  for (const item of items) {
    const result = await postEndOfSessionNote(item.id);
    if (result.status === "SYNCED") posted += 1;
    else if (result.status === "FAILED") failed += 1;
    else skipped += 1;
  }
  await prisma.shitShowSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED" },
  });
  return { posted, failed, skipped };
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx jest src/__tests__/shit-show-end-session.test.ts -v
git add src/lib/shit-show-meeting.ts src/__tests__/shit-show-end-session.test.ts
git commit -m "feat(shit-show): end-session HubSpot note posting (idempotent)"
```

### Task 2.5: Sessions API routes

**Files:**
- Create: `src/app/api/shit-show-meeting/sessions/route.ts`
- Create: `src/app/api/shit-show-meeting/sessions/[id]/route.ts`
- Create: `src/app/api/shit-show-meeting/sessions/[id]/snapshot/route.ts`
- Create: `src/app/api/shit-show-meeting/sessions/[id]/end/route.ts`

- [ ] **Step 1: List + create**

`sessions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sessions = await prisma.shitShowSession.findMany({
    orderBy: { date: "desc" },
    take: 50,
  });
  return NextResponse.json({ sessions });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only one ACTIVE session at a time
  const existing = await prisma.shitShowSession.findFirst({
    where: { status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "active_session_exists", sessionId: existing.id },
      { status: 409 },
    );
  }

  const session = await prisma.shitShowSession.create({
    data: { date: new Date(), createdBy: user.email, status: "DRAFT" },
  });
  return NextResponse.json({ session });
}
```

- [ ] **Step 2: Detail + start (PATCH) + delete**

`sessions/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const session = await prisma.shitShowSession.findUnique({
    where: { id },
    include: { items: { include: { assignments: true } } },
  });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: { status?: "DRAFT" | "ACTIVE" | "COMPLETED" } = {};
  if (body.status === "ACTIVE" || body.status === "DRAFT" || body.status === "COMPLETED") {
    data.status = body.status;
  }
  const session = await prisma.shitShowSession.update({ where: { id }, data });
  return NextResponse.json({ session });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.shitShowSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Snapshot + end**

```typescript
// sessions/[id]/snapshot/route.ts
import { NextResponse } from "next/server";
import { snapshotFlaggedDeals } from "@/lib/shit-show-meeting";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await prisma.shitShowSession.update({
    where: { id },
    data: { status: "ACTIVE" },
  });
  const result = await snapshotFlaggedDeals(id);
  return NextResponse.json(result);
}
```

```typescript
// sessions/[id]/end/route.ts
import { NextResponse } from "next/server";
import { endSession } from "@/lib/shit-show-meeting";
import { getCurrentUser } from "@/lib/auth-utils";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await endSession(id);
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Smoke test + commit**

`npm run build` should complete without TS errors. Then:

```bash
git add src/app/api/shit-show-meeting/sessions/
git commit -m "feat(shit-show): sessions API routes (list/create/detail/snapshot/end)"
```

### Task 2.6: Items + assignments + flag + proxies + cron

The remaining routes are mostly thin handlers. Group them in one task to avoid plan bloat. Each handler follows the same auth-pattern: `getCurrentUser()` → 401 if null → minimal logic → return JSON.

- [ ] **Step 1: items/[id]/route.ts (PATCH)**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyDecision } from "@/lib/shit-show-meeting";
import { getCurrentUser } from "@/lib/auth-utils";

const ALLOWED = new Set(["meetingNotes"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  // Decision change goes through applyDecision
  if (body.decision) {
    const item = await prisma.shitShowSessionItem.findUnique({
      where: { id }, select: { dealId: true, dealName: true, region: true },
    });
    if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      await applyDecision({
        itemId: id,
        dealId: item.dealId,
        decision: body.decision,
        decisionRationale: body.decisionRationale ?? null,
        userEmail: user.email,
        dealName: item.dealName,
        region: item.region,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "decision_failed" },
        { status: 400 },
      );
    }
  }

  // Plain field updates (just meetingNotes for now)
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED.has(key)) data[key] = body[key];
  }
  if (Object.keys(data).length > 0) {
    await prisma.shitShowSessionItem.update({ where: { id }, data });
  }

  const item = await prisma.shitShowSessionItem.findUnique({
    where: { id }, include: { assignments: true },
  });
  return NextResponse.json({ item });
}
```

- [ ] **Step 2: items/[id]/assignments/route.ts**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createHubspotTaskForAssignment,
} from "@/lib/shit-show-meeting";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const assignments = await prisma.shitShowAssignment.findMany({
    where: { sessionItemId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assignments });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();

  const item = await prisma.shitShowSessionItem.findUnique({
    where: { id }, select: { dealId: true },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const assignment = await prisma.shitShowAssignment.create({
    data: {
      sessionItemId: id,
      assigneeUserId: body.assigneeUserId,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      actionText: body.actionText,
      createdBy: user.email,
    },
  });

  // Best-effort HubSpot task
  try {
    const assignedUser = await prisma.user.findUnique({
      where: { id: body.assigneeUserId },
      select: { email: true, name: true },
    });
    const taskId = await createHubspotTaskForAssignment({
      dealId: item.dealId,
      assigneeHubspotOwnerId: null, // future: lookup HubSpot owner from email
      subject: `Shit Show follow-up: ${assignment.actionText.slice(0, 50)}`,
      body: `${assignment.actionText}\n\nAssigned to: ${assignedUser?.email ?? "unknown"}`,
      dueDate: assignment.dueDate,
    });
    if (taskId) {
      await prisma.shitShowAssignment.update({
        where: { id: assignment.id },
        data: { hubspotTaskId: taskId, taskSyncStatus: "SYNCED" },
      });
    } else {
      await prisma.shitShowAssignment.update({
        where: { id: assignment.id },
        data: { taskSyncStatus: "FAILED", taskSyncError: "task create returned null" },
      });
    }
  } catch (e) {
    await prisma.shitShowAssignment.update({
      where: { id: assignment.id },
      data: { taskSyncStatus: "FAILED", taskSyncError: e instanceof Error ? e.message : String(e) },
    });
  }

  return NextResponse.json({ assignment });
}
```

- [ ] **Step 3: assignments/[id]/route.ts (PATCH for status)**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const data: { status?: "OPEN" | "COMPLETED" | "CANCELLED" } = {};
  if (["OPEN", "COMPLETED", "CANCELLED"].includes(body.status)) {
    data.status = body.status;
  }
  const assignment = await prisma.shitShowAssignment.update({ where: { id }, data });
  return NextResponse.json({ assignment });
}
```

- [ ] **Step 4: flag/route.ts**

```typescript
import { NextResponse } from "next/server";
import { setShitShowFlag } from "@/lib/shit-show-meeting";
import { getCurrentUser } from "@/lib/auth-utils";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
  await setShitShowFlag(body.dealId, !!body.flagged, body.reason);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: idr-notes/[dealId]/route.ts**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const notes = await prisma.idrMeetingNote.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return NextResponse.json({ notes });
}
```

- [ ] **Step 6: users/route.ts**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, email: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}
```

(Verify `User.active` exists; if the field is named differently, adapt.)

- [ ] **Step 7: deal-search/route.ts**

Mirror `src/app/api/idr-meeting/deal-search/route.ts`. Read that file first, then copy the handler — same shape, just under the new namespace. No new logic.

- [ ] **Step 8: search/route.ts (past sessions)**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const items = await prisma.shitShowSessionItem.findMany({
    where: q
      ? {
          OR: [
            { dealName: { contains: q, mode: "insensitive" } },
            { meetingNotes: { contains: q, mode: "insensitive" } },
            { decisionRationale: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { session: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ items });
}
```

- [ ] **Step 9: presence/route.ts**

Read `src/app/api/idr-meeting/presence/route.ts` and copy its shape into the new namespace, parameterized by session ID. Use the same in-memory store pattern. No structural change.

- [ ] **Step 10: cron/shit-show-task-sync/route.ts**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public-by-middleware (cron paths bypass auth). Polls HubSpot tasks for status changes.
export async function POST() {
  const open = await prisma.shitShowAssignment.findMany({
    where: { status: "OPEN", hubspotTaskId: { not: null } },
    select: { id: true, hubspotTaskId: true },
  });
  let closed = 0;
  for (const a of open) {
    const taskRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/tasks/${a.hubspotTaskId}?properties=hs_task_status`,
      { headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN!}` } },
    );
    if (!taskRes.ok) continue;
    const data = await taskRes.json();
    if (data?.properties?.hs_task_status === "COMPLETED") {
      await prisma.shitShowAssignment.update({
        where: { id: a.id },
        data: { status: "COMPLETED" },
      });
      closed += 1;
    }
  }
  return NextResponse.json({ checked: open.length, closed });
}
```

(Hook this into the existing cron config — search for how `audit-digest` is wired and follow the same pattern.)

- [ ] **Step 11: Build + commit**

```bash
npm run build
git add src/app/api/shit-show-meeting/ src/app/api/cron/shit-show-task-sync/
git commit -m "feat(shit-show): API routes for sessions/items/assignments/flag/proxies/cron"
```

---

## Chunk 3: UI Layer

End state: `/dashboards/shit-show-meeting` renders a session-based hub with all components from §6 of the spec. Components are intentionally close to their IDR counterparts — read those for layout reference but write fresh files (do not share component implementations).

### Task 3.1: Page wrapper + client shell

**Files:**
- Create: `src/app/dashboards/shit-show-meeting/page.tsx`
- Create: `src/app/dashboards/shit-show-meeting/ShitShowMeetingClient.tsx`

- [ ] **Step 1: Server page**

```tsx
// page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import ShitShowMeetingClient from "./ShitShowMeetingClient";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/signin");
  return <ShitShowMeetingClient userEmail={user.email} />;
}
```

- [ ] **Step 2: Client shell** — `<DashboardShell accentColor="red">` wrapping `<SessionHeader>`, `<ProjectQueue>` left rail and `<ProjectDetail>` right pane. Reference `IdrMeetingClient.tsx` for the exact pattern; do not share implementation.

The shell holds: current session ID (from URL or "new" button), selected item ID (URL state), React Query for sessions/items, SSE for presence + queue refresh.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/shit-show-meeting/page.tsx \
        src/app/dashboards/shit-show-meeting/ShitShowMeetingClient.tsx
git commit -m "feat(shit-show): page + client shell"
```

### Task 3.2: SessionHeader + ProjectQueue + AddProjectDialog

- [ ] **Step 1: SessionHeader.tsx**

Shows session date, status pill (DRAFT/ACTIVE/COMPLETED), presence chips (read SSE), Start/End buttons (POSTs to snapshot or end endpoint). Reference IDR's `SessionHeader.tsx`.

- [ ] **Step 2: ProjectQueue.tsx**

Reads items from session detail. Groups by `region`. Within each group, sorts by `flaggedSince` ascending (nulls last). Each row: deal name, $, decision pill, "🔥 Nth time" badge from a count of prior `ShitShowSessionItem`s for the same dealId.

- [ ] **Step 3: AddProjectDialog.tsx**

Search HubSpot deals (debounced, calls `/api/shit-show-meeting/deal-search`), pick a deal, type a reason (required), submit → POSTs to `/api/shit-show-meeting/flag` with `flagged=true` then re-snapshots the current session. Closes dialog.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(shit-show): SessionHeader + ProjectQueue + AddProjectDialog"
```

### Task 3.3: ProjectDetail + sub-panels

- [ ] **Step 1: ReasonPanel.tsx, ProjectInfoPanel.tsx, HistoryStrip.tsx, IdrNotesContext.tsx**

Each is a read-only display. Source data comes from the parent's selected item. ProjectInfoPanel is the curated grid from §6 of the spec. IdrNotesContext fetches from `/api/shit-show-meeting/idr-notes/[dealId]`.

- [ ] **Step 2: MeetingNotesForm.tsx**

Autosaving textarea (debounce 500ms, PATCHes `/api/shit-show-meeting/items/[id]` with `meetingNotes`). Saving indicator.

- [ ] **Step 3: AssignmentsPanel.tsx**

Lists assignments for the selected item. "+ Add" form: assignee picker (calls `/api/shit-show-meeting/users`), due date picker, action text. Submits to `/api/shit-show-meeting/items/[id]/assignments`.

- [ ] **Step 4: DecisionActions.tsx**

Four buttons (Resolved / Still problem / Escalate / Defer). Click opens an inline rationale form. Submit → PATCH `/api/shit-show-meeting/items/[id]` with `{decision, decisionRationale}`. Buttons disabled until rationale validates.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(shit-show): ProjectDetail panels (reason, info, history, idr-notes, notes, assignments, decisions)"
```

### Task 3.4: MeetingSearch.tsx (past sessions)

- [ ] **Step 1: Implement**

Search bar at top of left rail (or in header). Debounced query → `/api/shit-show-meeting/search?q=...`. Results dropdown shows item snapshots with deal name, decision, date.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(shit-show): past-sessions search"
```

---

## Chunk 4: Wire-Up & Verification

End state: navigation works, all 15 explicit roles have allowlist entries, cron schedule exists, manual QA passes for every role.

### Task 4.1: Suite navigation + roles allowlist

**Files:**
- Modify: `src/lib/suite-nav.ts` — add the Executive suite card.
- Modify: `src/lib/roles.ts` — add `/dashboards/shit-show-meeting` and `/api/shit-show-meeting` to the 15 explicit non-wildcard roles' `allowedRoutes`.

- [ ] **Step 1: suite-nav.ts**

In the Executive suite section, add:

```ts
{
  href: "/dashboards/shit-show-meeting",
  title: "Shit Show Meeting",
  description: "Owner-led review of problem projects with decisions and follow-ups.",
  tag: "OPS",
  icon: "🔥",
  section: "Command & Planning",
},
```

- [ ] **Step 2: roles.ts**

For each role definition in {ACCOUNTING, DESIGN, INTELLIGENCE, INTERCONNECT, MARKETING, OPERATIONS, OPERATIONS_MANAGER, PERMIT, PROJECT_MANAGER, ROOFING, SALES, SALES_MANAGER, SERVICE, TECH_OPS, VIEWER}, add to `allowedRoutes`:

```ts
"/dashboards/shit-show-meeting",
"/api/shit-show-meeting",
```

ADMIN and EXECUTIVE already have `["*"]` — skip them.

- [ ] **Step 3: Commit**

```bash
git add src/lib/suite-nav.ts src/lib/roles.ts
git commit -m "feat(shit-show): suite nav card + role allowlist for 15 non-wildcard roles"
```

### Task 4.2: Cron schedule registration

- [ ] **Step 1: Find existing cron config**

Read `vercel.json` (or whatever the project uses for scheduled functions — likely Vercel cron). Look for entries like `audit-digest`.

- [ ] **Step 2: Add the new cron entry**

Append to the cron config:

```json
{
  "path": "/api/cron/shit-show-task-sync",
  "schedule": "*/15 * * * *"
}
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(shit-show): register 15-min cron for HubSpot task close-back"
```

### Task 4.3: Per-role QA verification

- [ ] **Step 1: Boot dev server**

```bash
npm run dev
```

- [ ] **Step 2: Manually verify each of the 15 roles**

For each role in {ACCOUNTING, DESIGN, INTELLIGENCE, INTERCONNECT, MARKETING, OPERATIONS, OPERATIONS_MANAGER, PERMIT, PROJECT_MANAGER, ROOFING, SALES, SALES_MANAGER, SERVICE, TECH_OPS, VIEWER}:

1. Set the impersonation cookie (`pb_effective_roles`) to that role.
2. Navigate to `/dashboards/shit-show-meeting`.
3. Verify (a) page loads, (b) when a session exists, queue populates, (c) clicking an item populates the right pane, (d) DevTools Network tab shows zero 403s on any `/api/*` request.

Track in a checklist:

| Role | Page loads | Queue populates | Detail loads | Zero 403s |
|---|---|---|---|---|
| ACCOUNTING | ☐ | ☐ | ☐ | ☐ |
| DESIGN | ☐ | ☐ | ☐ | ☐ |
| INTELLIGENCE | ☐ | ☐ | ☐ | ☐ |
| ... | | | | |

- [ ] **Step 3: Fix any 403**

If a 403 appears, that endpoint's prefix is missing from that role's allowlist. Fix in `src/lib/roles.ts` and re-verify.

- [ ] **Step 4: Commit any allowlist fixes**

```bash
git commit -m "fix(shit-show): allowlist gaps surfaced during per-role QA"
```

### Task 4.4: Final build + smoke test + open PR

- [ ] **Step 1: Lint + typecheck + tests**

```bash
npm run lint
npm run build
npm test
```

All three should pass cleanly.

- [ ] **Step 2: Open PR**

Use the commit-commands:commit-push-pr skill or manually:

```bash
git push -u origin claude/jovial-golick-d2d1e4
gh pr create --title "feat: Shit Show Meeting Hub" --body "$(cat <<'EOF'
## Summary
- New session-based meeting hub at `/dashboards/shit-show-meeting`
- Moves shit-show flag from per-session DB column to deal-level HubSpot property
- Mirrors IDR meeting pattern (sessions, presence, queue, decisions, end-of-session HubSpot notes)

## Spec
docs/superpowers/specs/2026-04-27-shit-show-meeting-design.md

## HUMAN ACTIONS REQUIRED
1. Create HubSpot deal properties: `pb_shit_show_flagged` (bool), `pb_shit_show_reason` (multi-line text), `pb_shit_show_flagged_since` (date)
2. Run `npx prisma migrate deploy` after merge
3. Run `npx tsx scripts/backfill-shit-show-flags.ts`
4. After 1-week bake, run drop migration for IdrMeetingItem.shitShowFlagged + shitShowReason

## Test plan
- [ ] All 15 explicit roles can load the page with zero 403s (per-role table in PR)
- [ ] IDR's existing 🔥 toggle still works end-to-end
- [ ] Session create → snapshot → discuss → decide → end → HubSpot note appears on each deal

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done

End state: feature is shipped behind the role allowlist; backfill has run; IDR's 🔥 toggle writes to HubSpot; the Shit Show hub at `/dashboards/shit-show-meeting` is live for ADMIN/EXECUTIVE and the 15 non-wildcard roles. Drop migration scheduled for one week post-merge.

---

## Plan Addendum (post-review fixes)

After running plan-document-reviewer on all chunks, the following adjustments apply. **These supersede the corresponding earlier sections.**

### A1. File layout — directory, not flat file

Replace every reference to `src/lib/shit-show-meeting.ts` with the appropriate module file in `src/lib/shit-show/`:

| Module file | Exports |
|---|---|
| `src/lib/shit-show/hubspot-flag.ts` | `SHIT_SHOW_PROPS`, `readShitShowFlag`, `setShitShowFlag`, type `ShitShowFlagState` |
| `src/lib/shit-show/hubspot-task.ts` | `createHubspotTaskForAssignment`, `scheduleHubspotEscalationTask` |
| `src/lib/shit-show/hubspot-note.ts` | `postEndOfSessionNote`, `endSession` |
| `src/lib/shit-show/snapshot.ts` | `snapshotFlaggedDeals`, `readShitShowFlagsBatch` |
| `src/lib/shit-show/decision.ts` | `applyDecision`, type `ShitShowDecisionValue`, type `ApplyDecisionInput` |

Imports in tests use the per-module path (e.g., `jest.mock("@/lib/shit-show/hubspot-flag")`) so the mock-the-module-under-test problem from Chunk 2 review goes away.

### A2. Task 1.5 — use HubSpot batch read for the IDR preview hydration

Replace the per-deal `Promise.all(... readShitShowFlag(dealId))` pattern with a single batch call:

```ts
// In src/lib/shit-show/snapshot.ts (new helper):
import { hubspotClient } from "@/lib/hubspot";
import { SHIT_SHOW_PROPS } from "@/lib/shit-show/hubspot-flag";

export async function readShitShowFlagsBatch(
  dealIds: string[],
): Promise<Map<string, { flagged: boolean; reason: string | null }>> {
  if (dealIds.length === 0) return new Map();
  const result = new Map<string, { flagged: boolean; reason: string | null }>();
  // batchApi.read takes up to 100 IDs per call
  for (let i = 0; i < dealIds.length; i += 100) {
    const slice = dealIds.slice(i, i + 100);
    const res = await hubspotClient.crm.deals.batchApi.read({
      properties: [SHIT_SHOW_PROPS.FLAGGED, SHIT_SHOW_PROPS.REASON],
      propertiesWithHistory: [],
      inputs: slice.map((id) => ({ id })),
    });
    for (const deal of res.results) {
      result.set(deal.id, {
        flagged: deal.properties?.[SHIT_SHOW_PROPS.FLAGGED] === "true",
        reason: (deal.properties?.[SHIT_SHOW_PROPS.REASON] as string) || null,
      });
    }
  }
  return result;
}
```

Use it in `preview/route.ts`:

```ts
import { readShitShowFlagsBatch } from "@/lib/shit-show/snapshot";

// At the top of the preview build, after dealIds are known:
const flagsByDeal = await readShitShowFlagsBatch(dealIds);
// ...then
shitShowFlagged: flagsByDeal.get(dealId)?.flagged ?? false,
shitShowReason:  flagsByDeal.get(dealId)?.reason  ?? null,
```

One HTTP request per 100 deals instead of N per page.

### A3. Task 1.4 — keep IDR whitelist; document why

Do NOT remove `shitShowFlagged`/`shitShowReason` from the editable-fields whitelist at line 13 of `src/app/api/idr-meeting/items/[id]/route.ts`. They stay in place during the bake period because the existing IDR queue render path still reads from the local column. Add a code comment above the whitelist:

```ts
// NOTE: shitShowFlagged + shitShowReason stay in the whitelist during the
// shit-show migration bake period (see docs/superpowers/specs/2026-04-27-shit-show-meeting-design.md).
// They are dual-written: this PATCH writes to both the local column AND the HubSpot
// deal property via setShitShowFlag(). After the 1-week bake, the drop migration
// removes the columns and these whitelist entries.
```

### A4. Task 1.6 — commit to `title=` attribute

The IDR codebase uses native `title=` attributes on label elements for hint text (no shared tooltip primitive). Use:

```tsx
<label
  htmlFor={`shit-show-${item.id}`}
  className="..."
  title="This flags the deal globally — clear it from the Shit Show meeting's Resolved action."
>
  🔥 Add to Shit Show Meeting
</label>
```

### A5. Task 1.1 Step 2 — use `npx prisma generate`

Replace `npm run build` with:

```bash
npx prisma generate
```

Expected: "Generated Prisma Client" message; no `next build` noise.

### A6. Task 2.6 Step 6 — User model has no `active` field

The `User` model has no `active` boolean. Filter by users that have any role assigned:

```ts
const users = await prisma.user.findMany({
  where: { roles: { isEmpty: false } },
  select: { id: true, email: true, name: true },
  orderBy: { name: "asc" },
});
```

### A7. Task 2.6 Step 10 — cron uses GET, not POST

`audit-digest` and other crons use `export async function GET`. Change the cron route accordingly:

```ts
export async function GET() { ... }
```

### A8. Task 2.6 — split into 4 sub-tasks

Replace the 11-step Task 2.6 with four atomic tasks, each ending in its own commit:

- **2.6a — Items + assignments routes** (former Steps 1-3): `items/[id]/route.ts`, `items/[id]/assignments/route.ts`, `assignments/[id]/route.ts`. Commit: `feat(shit-show): items/assignments API`.
- **2.6b — Flag + proxies** (former Steps 4-6): `flag/route.ts`, `idr-notes/[dealId]/route.ts`, `users/route.ts`. Commit: `feat(shit-show): flag write + IDR-notes/users proxies`.
- **2.6c — Search + presence + deal-search** (former Steps 7-9): copy-with-rename from existing IDR equivalents. Before copying, paste the actual handler content into the plan (i.e., during execution, read `src/app/api/idr-meeting/deal-search/route.ts`, the IDR `presence/route.ts`, and the IDR `search/route.ts` BEFORE writing the new files). Commit: `feat(shit-show): deal-search + presence + past-session search`.
- **2.6d — Cron task close-back** (former Step 10): `cron/shit-show-task-sync/route.ts` with GET handler. Commit: `feat(shit-show): cron poller for HubSpot task close-back`.

### A9. Task 2.5 — canonical session-start path

Resolve the ambiguity: the `/sessions/[id]/snapshot` POST is the **canonical session-start endpoint**. It both flips status to ACTIVE and runs the snapshot atomically. The `/sessions/[id]` PATCH route accepts `status: "ACTIVE"` only as a no-op for backward compatibility — if the session is already ACTIVE, it's accepted; if it's DRAFT, the PATCH returns 409 with a "use snapshot endpoint to start session" message.

```ts
// In sessions/[id]/route.ts PATCH handler:
if (body.status === "ACTIVE" && currentStatus !== "ACTIVE") {
  return NextResponse.json(
    { error: "use_snapshot_endpoint_to_start", endpoint: `/api/shit-show-meeting/sessions/${id}/snapshot` },
    { status: 409 },
  );
}
```

### A10. Tests for Tasks 2.3 + 2.4 — concrete test bodies

#### Task 2.3 test — `src/__tests__/shit-show-snapshot.test.ts`

```ts
import { snapshotFlaggedDeals } from "@/lib/shit-show/snapshot";

jest.mock("@/lib/db", () => ({
  prisma: {
    shitShowSessionItem: { create: jest.fn() },
  },
}));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: { deals: { searchApi: { doSearch: jest.fn() } } },
  },
}));

import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";

const mockCreate = prisma.shitShowSessionItem.create as jest.Mock;
const mockSearch = hubspotClient.crm.deals.searchApi.doSearch as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it("creates one ShitShowSessionItem per flagged deal", async () => {
  mockSearch.mockResolvedValue({
    results: [
      { id: "d1", properties: { dealname: "Project A", pb_location: "Westy", pb_shit_show_reason: "stuck", amount: "10000" } },
      { id: "d2", properties: { dealname: "Project B", pb_location: "DTC", pb_shit_show_reason: "lost", amount: "20000" } },
    ],
  });
  mockCreate.mockResolvedValue({});

  const result = await snapshotFlaggedDeals("session-1");

  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(result).toEqual({ created: 2, skipped: 0 });
});

it("skips when (sessionId, dealId) unique constraint violated", async () => {
  mockSearch.mockResolvedValue({
    results: [{ id: "d1", properties: { dealname: "X", pb_location: "Westy" } }],
  });
  mockCreate.mockRejectedValue(new Error("Unique constraint failed (P2002)"));

  const result = await snapshotFlaggedDeals("session-1");
  expect(result).toEqual({ created: 0, skipped: 1 });
});
```

#### Task 2.4 test — `src/__tests__/shit-show-end-session.test.ts`

```ts
import { postEndOfSessionNote } from "@/lib/shit-show/hubspot-note";

jest.mock("@/lib/db", () => ({
  prisma: {
    shitShowSessionItem: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;
import { prisma } from "@/lib/db";

const mockFind = prisma.shitShowSessionItem.findUnique as jest.Mock;
const mockUpdate = prisma.shitShowSessionItem.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.HUBSPOT_ACCESS_TOKEN = "tok";
});

it("posts a note and stores hubspotNoteId", async () => {
  mockFind.mockResolvedValue({
    id: "i1", dealId: "d1", session: { date: new Date("2026-04-27") },
    decision: "RESOLVED", decisionRationale: "fixed",
    reasonSnapshot: "was broken", meetingNotes: "talked it through",
    assignments: [], hubspotNoteId: null,
  });
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "note-99" }) });

  const result = await postEndOfSessionNote("i1");
  expect(result.noteId).toBe("note-99");
  expect(result.status).toBe("SYNCED");
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ hubspotNoteId: "note-99", noteSyncStatus: "SYNCED" }),
  }));
});

it("is idempotent — skips when hubspotNoteId already set", async () => {
  mockFind.mockResolvedValue({ id: "i1", hubspotNoteId: "note-99", assignments: [] });
  const result = await postEndOfSessionNote("i1");
  expect(result.status).toBe("SKIPPED");
  expect(mockFetch).not.toHaveBeenCalled();
});

it("records FAILED status on HubSpot error", async () => {
  mockFind.mockResolvedValue({
    id: "i1", dealId: "d1", session: { date: new Date() },
    decision: "RESOLVED", decisionRationale: null, reasonSnapshot: null,
    meetingNotes: null, assignments: [], hubspotNoteId: null,
  });
  mockFetch.mockResolvedValue({ ok: false, status: 500 });
  const result = await postEndOfSessionNote("i1");
  expect(result.status).toBe("FAILED");
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ noteSyncStatus: "FAILED" }),
  }));
});
```

### A11. Chunk 3 — IDR reference paths, color mapping, validation rules, retry button

#### A11a. IDR reference file paths (use these when writing components)

- Top-level shell: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx`
- Session header: `src/app/dashboards/idr-meeting/SessionHeader.tsx`
- Project queue: `src/app/dashboards/idr-meeting/ProjectQueue.tsx`
- Project detail: `src/app/dashboards/idr-meeting/ProjectDetail.tsx`
- Add project dialog: `src/app/dashboards/idr-meeting/AddProjectDialog.tsx`
- Notes form: `src/app/dashboards/idr-meeting/MeetingNotesForm.tsx`
- Status actions: `src/app/dashboards/idr-meeting/StatusActionsForm.tsx`

Read each before writing the parallel Shit Show component. Match prop shape and React Query key conventions.

#### A11b. Decision pill color mapping (Task 3.2 ProjectQueue)

```ts
const DECISION_PILL: Record<ShitShowDecision, { bg: string; text: string; label: string }> = {
  PENDING:       { bg: "bg-zinc-700",   text: "text-zinc-100",   label: "Pending" },
  RESOLVED:      { bg: "bg-emerald-700", text: "text-emerald-50", label: "Resolved" },
  STILL_PROBLEM: { bg: "bg-amber-700",   text: "text-amber-50",   label: "Still problem" },
  ESCALATED:     { bg: "bg-red-700",     text: "text-red-50",     label: "Escalated" },
  DEFERRED:      { bg: "bg-zinc-600",    text: "text-zinc-100",   label: "Deferred" },
};
```

#### A11c. DecisionActions validation rules (Task 3.3 Step 4)

| Decision | Rationale required? | Submit button label |
|---|---|---|
| RESOLVED | optional (placeholder: "What was resolved?") | "Mark Resolved" |
| STILL_PROBLEM | **required** | "Mark Still a Problem" |
| ESCALATED | **required** | "Escalate" |
| DEFERRED | **required** | "Defer" |

Implement the form so clicking a button reveals the inline rationale textarea. The submit button stays disabled until the textarea has non-whitespace content (when required) or always enabled (RESOLVED).

#### A11d. Retry button for FAILED note sync (Task 3.3 — add to ProjectDetail header)

When `item.noteSyncStatus === "FAILED"`, show a small banner above the meeting notes:

```tsx
{item.noteSyncStatus === "FAILED" && (
  <div className="rounded bg-red-900/40 border border-red-700 px-3 py-2 text-sm text-red-100 flex items-center justify-between">
    <span>HubSpot note post failed: {item.noteSyncError}</span>
    <button
      onClick={async () => {
        await fetch(`/api/shit-show-meeting/items/${item.id}/retry-note`, { method: "POST" });
        // refresh
      }}
      className="bg-red-700 hover:bg-red-600 px-2 py-1 rounded text-xs"
    >
      Retry
    </button>
  </div>
)}
```

Add a corresponding API route `src/app/api/shit-show-meeting/items/[id]/retry-note/route.ts` that calls `postEndOfSessionNote(itemId)` again and returns the result. (Add this to Chunk 2's deliverables.)

### A12. Chunk 4 Task 4.1 — concrete role-edit instructions

Before editing, run:

```bash
grep -n "/dashboards/idr-meeting" src/lib/roles.ts
```

This returns ~15 lines, one per non-wildcard role's `allowedRoutes`. For each line, edit the file to add the two new routes immediately after the existing `/api/idr-meeting` line in the same array. Verification command:

```bash
grep -c "/dashboards/shit-show-meeting" src/lib/roles.ts
# Expected: 15
grep -c "/api/shit-show-meeting" src/lib/roles.ts
# Expected: 15
```

If either count != 15, find the missing role(s) and add.

### A13. Chunk 4 Task 4.2 — `vercel.json` confirmed

Confirmed: `vercel.json` is the cron config. Append to its `crons` array:

```json
{
  "path": "/api/cron/shit-show-task-sync",
  "schedule": "*/15 * * * *"
}
```

### A14. Chunk 4 Task 4.3 — full 15-row verification table

| Role | Page loads | Queue populates | Detail loads | Assignee picker shows users | Zero 403s |
|---|---|---|---|---|---|
| ACCOUNTING | ☐ | ☐ | ☐ | ☐ | ☐ |
| DESIGN | ☐ | ☐ | ☐ | ☐ | ☐ |
| INTELLIGENCE | ☐ | ☐ | ☐ | ☐ | ☐ |
| INTERCONNECT | ☐ | ☐ | ☐ | ☐ | ☐ |
| MARKETING | ☐ | ☐ | ☐ | ☐ | ☐ |
| OPERATIONS | ☐ | ☐ | ☐ | ☐ | ☐ |
| OPERATIONS_MANAGER | ☐ | ☐ | ☐ | ☐ | ☐ |
| PERMIT | ☐ | ☐ | ☐ | ☐ | ☐ |
| PROJECT_MANAGER | ☐ | ☐ | ☐ | ☐ | ☐ |
| ROOFING | ☐ | ☐ | ☐ | ☐ | ☐ |
| SALES | ☐ | ☐ | ☐ | ☐ | ☐ |
| SALES_MANAGER | ☐ | ☐ | ☐ | ☐ | ☐ |
| SERVICE | ☐ | ☐ | ☐ | ☐ | ☐ |
| TECH_OPS | ☐ | ☐ | ☐ | ☐ | ☐ |
| VIEWER | ☐ | ☐ | ☐ | ☐ | ☐ |

### A15. Chunk 4 Task 4.4 — pre/post-merge action ordering + paste verification table into PR body

PR body should explicitly separate pre-merge and post-merge actions:

```
## HUMAN ACTIONS REQUIRED — BEFORE MERGE
1. Create HubSpot deal properties:
   - `pb_shit_show_flagged` (Single checkbox)
   - `pb_shit_show_reason` (Multi-line text)
   - `pb_shit_show_flagged_since` (Date)
2. Run additive Prisma migration: `npx prisma migrate deploy`
3. Run backfill: `npx tsx scripts/backfill-shit-show-flags.ts`
   Verify: `SELECT * FROM "ShitShowBackfillRun" ORDER BY "startedAt" DESC LIMIT 1`
   should show status=COMPLETED, errors=0.

## HUMAN ACTIONS REQUIRED — AFTER 1-WEEK BAKE
4. Run drop migration to remove `IdrMeetingItem.shitShowFlagged` + `shitShowReason`.

## NO NEW ENV VARS
Confirmed: no new env vars required. Existing `HUBSPOT_ACCESS_TOKEN` covers the 3 new deal properties.
```

Also paste the completed verification table from Task 4.3 into the PR body as proof.

---

## End of plan
