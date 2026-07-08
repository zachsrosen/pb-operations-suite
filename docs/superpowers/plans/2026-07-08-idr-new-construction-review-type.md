# IDR New Construction Review Type Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull deals with `design_status = "New Construction - Ready for Review"` into IDR meeting sessions as a badged `NEW_CONSTRUCTION` review type whose sync completes the NC HubSpot task and routes revisions to the as-built track.

**Architecture:** Add a `NEW_CONSTRUCTION` value to the `IdrItemType` Prisma enum and a code-defined `REVIEW_TYPES` registry in `src/lib/idr-meeting.ts` that captures what varies per type (note label, task subject, revision type, revision-reason property). Session creation, preview, manual add, sync, and queue UI read the registry / derived type instead of hardcoded `"IDR"`. Zero HubSpot changes — existing enabled workflows (08d "New Construction Design Complete", "IDR Revision Needed") handle the status flips.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (Neon Postgres), HubSpot API v3, Jest.

**Spec:** `docs/superpowers/specs/2026-07-08-idr-new-construction-review-type-design.md` (committed as 9d6ddedc on `fix/portal-hide-install-prompt-and-title`).

**Ground rules for the implementer:**
- NEVER run `prisma migrate deploy`, `prisma db execute`, or `scripts/migrate-prod.sh`. Write the migration file only — Zach applies it to prod manually before merge (additive-before-code convention).
- All tests are pure-function tests following the mock pattern in `src/__tests__/idr-adder-serialization.test.ts` (prisma/hubspot mocked at module level). No DB or network in tests.
- Run `npx tsc --noEmit` project-wide after each task that touches shared types (per repo preference).
- One deliberate deviation from the spec text, pre-approved: the spec says "`ESCALATION` stays outside the registry"; the registry instead includes an `ESCALATION` row that exactly encodes today's escalation behavior (IDR task subject, `escalation` revision type, `inspection_rejection_reason`). Behavior is identical — the row just lets sync resolve every type uniformly instead of keeping ternaries. The spec's intent (no escalation behavior change) is preserved and covered by tests in Task 4.

---

## Chunk 1: Everything (single cohesive feature, ~8 tasks)

### Task 0: Branch setup (worktree)

Feature branches come off `origin/main` (repo convention). The main checkout has a dirty tree with unrelated work, so use a dedicated git worktree; the spec + plan commits live on `fix/portal-hide-install-prompt-and-title` and get cherry-picked over.

- [ ] **Step 0.1: Create worktree branch and bring the spec + plan along**

```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite"
git fetch origin
git worktree add ../PB-Operations-Suite-idr-nc -b feat/idr-new-construction-review origin/main
cd ../PB-Operations-Suite-idr-nc
git cherry-pick 9d6ddedc          # docs(spec): New Construction review type
git cherry-pick <plan-commit-sha> # docs(plan): implementation plan
ln -s "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/node_modules" node_modules
```

Expected: worktree at `../PB-Operations-Suite-idr-nc`, cherry-picks apply cleanly (both only add new files), node_modules symlinked so jest/tsc work. All subsequent tasks run inside the worktree.

### Task 1: Prisma enum + migration file

**Files:**
- Modify: `prisma/schema.prisma` (enum `IdrItemType`, ~line 2754)
- Create: `prisma/migrations/20260708210000_add_new_construction_idr_item_type/migration.sql`

- [ ] **Step 1.1: Add enum value to schema**

```prisma
enum IdrItemType {
  IDR
  ESCALATION
  NEW_CONSTRUCTION
}
```

- [ ] **Step 1.2: Write the migration file (do NOT apply it)**

`prisma/migrations/20260708210000_add_new_construction_idr_item_type/migration.sql`:

```sql
-- Add NEW_CONSTRUCTION to IdrItemType (additive; safe on live data)
ALTER TYPE "IdrItemType" ADD VALUE 'NEW_CONSTRUCTION';
```

