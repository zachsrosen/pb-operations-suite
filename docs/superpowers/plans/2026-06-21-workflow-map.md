# Workflow Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared, read-by-everyone dashboard that maps PB's live HubSpot automation (Sales → Project/D&R/Roofing/Service → stages → flows → plain-English trigger/action), ties in the live SOP process per stage, flags SOP-vs-automation drift, and shows cross-flow status progressions — with a Plain/Technical toggle and SOP edit-in-place gated to existing SOP editors.

**Architecture:** A nightly incremental sync reads the HubSpot Automation v4 API, runs a verified summarizer, and writes one JSON snapshot to a `SystemConfig` row (no DB migration). `GET /api/workflow-map` returns the snapshot; the React page drills down through it. The SOP Process pane reads live `SopSection` content; edit-in-place reuses the existing SOP revision API.

**Tech Stack:** Next.js 16 (App Router, RSC + client components), TypeScript, Prisma 7 (Neon), React Query v5, Tailwind v4 tokens, Jest.

**Spec:** `docs/superpowers/specs/2026-06-21-workflow-map-design.md`

**Validated reference prototypes (port these, match their output):**
- `data/hubspot-flows/build_sop_tables.py` — summarizer (every operator HubSpot uses, 4 enrollment types, execution-order action walk, plain rendering). Coverage audit passes (0 unparsed).
- `data/hubspot-flows/build_progression.py` — status hand-off graph.
- `data/hubspot-flows/build_worklist.py` — drift detector.
- Fixtures: `data/hubspot-flows/detail/<id>.json` (855 flow details), `_stage_lookup.json`, `_prop_labels.json`, `all-flows.json`, `sop-sections.json`.

---

## File Structure

**New — data layer (`src/lib/flow-map/`):**
- `types.ts` — `FlowMapSnapshot`, `FlowEntry`, `Pipeline`, `ProgressionLink`, condition/action structs.
- `client.ts` — HubSpot Automation v4 + CRM pipelines/properties fetch, with rate-limit retry.
- `summarize.ts` — port of `build_sop_tables.py`: stage mapping, plain+technical trigger, execution-order action walk.
- `progression.ts` — port of `build_progression.py`: `ProgressionLink[]` from sets/reads.
- `drift.ts` — port of `build_worklist.py`: per-stage documented-vs-live diff.
- `sop-map.ts` — curated `stageId → sopSectionId[]` (Project only) + cross-stage/cross-cutting notes.
- `store.ts` — read/write the `hubspot_flow_map` + `hubspot_flow_detail_cache` SystemConfig rows.
- `sync.ts` — orchestrator: list → incremental detail fetch → summarize → progression → write snapshot.

**New — API/routes:**
- `src/app/api/workflow-map/route.ts` — `GET` snapshot (all users).
- `src/app/api/workflow-map/refresh/route.ts` — `POST` manual sync (admin).
- `src/app/api/cron/workflow-map-sync/route.ts` — nightly cron.

**New — UI (`src/app/dashboards/workflow-map/` + `src/components/workflow-map/`):**
- `page.tsx` — server component, `DashboardShell` wrapper, session for edit-gate.
- `WorkflowMapClient.tsx` — drill state, breadcrumb, Plain/Technical toggle, search.
- `PipelineCards.tsx`, `StageTrack.tsx`, `StagePanes.tsx` (Process | Automation), `FlowList.tsx`, `FlowDetail.tsx`, `DriftBadges.tsx`, `ProgressionLinks.tsx`, `SopEditInline.tsx`.

**Modified:**
- `src/lib/roles.ts` — add `/dashboards/workflow-map` + `/api/workflow-map` to every role's `allowedRoutes`; keep `/api/workflow-map/refresh` admin-only.
- `src/lib/query-keys.ts` — add `workflowMap` key.
- `src/lib/suite-nav.ts` — add a Workflow Map card to the process suites.
- `vercel.json` — add the cron schedule.

---

## Chunk 1: Data layer — types, client, summarizer, progression

Follows @superpowers:test-driven-development. The summarizer is the crux; its tests assert parity with the Python coverage audit.

### Task 1.1: Snapshot types

**Files:**
- Create: `src/lib/flow-map/types.ts`

- [ ] **Step 1: Write the types** (no test — pure declarations)

