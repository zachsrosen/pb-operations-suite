# IDR D&R/Service Review Type Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Service/D&R pipeline deals in `design_status = "Initial Review"` into IDR meeting sessions as a combined `DNR_SERVICE` review type with per-pipeline SVC/D&R badges, syncing via the existing "D&R/Service Design Review" HubSpot task and the IDR revision track.

**Architecture:** Extend the `REVIEW_TYPES` registry with queue-construction fields (`pipelines`, `statusValue`, `terminalStages`, `autoBomExtract`, `pushRevisionFlagsWithoutTask`) so `fetchInitialReviewDeals` builds filter groups from the registry. Type derivation becomes pipeline-first. `IdrMeetingItem` gains a snapshotted `pipeline` column for the badge split. Zero HubSpot changes.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (Neon), HubSpot API v3, Jest.

**Spec:** `docs/superpowers/specs/2026-07-08-idr-dnr-service-review-type-design.md` (committed on this branch).

**Ground rules:**
- Work in the worktree `/Users/zach/Downloads/Dev Projects/PB-Operations-Suite-dnr-svc` (branch `feat/idr-dnr-service-review`, already created; node_modules symlinked; prisma client already generated once).
- NEVER run `prisma migrate deploy` / `db execute` / `db push` — migration file only.
- Test mock pattern: `src/__tests__/idr-review-types.test.ts` (already exists from PR #1336 — extend it).
- Pre-existing baseline: `npx tsc --noEmit` has errors only in unrelated `src/__tests__/**` files; you must introduce zero errors outside that set. `npm run test` has ~36 pre-existing environmental suite failures unrelated to idr-meeting.
- Commit per task; end commit messages with:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

## Chunk 1: Everything

### Task 1: Prisma — enum value + pipeline column

**Files:**
- Modify: `prisma/schema.prisma` — `enum IdrItemType` gains `DNR_SERVICE`; `model IdrMeetingItem` gains `pipeline String?` directly under `region String`
- Create: `prisma/migrations/20260708230000_add_dnr_service_idr_item_type/migration.sql`

- [ ] **Step 1.1:** Schema edits:

```prisma
enum IdrItemType {
  IDR
  ESCALATION
  NEW_CONSTRUCTION
  DNR_SERVICE
}
```
and in `model IdrMeetingItem`, below `region    String // pb_location`:
```prisma
  pipeline  String? // HubSpot pipeline ID, snapshotted at creation (badge split)
```

- [ ] **Step 1.2:** Migration file (do NOT apply):

```sql
-- Add DNR_SERVICE to IdrItemType + pipeline snapshot column (additive)
ALTER TYPE "IdrItemType" ADD VALUE 'DNR_SERVICE';
ALTER TABLE "IdrMeetingItem" ADD COLUMN "pipeline" TEXT;
```

- [ ] **Step 1.3:** `npx prisma generate` — expect exit 0, `DNR_SERVICE` in `src/generated/prisma/enums.ts`.
- [ ] **Step 1.4:** Commit: `feat(idr): add DNR_SERVICE item type + pipeline snapshot column`

### Task 2: Client-safe pipeline labels module

**Files:**
- Create: `src/app/dashboards/idr-meeting/review-type-labels.ts`
- Test: extend `src/__tests__/idr-review-types.test.ts`

Client components can't import `@/lib/idr-meeting` (Prisma leak breaks Turbopack dev). This tiny pure module holds the pipeline IDs + badge-label mapping for both client and server use. IDs are hardcoded defaults; the server registry's env-fallback uses the same constants, so they can't drift unless env vars override — acceptable (they never have).

- [ ] **Step 2.1:** Write failing tests (append to idr-review-types.test.ts):

```ts
import {
  SERVICE_PIPELINE_ID,
  DNR_PIPELINE_ID,
  reviewTypePillLabel,
} from "@/app/dashboards/idr-meeting/review-type-labels";

describe("reviewTypePillLabel", () => {
  it("maps DNR_SERVICE by pipeline", () => {
    expect(reviewTypePillLabel("DNR_SERVICE", SERVICE_PIPELINE_ID)).toBe("SVC");
    expect(reviewTypePillLabel("DNR_SERVICE", DNR_PIPELINE_ID)).toBe("D&R");
    expect(reviewTypePillLabel("DNR_SERVICE", null)).toBe("D&R/SVC");
  });
  it("maps NEW_CONSTRUCTION to NC and passes other types through", () => {
    expect(reviewTypePillLabel("NEW_CONSTRUCTION", null)).toBe("NC");
    expect(reviewTypePillLabel("IDR", null)).toBe("IDR");
    expect(reviewTypePillLabel("ESCALATION", "whatever")).toBe("ESCALATION");
  });
});
```

- [ ] **Step 2.2:** Run → FAIL (module missing). Implement:

```ts
// Pure, client-safe: no Prisma/server imports. Pipeline IDs are stable
// HubSpot IDs; the server registry uses the same values as env fallbacks.
export const SERVICE_PIPELINE_ID = "23928924";
export const DNR_PIPELINE_ID = "21997330";

/** Compact display label for an item type pill/badge. */
export function reviewTypePillLabel(
  type: string,
  pipeline: string | null | undefined,
): string {
  if (type === "DNR_SERVICE") {
    if (pipeline === SERVICE_PIPELINE_ID) return "SVC";
    if (pipeline === DNR_PIPELINE_ID) return "D&R";
    return "D&R/SVC";
  }
  if (type === "NEW_CONSTRUCTION") return "NC";
  return type;
}
```

- [ ] **Step 2.3:** Run → PASS. Commit: `feat(idr): client-safe review-type pill labels`

### Task 3: Registry restructure + pipeline-first derivation (TDD)

**Files:**
- Modify: `src/lib/idr-meeting.ts` (registry block from PR #1336, ~line 640; `SNAPSHOT_PROPERTIES` ~line 56; `snapshotDealProperties`)
- Test: `src/__tests__/idr-review-types.test.ts`

- [ ] **Step 3.1:** Write failing tests: new registry fields; `deriveItemType`; filter groups. Replace the existing `deriveItemTypeFromStatus` describe block with:

```ts
describe("deriveItemType (pipeline-first)", () => {
  it("Service/D&R pipeline always derives DNR_SERVICE", () => {
    expect(deriveItemType(SERVICE_PIPELINE_ID, "Initial Review")).toBe("DNR_SERVICE");
    expect(deriveItemType(DNR_PIPELINE_ID, "IDR Revision Complete")).toBe("DNR_SERVICE");
    expect(deriveItemType(SERVICE_PIPELINE_ID, NC_READY_FOR_REVIEW_STATUS)).toBe("DNR_SERVICE");
  });
  it("Project pipeline falls through to status rules", () => {
    expect(deriveItemType("6900017", NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
    expect(deriveItemType("6900017", "Initial Review")).toBe("IDR");
    expect(deriveItemType(null, "Initial Review")).toBe("IDR");
    expect(deriveItemType(null, NC_READY_FOR_REVIEW_STATUS)).toBe("NEW_CONSTRUCTION");
  });
});

describe("DNR_SERVICE registry row", () => {
  it("syncs via the combined task and the IDR revision track", () => {
    expect(REVIEW_TYPES.DNR_SERVICE.taskSubject).toBe("D&R/Service Design Review");
    expect(REVIEW_TYPES.DNR_SERVICE.revisionType).toBe("design");
    expect(REVIEW_TYPES.DNR_SERVICE.revisionReasonProperty).toBe("idr_revision_reason");
    expect(REVIEW_TYPES.DNR_SERVICE.noteLabel).toBe("D&R/Service Design Review");
    expect(REVIEW_TYPES.DNR_SERVICE.autoBomExtract).toBe(false);
    expect(REVIEW_TYPES.DNR_SERVICE.pushRevisionFlagsWithoutTask).toBe(false);
  });
  it("NC keeps push-without-task; IDR/ESCALATION stay task-gated with auto-extract only on IDR/NC", () => {
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.pushRevisionFlagsWithoutTask).toBe(true);
    expect(REVIEW_TYPES.IDR.pushRevisionFlagsWithoutTask).toBe(false);
    expect(REVIEW_TYPES.IDR.autoBomExtract).toBe(true);
    expect(REVIEW_TYPES.NEW_CONSTRUCTION.autoBomExtract).toBe(true);
    expect(REVIEW_TYPES.ESCALATION.autoBomExtract).toBe(false);
  });
});

describe("buildQueueFilterGroups", () => {
  it("builds one group per status-driven type plus the re-review group", () => {
    const groups = buildQueueFilterGroups();
    expect(groups).toHaveLength(4);
    const dnr = groups.find((g) =>
      g.filters.some((f) => f.propertyName === "pipeline" && f.values?.includes(SERVICE_PIPELINE_ID)) &&
      g.filters.some((f) => f.propertyName === "design_status"));
    expect(dnr).toBeDefined();
    expect(dnr!.filters.some((f) => f.propertyName === "design_status" && f.value === "Initial Review")).toBe(true);
    expect(dnr!.filters.some((f) => f.propertyName === "dealstage" && f.values?.includes("56217769") && f.values?.includes("72700977"))).toBe(true);
    // re-review group spans all registry pipelines
    const rr = groups.find((g) => g.filters.some((f) => f.propertyName === "idr_re_review_needed"));
    expect(rr!.filters.some((f) => f.propertyName === "pipeline" && f.values?.includes(SERVICE_PIPELINE_ID) && f.values?.includes("6900017"))).toBe(true);
  });
});
```

Import `deriveItemType`, `buildQueueFilterGroups` from `@/lib/idr-meeting`; keep `SERVICE_PIPELINE_ID`/`DNR_PIPELINE_ID` imported from the labels module (Task 2). Note: `deriveItemTypeFromStatus` is removed — delete its old describe block and any import.

- [ ] **Step 3.2:** Run → FAIL. Implement in `src/lib/idr-meeting.ts`:

1. Import the pipeline constants: `import { SERVICE_PIPELINE_ID, DNR_PIPELINE_ID } from "@/app/dashboards/idr-meeting/review-type-labels";` — then env-fallback locals:
```ts
const SERVICE_PIPELINE = process.env.HUBSPOT_PIPELINE_SERVICE ?? SERVICE_PIPELINE_ID;
const DNR_PIPELINE = process.env.HUBSPOT_PIPELINE_DNR ?? DNR_PIPELINE_ID;
```
(Verify `review-type-labels.ts` stays import-clean in both directions — it must not import anything.)

2. Registry rows gain the new fields (existing sync fields unchanged):

```ts
export const REVIEW_TYPES: Record<ReviewItemType, {
  noteLabel: string;
  taskSubject: string;
  revisionType: "design" | "escalation";
  revisionReasonProperty: "idr_revision_reason" | "inspection_rejection_reason";
  autoBomExtract: boolean;
  pushRevisionFlagsWithoutTask: boolean;
  /** Status-driven queue pull; absent for queue-driven ESCALATION. */
  queue?: { pipelines: string[]; statusValue: string; terminalStages: string[] };
}> = {
  IDR: {
    ..., autoBomExtract: true, pushRevisionFlagsWithoutTask: false,
    queue: { pipelines: [PROJECT_PIPELINE_ID], statusValue: "Initial Review",
             terminalStages: ["68229433", "20440343", "20440344"] },
  },
  NEW_CONSTRUCTION: {
    ..., autoBomExtract: true, pushRevisionFlagsWithoutTask: true,
    queue: { pipelines: [PROJECT_PIPELINE_ID], statusValue: NC_READY_FOR_REVIEW_STATUS,
             terminalStages: ["68229433", "20440343", "20440344"] },
  },
  DNR_SERVICE: {
    noteLabel: "D&R/Service Design Review",
    taskSubject: "D&R/Service Design Review",
    revisionType: "design",
    revisionReasonProperty: "idr_revision_reason",
    autoBomExtract: false, pushRevisionFlagsWithoutTask: false,
    queue: { pipelines: [SERVICE_PIPELINE, DNR_PIPELINE], statusValue: "Initial Review",
             terminalStages: ["56217769", "76979603", "52474745", "68245827", "72700977"] },
  },
  ESCALATION: { ...existing sync fields..., autoBomExtract: false, pushRevisionFlagsWithoutTask: false },
};
```
`ReviewItemType` widens to `"IDR" | "ESCALATION" | "NEW_CONSTRUCTION" | "DNR_SERVICE"`. The old `TERMINAL_DEAL_STAGES` const is subsumed by the registry (delete it or keep as the IDR/NC terminalStages source — implementer's choice, no duplication).

3. Replace `deriveItemTypeFromStatus` with:

```ts
/** Derive an item's review type: pipeline decides for Service/D&R, else status. */
export function deriveItemType(
  pipeline: string | null | undefined,
  designStatus: string | null | undefined,
): "IDR" | "NEW_CONSTRUCTION" | "DNR_SERVICE" {
  if (pipeline === SERVICE_PIPELINE || pipeline === DNR_PIPELINE) return "DNR_SERVICE";
  return designStatus === NC_READY_FOR_REVIEW_STATUS ? "NEW_CONSTRUCTION" : "IDR";
}
```

4. Extract + export `buildQueueFilterGroups()` (pure), and use it in `fetchInitialReviewDeals`:

```ts
type QueueFilter = { propertyName: string; operator: string; value?: string; values?: string[] };
export function buildQueueFilterGroups(): { filters: QueueFilter[] }[] {
  const groups: { filters: QueueFilter[] }[] = [];
  const allPipelines = new Set<string>();
  const allTerminal = new Set<string>();
  for (const cfg of Object.values(REVIEW_TYPES)) {
    if (!cfg.queue) continue;
    cfg.queue.pipelines.forEach((p) => allPipelines.add(p));
    cfg.queue.terminalStages.forEach((s) => allTerminal.add(s));
    groups.push({ filters: [
      { propertyName: "pipeline", operator: "IN", values: cfg.queue.pipelines },
      { propertyName: "dealstage", operator: "NOT_IN", values: cfg.queue.terminalStages },
      { propertyName: "design_status", operator: "EQ", value: cfg.queue.statusValue },
    ]});
  }
  groups.push({ filters: [
    { propertyName: "pipeline", operator: "IN", values: [...allPipelines] },
    { propertyName: "dealstage", operator: "NOT_IN", values: [...allTerminal] },
    { propertyName: "idr_revision_complete_date", operator: "HAS_PROPERTY" },
    { propertyName: "idr_re_review_needed", operator: "EQ", value: "true" },
  ]});
  return groups;
}
```
`fetchInitialReviewDeals` passes `buildQueueFilterGroups()` (with the same `as unknown as` cast the current code uses for the SDK's filter type) and keeps `properties: SNAPSHOT_PROPERTIES, limit: 200`. Use string operator literals ("IN"/"NOT_IN"/"EQ"/"HAS_PROPERTY") matching `FilterOperatorEnum` values — check the enum's runtime values and use the enum members in the non-test code if that's cleaner; the test asserts shape, not enum identity.

5. `SNAPSHOT_PROPERTIES` gains `"pipeline"`; `snapshotDealProperties` maps `pipeline: p.pipeline ?? null` (add `pipeline` to its return type / `SnapshotFields`).

- [ ] **Step 3.3:** Run tests → PASS. `npx tsc --noEmit` → errors only in the routes that still call the removed `deriveItemTypeFromStatus` (expected; fixed in Task 5) — if so, note and continue; otherwise zero new. Commit: `feat(idr): registry-driven queue config + pipeline-first type derivation`

### Task 4: Sync — registry flag replaces NC hardcode (TDD)

**Files:**
- Modify: `src/lib/idr-meeting.ts` (`syncItemToHubSpot`, the `(taskCompleted || item.type === "NEW_CONSTRUCTION")` gate)
- Test: `src/__tests__/idr-review-types.test.ts`

- [ ] **Step 4.1:** Append failing tests to the existing `syncItemToHubSpot revision-flag gating` describe:

```ts
it("DNR_SERVICE stays task-gated and searches the combined subject", async () => {
  const result = await syncItemToHubSpot(
    makeItem({ type: "DNR_SERVICE" }) as Parameters<typeof syncItemToHubSpot>[0],
    sessionDate,
  );
  expect(result.ok).toBe(true);
  expect(findFlagPush()).toBeUndefined();   // no task found → no flag push
  const searchBody = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
  expect(searchBody).toContain("D&R/Service Design Review");
});

it("DNR_SERVICE pushes design-type flags when the task IS found and completed", async () => {
  // Task search returns one open task; the PATCH completion also goes through fetch.
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ id: "task-9" }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  const result = await syncItemToHubSpot(
    makeItem({ type: "DNR_SERVICE" }) as Parameters<typeof syncItemToHubSpot>[0],
    sessionDate,
  );
  expect(result.ok).toBe(true);
  const flagPush = findFlagPush();
  expect(flagPush).toBeDefined();
  expect(flagPush![1].properties.idr_revision_type).toBe("design");
});
```
Also append to `buildHubSpotPropertyUpdates revision routing`:
```ts
it("DNR_SERVICE revisions write idr_revision_reason", () => {
  const u = buildHubSpotPropertyUpdates({ ...base, itemType: "DNR_SERVICE" });
  expect(u.idr_revision_reason).toBe("Revision Reason: Panel layout wrong");
  expect(u.inspection_rejection_reason).toBeUndefined();
});
```
And to the note-header describe:
```ts
it("uses the D&R/Service label when passed", () => {
  expect(buildHubSpotNoteBody(fields, "2026-07-08", "D&R/Service Design Review"))
    .toContain("<strong>D&R/Service Design Review -- 7/8/2026</strong>");
});
```

- [ ] **Step 4.2:** Run → the sync test should already partially pass via registry resolution; the gate change is: replace `(taskCompleted || item.type === "NEW_CONSTRUCTION")` with `(taskCompleted || reviewType.pushRevisionFlagsWithoutTask)`. All tests (including the three existing NC/IDR gating tests) must pass unchanged. Commit: `feat(idr): registry-flag-driven revision push gating`

### Task 5: Routes

**Files:**
- Modify: `src/app/api/idr-meeting/sessions/route.ts`, `preview/route.ts`, `items/route.ts`, `deal-search/route.ts`

- [ ] **Step 5.1:** Sessions: `type: deriveItemType(snapshot.pipeline, snapshot.designStatus)`; BOM filter → `REVIEW_TYPES[item.type as ReviewItemType].autoBomExtract && item.designFolderUrl` (import `REVIEW_TYPES`, `type ReviewItemType`).
- [ ] **Step 5.2:** Preview: `type: deriveItemType(snapshot.pipeline, snapshot.designStatus) as ReviewItemType`.
- [ ] **Step 5.3:** Items POST: `const itemType = type === "ESCALATION" ? "ESCALATION" : deriveItemType(snapshot.pipeline, snapshot.designStatus);`
- [ ] **Step 5.4:** Deal-search: pipeline filter `Eq PROJECT_PIPELINE_ID` → `In [all registry queue pipelines]` (derive the union from `REVIEW_TYPES` or export a helper/const from `idr-meeting.ts`); add `"pipeline"` to `properties` and `pipeline: deal.properties.pipeline` to the mapped result.
- [ ] **Step 5.5:** `npx tsc --noEmit` (zero non-test errors now), `npx eslint` the four files (zero new). Commit: `feat(idr): derive DNR_SERVICE in routes + widen deal search to registry pipelines`

### Task 6: UI

**Files:**
- Modify: `src/app/dashboards/idr-meeting/IdrMeetingClient.tsx` (type union + `pipeline: string | null` on `IdrItem`)
- Modify: `ProjectQueue.tsx` (badge), `NoteHistory.tsx`, `DealHistoryDetail.tsx` (unions + pipeline field + pill labels), `AddProjectDialog.tsx` (SVC/D&R marker in results)

- [ ] **Step 6.1:** Widen the three type unions with `"DNR_SERVICE"`; add `pipeline: string | null` to `IdrItem` and to the local item interfaces in NoteHistory/DealHistoryDetail (data already flows — full Prisma rows).
- [ ] **Step 6.2:** ProjectQueue badge, below the NC badge, using the Task 2 helper:

```tsx
{item.type === "DNR_SERVICE" && (
  <span className="text-[10px] font-semibold text-amber-500 shrink-0" title="D&R/Service Design Review">
    {reviewTypePillLabel(item.type, item.pipeline)}
  </span>
)}
```

- [ ] **Step 6.3:** History pills: replace the inline `=== "NEW_CONSTRUCTION" ? "NC" : type` ternaries in NoteHistory (~line 168) and DealHistoryDetail (~line 179) with `reviewTypePillLabel(x.type, x.pipeline)` (keeps the existing orange-for-ESCALATION styling ternary).
- [ ] **Step 6.4:** AddProjectDialog: results list shows a small muted `SVC`/`D&R` suffix when the search result's `pipeline` is a Service/D&R ID (result type gains `pipeline?: string | null`). Picker state union unchanged.
- [ ] **Step 6.5:** `npx tsc --noEmit`, `npx eslint src/app/dashboards/idr-meeting/`, full idr suites:
`npx jest src/__tests__/idr-review-types.test.ts src/__tests__/idr-adder-serialization.test.ts src/__tests__/lib/idr-meeting.test.ts src/__tests__/api/idr-meeting-presence.test.ts src/__tests__/api/idr-meeting-search.test.ts src/__tests__/components/search-results-grouping.test.ts`
All green, zero new lint. Commit: `feat(idr): SVC/D&R badges + pipeline-aware pills in meeting UI`

### Task 7: Final verification + PR

- [ ] **Step 7.1:** `npm run build` (full production build) — must pass.
- [ ] **Step 7.2:** `git log origin/main..HEAD --stat` — only spec/plan + the files this plan names.
- [ ] **Step 7.3:** Push + `gh pr create` — title `feat(idr): D&R/Service design review type in IDR meeting hub`; body: summary (combined DNR_SERVICE type, SVC/D&R badges, registry-driven filter groups, deal-search widened, IDR revision track, zero HubSpot changes), spec/plan links, HUMAN ACTION (additive migration: enum value + pipeline column, apply before merge), test plan incl. the 3 live Service deals as day-one verification. Do NOT merge.