- [ ] **Step 1.3: Regenerate the Prisma client (types only, no DB touch)**

```bash
npx prisma generate
```

Expected: exits 0; `src/generated/prisma` now includes `NEW_CONSTRUCTION` in `IdrItemType`.

- [ ] **Step 1.4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260708210000_add_new_construction_idr_item_type/migration.sql
git commit -m "feat(idr): add NEW_CONSTRUCTION to IdrItemType enum"
```

Note: `prisma generate` may touch `src/generated/prisma/**`; those files are committed in this repo — include them if `git status` shows changes: `git add src/generated/prisma`.

### Task 2: Review-type registry + type derivation (TDD)

**Files:**
- Modify: `src/lib/idr-meeting.ts`
- Test: `src/__tests__/idr-review-types.test.ts` (new)

- [ ] **Step 2.1: Write failing tests**

Create `src/__tests__/idr-review-types.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";

// Mock runtime dependencies pulled in transitively by idr-meeting.ts
// (same pattern as idr-adder-serialization.test.ts)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: { crm: { deals: { basicApi: {} }, objects: { notes: { basicApi: {} } } } },
  searchWithRetry: jest.fn(),
  resolveHubSpotOwnerContact: jest.fn(),
}));

import {
  REVIEW_TYPES,
  NC_READY_FOR_REVIEW_STATUS,
  deriveItemTypeFromStatus,
} from "@/lib/idr-meeting";

describe("REVIEW_TYPES registry", () => {
  it("IDR routes revisions to the design branch and idr_revision_reason", () => {
    expect(REVIEW_TYPES.IDR.taskSubject).toBe("Complete Initial Design Review");
    expect(REVIEW_TYPES.IDR.revisionType).toBe("design");
    expect(REVIEW_TYPES.IDR.revisionReasonProperty).toBe("idr_revision_reason");
    expect(REVIEW_TYPES.IDR.noteLabel).toBe("IDR Meeting");
  });

  it("NEW_CONSTRUCTION completes the NC task and routes revisions to the as-built track", () => {
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.taskSubject).toBe("New Construction Design Review");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.revisionType).toBe("escalation");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.revisionReasonProperty).toBe("inspection_rejection_reason");
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.noteLabel).toBe("New Construction Review");
  });

  it("ESCALATION encodes today's behavior exactly (no behavior change)", () => {
    expect(REVIEW_TYPES.ESCALATION.taskSubject).toBe("Complete Initial Design Review");
    expect(REVIEW_TYPES.ESCALATION.revisionType).toBe("escalation");
    expect(REVIEW_TYPES.ESCALATION.revisionReasonProperty).toBe("inspection_rejection_reason");
    expect(REVIEW_TYPES.ESCALATION.noteLabel).toBe("IDR Meeting");
  });
});

describe("deriveItemTypeFromStatus", () => {
  it("derives NEW_CONSTRUCTION for the NC ready-for-review status", () => {
    expect(deriveItemTypeFromStatus(NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
    expect(NC_READY_FOR_REVIEW_STATUS).toBe("New Construction - Ready for Review");
  });

  it("derives IDR for every other status (status wins over filter-group membership)", () => {
    expect(deriveItemTypeFromStatus("Initial Review")).toBe("IDR");
    expect(deriveItemTypeFromStatus("IDR Revision Complete")).toBe("IDR");
    expect(deriveItemTypeFromStatus(null)).toBe("IDR");
    expect(deriveItemTypeFromStatus(undefined)).toBe("IDR");
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

```bash
npx jest src/__tests__/idr-review-types.test.ts
```

Expected: FAIL — `REVIEW_TYPES` / `deriveItemTypeFromStatus` not exported.

- [ ] **Step 2.3: Implement in `src/lib/idr-meeting.ts`**

Add near the top of the "Session creation" section (above `TERMINAL_DEAL_STAGES`, ~line 640):

```ts
// ---------------------------------------------------------------------------
// Review types — what varies per item type. ESCALATION's row encodes its
// existing behavior (IDR task subject, as-built revision routing) so sync can
// resolve every type uniformly. Adding a future review type = one enum value
// + one row here + its HubSpot task/workflow.
// ---------------------------------------------------------------------------

export type ReviewItemType = "IDR" | "ESCALATION" | "NEW_CONSTRUCTION";

export const NC_READY_FOR_REVIEW_STATUS = "New Construction - Ready for Review";

export const REVIEW_TYPES: Record<ReviewItemType, {
  noteLabel: string;
  taskSubject: string;
  revisionType: "design" | "escalation";
  revisionReasonProperty: "idr_revision_reason" | "inspection_rejection_reason";
}> = {
  IDR: {
    noteLabel: "IDR Meeting",
    taskSubject: "Complete Initial Design Review",
    revisionType: "design",
    revisionReasonProperty: "idr_revision_reason",
  },
  NEW_CONSTRUCTION: {
    noteLabel: "New Construction Review",
    taskSubject: "New Construction Design Review",
    revisionType: "escalation",
    revisionReasonProperty: "inspection_rejection_reason",
  },
  ESCALATION: {
    noteLabel: "IDR Meeting",
    taskSubject: "Complete Initial Design Review",
    revisionType: "escalation",
    revisionReasonProperty: "inspection_rejection_reason",
  },
};

/** Derive an item's review type from its HubSpot design_status snapshot. */
export function deriveItemTypeFromStatus(
  designStatus: string | null | undefined,
): "IDR" | "NEW_CONSTRUCTION" {
  return designStatus === NC_READY_FOR_REVIEW_STATUS ? "NEW_CONSTRUCTION" : "IDR";
}
```

- [ ] **Step 2.4: Run tests, verify they pass**

```bash
npx jest src/__tests__/idr-review-types.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/idr-meeting.ts src/__tests__/idr-review-types.test.ts
git commit -m "feat(idr): review-type registry + design_status type derivation"
```

### Task 3: Third filter group in `fetchInitialReviewDeals`

**Files:**
- Modify: `src/lib/idr-meeting.ts:659-666` (the `searchWithRetry` call)

- [ ] **Step 3.1: Add the NC filter group**

In `fetchInitialReviewDeals`, the `filterGroups` array gains a third entry (keep `limit: 200` — zero NC deals today, ample headroom):

```ts
  const response = await searchWithRetry({
    filterGroups: [
      { filters: [...commonFilters, { propertyName: "design_status", operator: FilterOperatorEnum.Eq, value: "Initial Review" }] },
      { filters: [...commonFilters, { propertyName: "idr_revision_complete_date", operator: FilterOperatorEnum.HasProperty }, { propertyName: "idr_re_review_needed", operator: FilterOperatorEnum.Eq, value: "true" }] },
      { filters: [...commonFilters, { propertyName: "design_status", operator: FilterOperatorEnum.Eq, value: NC_READY_FOR_REVIEW_STATUS }] },
    ] as unknown as { filters: { propertyName: string; operator: typeof FilterOperatorEnum.Eq; value: string }[] }[],
    properties: SNAPSHOT_PROPERTIES,
    limit: 200,
  });