```ts
export type Condition = { property: string; label: string; operator: string; values: string[]; plain: string; technical: string };
export type ActionStep = { kind: string; plain: string; technical: string };

export type FlowEntry = {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId: string;
  enrollmentType: "LIST_BASED" | "EVENT_BASED" | "MANUAL" | "DATASET";
  stageIds: string[];
  trigger: string;            // plain
  triggerTechnical: string;
  actions: string[];          // plain, execution order
  actionsTechnical: string[];
  sets: { property: string; label: string; value: string }[];
  reads: { property: string; label: string; value: string }[]; // non-stage status values
  cloneCount: number;
  revisionId: string;
  hubspotUrl: string;
};

export type Stage = { id: string; label: string; order: number };
export type Pipeline = { id: string; label: string; objectTypeId: string; stages: Stage[] };
export type ProgressionLink = { property: string; label: string; value: string; setBy: string[]; firesFlows: string[] };

export type FlowMapSnapshot = {
  generatedAt: string;
  portalId: string;
  pipelines: Pipeline[];
  stageLookup: Record<string, { pipelineId: string; pipelineLabel: string; stageLabel: string; order: number }>;
  flows: Record<string, FlowEntry>;
  links: ProgressionLink[];
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/flow-map/types.ts
git commit -m "feat(flow-map): snapshot type definitions"
```

### Task 1.2: HubSpot flow client

**Files:**
- Create: `src/lib/flow-map/client.ts`
- Test: `src/__tests__/flow-map-client.test.ts`

- [ ] **Step 1: Write failing test** (mock `global.fetch`; assert pagination + 429 retry)

```ts
import { listFlows } from "@/lib/flow-map/client";
test("listFlows paginates via paging.next.after", async () => {
  const pages = [
    { results: [{ id: "1" }], paging: { next: { after: "A" } } },
    { results: [{ id: "2" }] },
  ];
  let i = 0;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => pages[i++] })) as any;
  const flows = await listFlows("tok");
  expect(flows.map(f => f.id)).toEqual(["1", "2"]);
});
```

- [ ] **Step 2: Run → FAIL** — `npx jest flow-map-client -t "paginates"` (module not found).

- [ ] **Step 3: Implement** `client.ts` with `listFlows`, `getFlowDetail`, `getPipelines("deals"|"tickets")`, `getProperties("deals"|"tickets")`. Token-bucket + exponential backoff on 429 mirroring `searchWithRetry` in `src/lib/hubspot.ts` (read it first for the exact backoff shape). Base URL `https://api.hubapi.com/automation/v4/flows`, auth `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(flow-map): HubSpot flow + pipeline + property client with retry`.

### Task 1.3: Summarizer (port of build_sop_tables.py)

**Files:**
- Create: `src/lib/flow-map/summarize.ts`
- Test: `src/__tests__/flow-map-summarize.test.ts`
- Reference: `data/hubspot-flows/build_sop_tables.py` (authoritative logic), fixtures in `data/hubspot-flows/detail/`.

Port these functions exactly (behaviour must match the Python):
- `fmt_filter(prop, op)` → `Condition` with plain + technical (every operator HubSpot uses: `IS_ANY_OF/IS_EQUAL_TO/IS_EXACTLY/HAS_EVER_BEEN_*` = "is X"; `IS_NONE_OF/IS_NOT_EQUAL_TO` = "is not"; `HAS_NEVER_BEEN_ANY_OF` = "has never been"; `IS_KNOWN` = "is filled in"; `IS_UNKNOWN` = "is blank"; numeric `>,<,≥,≤`; `CONTAINS/CONTAINS_EXACTLY/DOES_NOT_CONTAIN`; `IS_BEFORE/IS_AFTER` with TODAY-offset → "more than N days ago"/"within last N days"; `IS_BETWEEN/IS_NOT_BETWEEN` incl. `propertyParser=UPDATED_AT` → "hasn't changed in N days").
- `triggerSummary(detail, labels, stageLookup)` → `{ plain, technical, stageIds, reads }`. Handle `LIST_BASED` (OR of AND branches; stage filters → context, non-stage → conditions; task-completion `hs_task_subject`+`hs_task_status=COMPLETED` → "the task '…' is completed"), `EVENT_BASED` (`hs_name`/`hs_value` → "X changes to Y"; custom event filters; bare event), `MANUAL`, `DATASET`, and re-enrollment fallback. Inclusion-only stage mapping (`IS_ANY_OF/IS_EQUAL_TO/HAS_EVER_BEEN_*` on `dealstage`/`hs_pipeline_stage`/`hs_value`).
- `actionSummary(detail, labels)` → `{ plain[], technical[], sets[] }` by walking the graph from `startActionId` via `connection.nextActionId`, rendering `LIST_BRANCH`/`STATIC_BRANCH` as `if <cond> → <branch>; otherwise …`. Action kinds per `actionTypeId` map in the spec §7.

- [ ] **Step 1: Write failing fixture tests**

```ts
import fs from "fs";
import { summarizeFlow } from "@/lib/flow-map/summarize";
const labels = JSON.parse(fs.readFileSync("data/hubspot-flows/_prop_labels.json", "utf8"));
const stageLookup = JSON.parse(fs.readFileSync("data/hubspot-flows/_stage_lookup.json", "utf8")).stage_lookup;
const load = (id: string) => JSON.parse(fs.readFileSync(`data/hubspot-flows/detail/${id}.json`, "utf8"));

test("DA Sent: task-completion trigger + conditional execution order", () => {
  const e = summarizeFlow(load("451599947"), labels, stageLookup);
  expect(e.trigger).toContain("the task “Send DA to Customer");
  expect(e.trigger).toContain("Design & Engineering");
  expect(e.actions[0]).toMatch(/^Set Is DA/i);
  expect(e.actions.join(" ")).toContain("otherwise set Design Approval Status");
});

// summarize.ts must export `unhandledOperators: Set<string>` (populated during a run)
// and `KNOWN_OPERATORS: ReadonlySet<string>` — the coverage gate, mirroring the Python audit.
test("coverage: every fixture parses with a non-empty trigger and zero unhandled operators", () => {
  const ids = fs.readdirSync("data/hubspot-flows/detail").filter(f => f.endsWith(".json")).map(f => f.replace(".json",""));
  for (const id of ids) {
    const d = load(id); if (d._error) continue;
    const e = summarizeFlow(d, labels, stageLookup);
    expect(e.trigger.trim().length).toBeGreaterThan(0);
  }
  // After processing all fixtures, no operator should have fallen through to the generic renderer:
  const { unhandledOperators } = require("@/lib/flow-map/summarize");
  expect([...unhandledOperators]).toEqual([]);
});

test("PandaDoc DA Sent: event-based, sets layout_status", () => {
  const e = summarizeFlow(load("1704991789"), labels, stageLookup);
  expect(e.enrollmentType).toBe("EVENT_BASED");
  expect(e.sets.some(s => s.property === "layout_status")).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `summarize.ts`** porting the Python. Keep a `KNOWN_OPERATORS` set and a dev-only assertion that no operator falls to the generic branch (mirror the Python coverage audit).
- [ ] **Step 4: Run → PASS** (all tests). If the coverage test surfaces an unhandled operator, add it (parity bug).
- [ ] **Step 4b: Parity gate** — run the Python oracle once (`python3 data/hubspot-flows/build_sop_tables.py`) and spot-diff a few stages of `docs/hubspot-sop-corrected-tables-2026-06-21.md` against your TS output for the same flows (Site Survey, Design). They should read materially the same. Resolve any divergence as a port bug before moving on.
- [ ] **Step 5: Commit** `feat(flow-map): trigger/action summarizer (plain + technical) ported from verified prototype`.

### Task 1.4: Progression builder

**Files:**
- Create: `src/lib/flow-map/progression.ts`
- Test: `src/__tests__/flow-map-progression.test.ts`
- Reference: `data/hubspot-flows/build_progression.py`.

- [ ] **Step 1: Failing test** — using the fixture set, assert the link whose **raw** `value === "Sent to Customer"` (its `.label` is the display name `"Sent For Approval"` — `ProgressionLink.value` stores the raw enum value, `.label` the display label) has `PandaDoc DA Sent` in `setBy` and `03. DA Flow - DA Follow Up Task` in `firesFlows`. Note: the oracle `docs/hubspot-workflow-progression-map.md` groups this row under the **label** "Sent For Approval" — same link, do not treat the value/label difference as a parity bug. Skip non-status props (dates, ids, `hs_*`, `dealstage`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `buildProgression(flows: FlowEntry[]): ProgressionLink[]` from each flow's `sets`/`reads` (clones collapsed, ON only), keeping `(prop,val)` that is both set and read.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(flow-map): cross-flow status progression links`.