```

- [ ] **Step 3.2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/idr-meeting.ts
git commit -m "feat(idr): pull New Construction - Ready for Review deals into the IDR queue"
```

### Task 4: Revision-reason routing in `buildHubSpotPropertyUpdates` (TDD)

**Files:**
- Modify: `src/lib/idr-meeting.ts:467` (`PropertyFields.itemType`) and `:523-540` (reason routing)
- Test: `src/__tests__/idr-review-types.test.ts` (append)

- [ ] **Step 4.1: Write failing tests** (append to `idr-review-types.test.ts`; add `buildHubSpotPropertyUpdates` to the import from `@/lib/idr-meeting`)

```ts
describe("buildHubSpotPropertyUpdates revision routing", () => {
  const base = {
    difficulty: null, installerCount: null, installerDays: null,
    electricianCount: null, electricianDays: null, discoReco: null,
    interiorAccess: null, operationsNotes: null, needsSurveyInfo: null,
    needsResurvey: null, salesChangeRequested: null, salesChangeNotes: null,
    opsChangeNotes: null, designRevisionNeeded: true,
    designRevisionReason: "Panel layout wrong", needsReReview: false,
    reviewed: true,
  } as const;

  it("IDR revisions write idr_revision_reason", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "IDR" });
    expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.inspection_rejection_reason).toBeUndefined();
  });

  it("ESCALATION revisions write inspection_rejection_reason (unchanged behavior)", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "ESCALATION" });
    expect(u.inspection_rejection_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.idr_revision_reason).toBeUndefined();
  });

  it("NEW_CONSTRUCTION revisions write inspection_rejection_reason (as-built track)", () => {
    const u = buildHubSpotPropertyUpdates({ ...base, itemType: "NEW_CONSTRUCTION" });
    expect(u.inspection_rejection_reason).toBe("Revision Reason: Panel layout wrong");
    expect(u.idr_revision_reason).toBeUndefined();
  });

  it("missing itemType defaults to IDR routing", () => {
    const u = buildHubSpotPropertyUpdates({ ...base });
    expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
  });
});
```

- [ ] **Step 4.2: Run, verify the NEW_CONSTRUCTION case fails**

```bash
npx jest src/__tests__/idr-review-types.test.ts
```

Expected: FAIL — `itemType: "NEW_CONSTRUCTION"` is a type error / NC routes to `idr_revision_reason`.

- [ ] **Step 4.3: Implement**

In `PropertyFields` (line 467): `itemType?: ReviewItemType;`

Replace the reason-routing block (lines 530-536):

```ts
    if (combinedReason) {
      const reasonProperty = REVIEW_TYPES[fields.itemType ?? "IDR"].revisionReasonProperty;
      updates[reasonProperty] = combinedReason;
    }
```

(The surrounding `if (fields.designRevisionNeeded)` / `idr_re_review_needed` logic is unchanged.)

- [ ] **Step 4.4: Run tests + full suite for regressions, then commit**

```bash
npx jest src/__tests__/idr-review-types.test.ts src/__tests__/idr-adder-serialization.test.ts
git add src/lib/idr-meeting.ts src/__tests__/idr-review-types.test.ts
git commit -m "feat(idr): registry-driven revision reason routing"
```

### Task 5: Note header label (TDD)

**Files:**
- Modify: `src/lib/idr-meeting.ts:381-398` (`buildHubSpotNoteBody`)
- Test: `src/__tests__/idr-review-types.test.ts` (append)

- [ ] **Step 5.1: Write failing tests** (append; import `buildHubSpotNoteBody`)

```ts
describe("buildHubSpotNoteBody header", () => {
  const fields = {
    difficulty: null, installerCount: null, installerDays: null,
    electricianCount: null, electricianDays: null, discoReco: false,
    interiorAccess: false, customerNotes: null, operationsNotes: null,
    salesChangeRequested: null, salesChangeNotes: null, opsChangeNotes: null,
    needsSurveyInfo: null, designNotes: null, conclusion: null,
    designRevisionNeeded: false, designRevisionReason: null,
    adderSummary: null, adderAmount: null,
  } as never; // NoteFields shape — only the header is under test

  it("defaults to the IDR Meeting header", () => {
    expect(buildHubSpotNoteBody(fields, "2026-07-08")).toContain("<strong>IDR Meeting -- 7/8/2026</strong>");
  });

  it("uses the New Construction Review label when passed", () => {
    expect(buildHubSpotNoteBody(fields, "2026-07-08", "New Construction Review"))
      .toContain("<strong>New Construction Review -- 7/8/2026</strong>");
  });
});
```