### Task 1.5: Drift detector

**Files:**
- Create: `src/lib/flow-map/drift.ts`, `src/lib/flow-map/sop-map.ts`
- Test: `src/__tests__/flow-map-drift.test.ts`
- Reference: `data/hubspot-flows/build_worklist.py`, `data/hubspot-flows/sop-sections.json`.

- [ ] **Step 1:** Write `sop-map.ts` — the curated `STAGE_TO_SOP` map from spec §8 (Project only) + `CROSS_CUTTING_SECTIONS` (`wf-qr`) + `REVISION_SECTIONS` (`wf-rev-*`).
- [ ] **Step 2: Failing test** — for the Design & Engineering stage, given `wf-design`+`wf-da` documented names and the live ON flows, assert it returns `{ documentedButOff, documentedButMissing, liveButUndocumented }` with the live `Design Flow` numbered family in `liveButUndocumented`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** `detectDrift(stageId, sopSectionHtml[], flows)` — extract documented workflow names from `<code>`/table cells, normalize, compare to live ON flows mapped to the stage.
- [ ] **Step 5: Run → PASS. Commit** `feat(flow-map): evidence-backed SOP drift detector`.

### Task 1.6: Snapshot store + sync orchestrator

**Files:**
- Create: `src/lib/flow-map/store.ts`, `src/lib/flow-map/sync.ts`
- Test: `src/__tests__/flow-map-sync.test.ts`
- Reference: `src/lib/pe-uploader-overrides.ts` (SystemConfig JSON-row read/write upsert pattern).

- [ ] **Step 1: Implement `store.ts`** — `getSnapshot()`, `writeSnapshot(s)`, `getDetailCache()`, `writeDetailCache(c)` against keys `hubspot_flow_map` / `hubspot_flow_detail_cache` (JSON in `SystemConfig.value`, upsert). No test (thin wrapper) — covered by sync test.
- [ ] **Step 2: Failing test** — `syncFlowMap()` with a mocked client: 2 flows, one unchanged `revisionId` (cached) and one changed → assert `getFlowDetail` is called only for the changed id; assert snapshot written with both flows; assert repeated 429 keeps the prior snapshot (quota guard).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `sync.ts`** — list flows → diff `revisionId` vs detail cache → fetch only new/changed (0-3 + 0-5) → `getPipelines` + `getProperties` → `summarizeFlow` each → `buildProgression` → assemble `FlowMapSnapshot` → persist detail cache + snapshot. On repeated 429: throw without overwriting `hubspot_flow_map`. `maxDuration` budget handled by resumability (cache persists per-flow parse).
- [ ] **Step 5: Run → PASS. Commit** `feat(flow-map): incremental sync + SystemConfig snapshot store`.

---

## Chunk 2: Cron, API routes, access wiring

### Task 2.1: Nightly cron

**Files:**
- Create: `src/app/api/cron/workflow-map-sync/route.ts`
- Modify: `vercel.json` (add `{ "path": "/api/cron/workflow-map-sync", "schedule": "0 8 * * *" }`)
- Reference: `src/app/api/cron/property-reconcile/route.ts` (auth + shape).

- [ ] **Step 1:** Implement `GET` — `Bearer ${process.env.CRON_SECRET}` check, `export const maxDuration = 300`, call `syncFlowMap()`, return `{status,timestamp,...result}`; try/catch → 500 with error.
- [ ] **Step 2:** Add the `vercel.json` cron entry.
- [ ] **Step 3: Commit** `feat(flow-map): nightly sync cron`.

### Task 2.2: GET snapshot (all users)

**Files:**
- Create: `src/app/api/workflow-map/route.ts`
- Test: `src/__tests__/workflow-map-route.test.ts`

- [ ] **Step 1: Failing test** — `GET` returns the snapshot when present; returns `{ empty: true }` (200) when never synced.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `GET` → `getSnapshot()`; auth handled by middleware (no in-route role check needed beyond session).
- [ ] **Step 4: Run → PASS. Commit** `feat(flow-map): GET /api/workflow-map`.

### Task 2.3: POST refresh (admin)

**Files:**
- Create: `src/app/api/workflow-map/refresh/route.ts`