- [ ] **Step 5.2: Run, verify failure; implement**

Signature: `export function buildHubSpotNoteBody(fields: NoteFields, dateStr: string, noteLabel = "IDR Meeting"): string`

Header line becomes: `` const lines: string[] = [`<strong>${noteLabel} -- ${formatted}</strong>`]; ``

In `syncItemToHubSpot`, the `buildHubSpotNoteBody(...)` call site (~line 1005) passes `REVIEW_TYPES[item.type].noteLabel` as the third argument. IDR and ESCALATION both resolve to "IDR Meeting" — no change for existing types.

- [ ] **Step 5.3: Run tests, commit**

```bash
npx jest src/__tests__/idr-review-types.test.ts
git add src/lib/idr-meeting.ts src/__tests__/idr-review-types.test.ts
git commit -m "feat(idr): review-type-aware HubSpot note header"
```

### Task 6: Sync — task subject + NC revision-flag push

**Files:**
- Modify: `src/lib/idr-meeting.ts` — `completeInitialDesignReviewTask` (~line 801) and `syncItemToHubSpot` (~lines 892-1001)

- [ ] **Step 6.1: Parameterize the task search**

Rename `completeInitialDesignReviewTask(dealId)` → `completeDesignReviewTask(dealId: string, taskSubject: string)`. The CONTAINS_TOKEN filter value becomes `taskSubject` (line 820). Keep everything else identical. Update the JSDoc: subjects vary by review type; the two subjects cannot cross-match (NC lacks "Complete"/"Initial" tokens, IDR lacks "Construction"). Grep for other callers first:

```bash
rg -n "completeInitialDesignReviewTask" src/
```

If any exist outside `syncItemToHubSpot`, update them with `REVIEW_TYPES.IDR.taskSubject`.

- [ ] **Step 6.2: Rework the reviewed-item block in `syncItemToHubSpot`**

Change the `item` parameter's `type` field to `ReviewItemType`. Replace lines 971-1001 — including the old explanatory comment at 971-976, which describes the superseded flow — with:

```ts
    // Complete the review task when reviewed. The review IS complete whether
    // they approve or flag a revision — the task should be completed either
    // way. A HubSpot workflow then advances design_status ("Draft Complete").
    //
    // When a revision is ALSO flagged, we push idr_revision_requested +
    // idr_revision_type; the "IDR Revision Needed" workflow waits ~3 min, then
    // overrides design_status per the type ("design" → IDR Revision Needed,
    // "escalation" → Revision Needed - Rejected / As-Built).
    //
    // NEW_CONSTRUCTION pushes the revision flags even when the task is missing
    // or completion throws: NC task creation is manual (the 08c workflow is
    // disabled), and the revision workflow enrolls on the property, not the
    // task — only the "Draft Complete" flip (which the revision would override
    // anyway) is lost. IDR/ESCALATION keep task-gated behavior.
    const reviewType = REVIEW_TYPES[item.type];
    let taskCompleteWarning: string | undefined;
    if (item.reviewed) {
      let taskCompleted = false;
      try {
        const result = await completeDesignReviewTask(item.dealId, reviewType.taskSubject);
        taskCompleted = result.completed;
        if (!result.completed) {
          console.warn(`[idr-meeting] No "${reviewType.taskSubject}" task found for deal ${item.dealId} — workflow won't fire`);
          taskCompleteWarning = "No design review task found on this deal — design_status may need manual update.";
        }
      } catch (err) {
        console.error(`[idr-meeting] Failed to complete design review task for deal ${item.dealId}:`, err);
        taskCompleteWarning = "Failed to complete design review task — design_status may need manual update.";
      }
      if (
        item.designRevisionNeeded &&
        (taskCompleted || item.type === "NEW_CONSTRUCTION")
      ) {
        await pushDealProperties(item.dealId, {
          idr_revision_requested: "true",
          idr_revision_type: reviewType.revisionType,
        });
        console.log(`[idr-meeting] Set idr_revision_requested=true, type=${reviewType.revisionType} on deal ${item.dealId}`);
      }
    }
```

Behavior check against today: IDR/ESCALATION push flags only when `taskCompleted` (same as the old `result.completed` branch), and `revisionType` resolves to the same `"design"`/`"escalation"` values the old ternary produced. Only NC gets the new always-push path. One subtle change: the flag push moves outside the original `try` — for IDR this is equivalent (when `completeDesignReviewTask` throws, `taskCompleted` stays false so the push is skipped, matching old behavior); a `pushDealProperties` failure now surfaces via the outer try/catch of `syncItemToHubSpot` as a sync failure instead of a task warning, which is more honest.

- [ ] **Step 6.3: Typecheck, run all IDR tests, commit**

```bash
npx tsc --noEmit
npx jest src/__tests__ -t "" --testPathPattern "idr"
git add src/lib/idr-meeting.ts
git commit -m "feat(idr): review-type-aware task completion + NC revision push without task"
```

### Task 7: Routes — sessions, preview, manual add

**Files:**
- Modify: `src/app/api/idr-meeting/sessions/route.ts:133` (item type), `:271-273` (BOM filter)
- Modify: `src/app/api/idr-meeting/preview/route.ts:94`
- Modify: `src/app/api/idr-meeting/items/route.ts:59-70`

- [ ] **Step 7.1: Sessions route**

Import `deriveItemTypeFromStatus` from `@/lib/idr-meeting`. Line 133:

```ts
          type: deriveItemTypeFromStatus(snapshot.designStatus),
```

BOM auto-extraction filter (line 271-273) — NC items auto-extract like IDR; escalations stay on-demand:

```ts
  const idrItemsWithFolder = items.filter(
    (item) => (item.type === "IDR" || item.type === "NEW_CONSTRUCTION") && item.designFolderUrl,
  );
```

Escalation-queue precedence is already correct: the existing-item merge (line ~256) flips `type` to `"ESCALATION"` regardless of prior value — escalation wins over NC, per spec. No change needed; verify by reading.

- [ ] **Step 7.2: Preview route**

Import `deriveItemTypeFromStatus` and `type ReviewItemType`. Line 94:

```ts
      type: deriveItemTypeFromStatus(snapshot.designStatus) as ReviewItemType,
```

The existing-escalation upgrade loop (line ~239, `existing.type = "ESCALATION"`) already implements escalation-wins. No change.

- [ ] **Step 7.3: Manual-add route (`items/route.ts`)**

After the snapshot is built (line ~50), derive the type instead of trusting the client for non-escalations:

```ts
  const itemType = type === "ESCALATION"
    ? "ESCALATION"
    : deriveItemTypeFromStatus(snapshot.designStatus);
```

and in the create: `type: itemType,` (replacing `type: type ?? "IDR"`).

- [ ] **Step 7.4: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/app/api/idr-meeting/sessions/route.ts src/app/api/idr-meeting/preview/route.ts src/app/api/idr-meeting/items/route.ts
git commit -m "feat(idr): derive NC item type in sessions/preview/manual-add routes"
```

### Task 8: UI — type unions + NC badge