- [ ] **Step 1:** Implement `POST` — resolve session, assert admin role (mirror an existing admin route's session+role check); rate-limit (reject if a sync ran < 5 min ago, tracked via a `SystemConfig` timestamp); call `syncFlowMap()`; return status.
- [ ] **Step 2: Commit** `feat(flow-map): POST /api/workflow-map/refresh (admin)`.

### Task 2.4: Access wiring (roles + nav + query keys)

**Files:**
- Modify: `src/lib/roles.ts` — append `/dashboards/workflow-map` and `/api/workflow-map` to **every** role's `allowedRoutes` (incl. VIEWER). Add `/api/workflow-map/refresh` to `ADMIN_ONLY_ROUTES`.
- Modify: `src/lib/query-keys.ts` — `workflowMap: () => ["workflow-map"] as const`.
- Modify: `src/lib/suite-nav.ts` — add a "Workflow Map" card to Operations, D&E, P&I, Service, D&R, Intelligence suites pointing at `/dashboards/workflow-map`.

- [ ] **Step 1: Failing test** (`src/__tests__/workflow-map-access.test.ts`) — assert every `UserRole` in `ROLES` includes `/api/workflow-map` and `/dashboards/workflow-map` in `allowedRoutes`; assert `/api/workflow-map/refresh` is in `ADMIN_ONLY_ROUTES`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the edits (a helper loop appending the two routes to each role keeps it DRY — see how `roles.ts` is structured first).
- [ ] **Step 4: Run → PASS. Commit** `feat(flow-map): allow-list view route for all roles; admin-gate refresh`.

---

## Chunk 3: UI — drill-down, flow detail, Plain/Technical toggle, search

Follow existing dashboard patterns: `DashboardShell` (`accentColor`, `lastUpdated`), theme tokens (`bg-surface`, `text-foreground`, `border-t-border`), React Query, `stagger-grid`. Read `src/app/dashboards/pe/page.tsx` for the server-page + client-component split.

### Task 3.1: Page shell + data fetch
**Files:** Create `src/app/dashboards/workflow-map/page.tsx`, `src/components/workflow-map/WorkflowMapClient.tsx`.
- [ ] Server `page.tsx`: auth session, compute `canEditSop = roles.includes("ADMIN") || roles.includes("EXECUTIVE")` (this is the gate the existing SOP write endpoint enforces — see Task 6.1; NOT the finer `sop-access.ts` tab/section rules), pass to client; wrap in `DashboardShell title="Workflow Map" accentColor="cyan" lastUpdated={snapshot.generatedAt}`.
- [ ] `WorkflowMapClient`: React Query `useQuery(queryKeys.workflowMap(), fetchSnapshot)`; empty-state when `{empty:true}` ("Not synced yet — ask an admin to run a refresh"); holds `drill` state `{pipelineId?, stageId?, flowId?}`, breadcrumb, `view: "plain"|"technical"` (persist to `localStorage`), `search`.
- [ ] Commit `feat(flow-map): page shell + snapshot fetch`.

### Task 3.2: Pipeline cards (L1)
**Files:** Create `src/components/workflow-map/PipelineCards.tsx`.
- [ ] Render Sales at top with an arrow row branching to Project (hero) / D&R / Roofing / Service; each card shows ON/OFF flow counts from the snapshot. Click sets `pipelineId`.
- [ ] Commit `feat(flow-map): pipeline cards (L1)`.

### Task 3.3: Stage track (L2) + panes scaffold
**Files:** Create `src/components/workflow-map/StageTrack.tsx`, `StagePanes.tsx`.
- [ ] Stage track: stages in `order` + a "Cross-cutting" pseudo-stage (flows with no `stageIds`). Click sets `stageId`.
- [ ] `StagePanes`: two columns — Process (placeholder until Chunk 4) | Automation (`FlowList`).
- [ ] Commit `feat(flow-map): stage track + panes (L2)`.

### Task 3.4: Flow list + detail (L3) + toggle
**Files:** Create `src/components/workflow-map/FlowList.tsx`, `FlowDetail.tsx`.
- [ ] `FlowList`: flows at the stage, clones collapsed (show `cloneCount` badge), ON/OFF pill. Click sets `flowId`.
- [ ] `FlowDetail`: shows `trigger`/`actions` when `view==="plain"`, `triggerTechnical`/`actionsTechnical` + id + revisionId + HubSpot link when `"technical"`. Toggle control lives in `WorkflowMapClient` header.
- [ ] Commit `feat(flow-map): flow list + detail + Plain/Technical toggle`.

### Task 3.5: Search
- [ ] Add a client-side filter in `WorkflowMapClient` across flow name/trigger/action; filtered results jump straight to matching flows. Commit `feat(flow-map): global flow search`.

---

## Chunk 4: SOP Process pane + drift badges (Project only)

### Task 4.1: SOP content fetch
**Files:** Modify `src/app/api/workflow-map/route.ts` OR add `src/app/api/workflow-map/sop/[stageId]/route.ts` returning the mapped `SopSection.content` (live read via Prisma). Decision: separate lightweight endpoint so the snapshot stays SOP-free.
- [ ] Failing test: returns concatenated `SopSection.content` for `20461937` (`wf-design`+`wf-da`).
- [ ] Implement + PASS + commit.

### Task 4.2: Process pane render
**Files:** Modify `StagePanes.tsx`; create `src/components/workflow-map/ProcessPane.tsx`.
- [ ] Render sanitized SOP HTML (reuse existing SOP sanitizer/CSS from `src/app/sop/`). Only for Project pipeline stages; non-Project → "SOP pane coming soon".
- [ ] Commit.

### Task 4.3: Drift badges
**Files:** Create `src/components/workflow-map/DriftBadges.tsx`; surface `detectDrift` results (computed in the snapshot at sync time — add `drift` to each stage in the snapshot, or compute client-side from `flows`+SOP names).
- [ ] Decision: compute drift at sync time (needs SOP names) → add a `driftByStage` map to the snapshot in Task 1.6 (note: requires reading SOP names during sync; acceptable, SOP is in our DB). Adjust sync accordingly.
- [ ] Badges per stage: "N documented but off", "N live but undocumented". Click → opens the drift list.
- [ ] Commit.

---

## Chunk 5: Progression links in flow detail

### Task 5.1: Fed-by / triggers
**Files:** Create `src/components/workflow-map/ProgressionLinks.tsx`; modify `FlowDetail.tsx`.
- [ ] From snapshot `links`: "Fed by" = flows that set a value this flow reads; "Triggers" = flows that enroll on a value this flow sets. Clicking a linked flow navigates to it (sets `flowId`, adjusting `pipelineId/stageId`).
- [ ] Commit `feat(flow-map): progression links in flow detail`.

---

## Chunk 6: SOP edit-in-place (gated)

### Task 6.1: Inline editor
**Files:** Create `src/components/workflow-map/SopEditInline.tsx`; reuse the **existing** SOP section update endpoint — confirmed at `PUT /api/admin/sop/sections/[id]/route.ts` (writes the section + a `SopRevision`; gated **ADMIN || EXECUTIVE** in-route, and under the `/api/admin` prefix). Do NOT add a new write path. (`/api/sop/sections/[id]` exists but is `GET`-only — not the write path.)
- [ ] Render the editor only when `canEditSop` (ADMIN || EXECUTIVE, passed from `page.tsx` — matches the endpoint's gate so the affordance never 403s). For everyone else, no affordance (read-only).
- [ ] Edits `PUT /api/admin/sop/sections/[id]` (versioned, reversible). After save, invalidate the SOP content query (Task 4.1) so the Process pane refreshes.
- [ ] Commit `feat(flow-map): SOP edit-in-place via existing /api/admin/sop revision API`.

> **Product note for Zach:** because we reuse the existing write path, editing is **ADMIN/EXECUTIVE-only** (viewing is everyone). If you want a broader set of SOP editors, that's a change to the existing SOP endpoint's gate — out of scope here, flag it and we'll do it separately.

---

## Backfill & rollout (after merge, with Zach)

- [ ] Run the initial sync once (manual `POST /api/workflow-map/refresh` as admin, or trigger the cron) — ~855 detail calls, off-peak. Verify the snapshot populated.
- [ ] Confirm the page renders for a non-admin test role (VIEWER) read-only.
- [ ] `vercel.json` cron is live; confirm the nightly run is incremental (near-zero detail fetches next day).

## Notes for the executor
- The Python prototypes are the behavioural oracle — when porting, diff your TS output against the generated `docs/hubspot-sop-corrected-tables-2026-06-21.md` / `-progression-map.md` for spot parity.
- DRY: `fmt_filter` is shared by trigger + progression + drift; put it once in `summarize.ts` and import.
- YAGNI: no node-graph canvas, no contact/lead flows, no AI corrections (spec §3).
- TDD + frequent commits per task.