**Files:**
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx:34`
- Modify: `src/app/dashboards/idr-meeting/ProjectQueue.tsx:140` (badge area)
- Modify: `src/app/dashboards/idr-meeting/NoteHistory.tsx:11`
- Modify: `src/app/dashboards/idr-meeting/DealHistoryDetail.tsx:13`

- [ ] **Step 8.1: Widen the item type unions**

In each of the four files, change `type: "IDR" | "ESCALATION"` → `type: "IDR" | "ESCALATION" | "NEW_CONSTRUCTION"`. (`AddProjectDialog.tsx`'s `useState<"IDR" | "ESCALATION">` picker state stays as-is — the server derives NC automatically; users never pick it.)

- [ ] **Step 8.2: Add the NC badge in ProjectQueue**

Directly below the escalation prefix block (after line ~145):

```tsx
                    {/* New Construction review badge */}
                    {item.type === "NEW_CONSTRUCTION" && (
                      <span className="text-[10px] font-semibold text-cyan-500 shrink-0" title="New Construction Design Review">
                        NC
                      </span>
                    )}
```

(Pattern matches the existing RE-REVIEW text badge; cyan is unused by adjacent badges. Deliberate cosmetic deviation from the spec's "New Construction" badge text: the compact "NC" label fits the tight queue row, with the full name in the tooltip.)

- [ ] **Step 8.3: Check for other type-surfacing spots**

```bash
rg -n '=== "ESCALATION"|ESCALATION' src/app/dashboards/idr-meeting/ --no-heading
```

For each hit that renders a label/badge from item type (e.g., ProjectDetail header, SessionHeader counts): if it distinguishes ESCALATION visually, leave it; NC items need no special handling there beyond the queue badge. Only add NC rendering if a spot would otherwise crash or mislabel NC (e.g., an exhaustive switch). Note findings in the commit message.

- [ ] **Step 8.4: Typecheck, lint, full test suite, commit**

```bash
npx tsc --noEmit
npm run lint
npm run test
git add src/app/dashboards/idr-meeting/
git commit -m "feat(idr): NC badge + widened item type unions in meeting UI"
```

### Task 9: Final verification + PR

- [ ] **Step 9.1: Full suite from clean state**

```bash
npm run test
npx tsc --noEmit
npm run lint
```

Expected: all pass. Fix anything that doesn't before proceeding.

- [ ] **Step 9.2: Verify branch contains only this feature**

```bash
git log feat/idr-new-construction-review ^origin/main --oneline --stat
```

Expected: the spec cherry-pick + the feature commits above, touching only the files this plan names (plus `src/generated/prisma` from Step 1.3). Nothing else.

- [ ] **Step 9.3: Push and open PR (deploys go through GitHub)**

```bash
git push -u origin feat/idr-new-construction-review
gh pr create --title "feat(idr): New Construction review type in IDR meeting hub" --body "$(cat <<'EOF'
## Summary
- Pulls deals with `design_status = "New Construction - Ready for Review"` into IDR meeting sessions as a badged NEW_CONSTRUCTION review type (sessions, preview/prep, manual add all derive the type from status; escalation still wins)
- Sync completes the "New Construction Design Review" HubSpot task (existing enabled 08d workflow flips status to Draft Complete) and routes flagged revisions to the as-built track via the existing IDR Revision Needed workflow's escalation branch
- NC revision flags push even when the review task is missing (NC task creation is manual today), so as-built routing never silently drops
- Minor failure-mode improvement for existing types: a failed revision-flag property push now marks the item sync FAILED (retryable) instead of SYNCED-with-warning
- Zero HubSpot workflow/property changes

## Spec
docs/superpowers/specs/2026-07-08-idr-new-construction-review-type-design.md

## HUMAN ACTION REQUIRED before merge
Apply the additive migration to prod (adds NEW_CONSTRUCTION to IdrItemType):
`npx prisma migrate deploy` — verify with dry-run first per migrate-prod.sh gotcha.

## Test plan
- [ ] Unit tests: registry, type derivation, revision-reason routing, note header (src/__tests__/idr-review-types.test.ts)
- [ ] Existing IDR tests green
- [ ] Post-deploy: create a session while an NC deal sits in "New Construction - Ready for Review"; confirm badge, sync completes the NC task, 08d flips to Draft Complete

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do NOT merge — Zach merges after applying the migration.
