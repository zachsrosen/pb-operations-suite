# Workflow Map — Design Spec

**Date:** 2026-06-21
**Status:** Draft for review
**Author:** Zach Rosen (with Claude)
**Related artifacts (validated prototypes this session):**
- `data/hubspot-flows/build_sop_tables.py` — trigger/action summarizer (verified: every operator HubSpot uses, all 4 enrollment types, 0 unparsed across 855 flows)
- `data/hubspot-flows/build_progression.py` — cross-flow status hand-off graph
- `data/hubspot-flows/build_worklist.py` — SOP↔automation drift detector
- `docs/hubspot-sop-corrected-tables-2026-06-21.md`, `docs/hubspot-workflow-progression-map.md`, `docs/hubspot-stage-mismatch-worklist.md` — generated outputs proving the logic

---

## 1. Problem

PB runs **933 HubSpot flows** (736 enabled). The SOP "Workflows" tab documents a stale subset under old names, with no view of what each workflow actually does, how stages progress, or where docs have drifted from reality. There is no single place to see **process (SOP) + automation (HubSpot) + progression** together, and no grounded way to keep the SOP honest as automation changes.

## 2. Goals

- A live dashboard — **viewable by any authenticated dashboard user** (it is shared process/automation reference) — that renders PB's real automation as a navigable map: **Sales → Project / D&R / Roofing / Service**, each pipeline → its real stages → the flows that fire there → a flow's actual trigger and action sequence, in plain English. Editing (SOP-in-place) stays gated to existing SOP-edit permissions.
- Show, per stage, the **documented process (live SOP)** next to the **automation**.
- Surface **evidence-backed drift** (documented-but-OFF, live-but-undocumented) so the SOP can be corrected, and let SOP-authorized users **edit the SOP in place** (reusing the existing SOP revision system + its access control).
- Show **progression**: how one flow setting a status value triggers the next flow.
- Stay current via a **gentle, incremental nightly sync** — important given known HubSpot rate-limit sensitivity.

## 3. Non-goals (YAGNI)

- No editing of HubSpot workflows (read-only mirror).
- No zoomable node-graph canvas (progressive drill-down only).
- No contact/lead/company-object flows in v1 (deal pipelines + Service ticket pipeline only).
- No AI-drafted SOP corrections (human writes corrections; tool shows grounded evidence).
- No historical/diff-over-time view.
- No DB schema migration (snapshot lives in `SystemConfig`).

## 4. Architecture overview

```
HubSpot Automation v4 API ──(nightly, incremental)──> sync job
                                                         │ builds
                                                         ▼
                                    SystemConfig row `hubspot_flow_map` (JSON snapshot)
                                                         │ read whole
                          GET /api/workflow-map ─────────┤
                                                         ▼
                              /dashboards/workflow-map (React, drill-down)
                                   │ Process pane reads live SopSection (DB)
                                   │ Edit-in-place writes via existing SOP revision API
```

Rationale for the `SystemConfig` snapshot (not a new Prisma model): the map is read as a whole, refreshed once daily, and a new model would require a manual production migration (per project policy `prisma migrate deploy` is run manually and is high-friction). The EagleView stamp flag uses the same `SystemConfig` pattern. The blob is ~1–2 MB; acceptable for one shared read route.

## 5. Data model — `SystemConfig.hubspot_flow_map` (JSON)

```ts
type FlowMapSnapshot = {
  generatedAt: string;                 // ISO; set by the sync at write time
  pipelines: Pipeline[];               // deal + ticket pipelines, with ordered stages
  stageLookup: Record<string, { pipelineId: string; pipelineLabel: string; stageLabel: string; order: number }>;
  flows: Record<string, FlowEntry>;    // keyed by flow id
  links: ProgressionLink[];            // status-driven cross-flow hand-offs
};

type FlowEntry = {
  id: string;
  name: string;
  isEnabled: boolean;
  objectTypeId: string;                // "0-3" deal, "0-5" ticket, etc.
  enrollmentType: "LIST_BASED" | "EVENT_BASED" | "MANUAL" | "DATASET";
  stageIds: string[];                  // stages this flow enrolls AT (inclusion only)
  trigger: string;                     // PLAIN (default): "When … while the deal is in …", labels + narrative, readable length
  triggerTechnical: string;            // TECHNICAL: raw internal property names, raw operators, internal enum values, FULL untruncated chain
  actions: string[];                   // PLAIN steps in execution order, incl. conditionals, truncated for readability
  actionsTechnical: string[];          // TECHNICAL: actionTypeId + property=value, full sequence, no truncation
  sets: { property: string; label: string; value: string }[];  // status writes (0-5 static-value actions)
  reads: { property: string; label: string; value: string }[]; // NON-stage status values this flow enrolls on
                                                                // (stage enrollment is tracked separately in stageIds)
  cloneCount: number;                  // collapsed (#1)…(#N) siblings
  revisionId: string;                  // for incremental diffing
  hubspotUrl: string;                  // deep link to the flow in HubSpot
};

type ProgressionLink = {
  property: string; label: string; value: string;
  setBy: string[];    // flow ids/names that set property=value
  firesFlows: string[]; // flow ids/names that enroll on property=value
};
```

## 6. Sync job

**Entry:** `/api/cron/workflow-map-sync` (Vercel cron, nightly). Also `POST /api/workflow-map/refresh` for a manual run — **admin-gated** (it is API-heavy; viewers can read but not trigger a resync).

**Steps:**
1. `GET /automation/v4/flows?limit=100` (paginate; ~10 calls) → current list with `revisionId`, `isEnabled`, `name`, `objectTypeId`.
2. Load existing snapshot from `SystemConfig`. Diff by `revisionId`. Fetch `GET /automation/v4/flows/{id}` **only** for new/changed flows (initial backfill fetches all 0-3 + 0-5; ~855 calls, throttled).
3. `GET /crm/v3/pipelines/{deals,tickets}` → pipeline/stage definitions.
4. `GET /crm/v3/properties/{deals,tickets}` → property `name → label` and enum `value → label` maps (for plain-English rendering).
5. For each flow detail: run the **summarizer** (§7) to produce `stageIds`, `trigger`, `actions`, `sets`, `reads`.
6. Build `links` (§9). Write the whole snapshot to `SystemConfig` with `generatedAt`.

**Throttling/limits:** token-bucket + exponential backoff on 429 (mirror existing `searchWithRetry`). Incremental diffing keeps steady-state daily cost near zero. If the run exceeds the function time budget, it is resumable: the per-flow detail cache is persisted in a **companion `SystemConfig` row** (`hubspot_flow_detail_cache`, keyed by flow id → `{revisionId, parsed FlowEntry}`), not held in memory — so a re-invocation only fetches ids that are still new/changed. The live `hubspot_flow_map` snapshot is only overwritten once a full rebuild completes. Quota guard: abort + keep last good snapshot on repeated 429s (do not partially overwrite).

**Library:** port the validated Python (`build_sop_tables.py`, `build_progression.py`) to `src/lib/flow-map/` (`client.ts`, `summarize.ts`, `progression.ts`, `sync.ts`). The Python is the reference implementation; behavior must match its verified output.

## 7. Summarizer (verified logic)

**Stage mapping.** A flow maps to a stage when an enrollment **inclusion** filter (`IS_ANY_OF`/`IS_EQUAL_TO`/`HAS_EVER_BEEN_*`) on a stage property (`dealstage`, `hs_pipeline_stage`, or event `hs_value`) matches a known stage id. Exclusion filters (`IS_NONE_OF`, etc.) never map. Flows with no stage match → **Cross-cutting** bucket. Stage ids are globally unique, so a flow may map to several stages/pipelines.

**Trigger (plain English).** Lead with the real condition; stage is context.
- Enrollment is `listFilterBranch` (OR of AND-branches). Stage filters → "while the deal is in X". Non-stage filters → conditions, rendered via property labels and enum option labels.
- Task-completion pattern (`hs_task_subject` + `hs_task_status = COMPLETED`) collapses to `the task "<subject>" is completed`.
- `EVENT_BASED`: `hs_name`/`hs_value` → "When <Property> changes to <values>"; custom event filters → rendered conditions; bare event → "a tracked HubSpot event fires".
- `MANUAL` → "Manually enrolled"; `DATASET` → "Dataset-driven"; filter-less LIST_BASED → fall back to re-enrollment-trigger conditions.
- **Every operator** handled (incl. `IS_UNKNOWN`→"is blank", `IS_BETWEEN`/`IS_NOT_BETWEEN` with `UPDATED_AT`→"hasn't changed in N days", `IS_BEFORE`→"more than N days ago", numerics, `CONTAINS`). Coverage is asserted in tests (§11).

**Actions (plain English, execution order).** Walk the action graph from `startActionId` following `connection.nextActionId`; render `LIST_BRANCH`/`STATIC_BRANCH` as `if <condition> → <branch>; otherwise <continue>`. Action kinds by `actionTypeId`: `0-5` set/stamp property (enum values via option labels), `0-3` create task, `0-1` wait, `0-8` internal alert, `1-27489890` webhook, `0-4` email, `0-14` create record, `0-169425243` note, `0-11` assign owner, `0-63189541` association, `0-15` enroll-in-workflow.

**Plain vs technical (two renderings).** Every flow gets both forms, stored in the snapshot:
- **Plain (default):** HubSpot property *labels*, enum *option labels*, narrative phrasing, truncated to readable length (the "+N more" summary). This is what a non-technical reader sees.
- **Technical:** raw internal property names, raw operator names, internal enum values, `actionTypeId`s, and the **full untruncated** condition/action chain — for troubleshooting.

The summarizer produces both from the same parse (the existing functions already have plain rendering; technical is the same walk without label substitution or truncation). The UI toggles between them client-side — no re-fetch.

## 8. SOP integration (per-stage process)

**v1 scope: Project pipeline only.** Process panes are shown only for Project Pipeline stages. D&R, Roofing, and the Service ticket pipeline show the Automation view (flows + drill-down) but **no SOP Process pane in v1** — they are a fast follow once Project is proven.

**Curated `stageId → sopSectionId[]` map (Project):**

| Stage (id) | SOP section(s) |
|---|---|
| Site Survey (`20461936`) | `wf-survey` |
| Design & Engineering (`20461937`) | `wf-design`, `wf-da` — the main design + design-approval process |
| Permitting & Interconnection (`20461938`) | `wf-permit`, `wf-ic` |
| Construction (`20440342`) | `wf-con` |
| Inspection (`22580872`) | `wf-insp` |
| Permission To Operate (`20461940`) | `wf-pto` |
| Ready To Build (`22580871`), Close Out (`24743347`) | none — Automation only; flag as an SOP gap |

- **Revisions** (`wf-rev-da/permit/ic/ab`): the revision cycles are **design-owned**, so the Design & Engineering stage pane links them as "Design team revision process," but they are flagged **cross-stage** (a revision can be entered from Permitting, Inspection, etc.). They are not pinned to a single stage's automation list.
- **Quality Flow** (`wf-qr`): **cross-cutting** (90-day-stuck detection fires across stages), surfaced in the Cross-cutting bucket, not under one stage.
- The Process pane reads **live** `SopSection.content` from the DB (same content `/sop` serves) — never copied into the snapshot, so it stays authoritative and editable in one place.
- The `stageId → sopSectionId` map is the only hand-maintained config; documented in code with a comment explaining the many-to-one and cross-stage cases above.

## 9. Drift detection (evidence-backed)

Per stage, compare the workflow names referenced in the mapped `SopSection` content (extracted from its `<code>`/table cells) against the live flows mapped to that stage:
- **Documented but OFF/missing** — SOP names a workflow with no enabled live match.
- **Live but undocumented** — an enabled flow at this stage the SOP never names.
Every flag traces to a concrete flow name/id — no inference. Shown as badges per stage; clicking a flag is the entry point to edit-in-place.

## 10. Progression map

From the snapshot's `sets`/`reads`: build `ProgressionLink[]` for each `(property, value)` that is **set by ≥1 flow and read by ≥1 flow** (a hand-off). Restrict to status-type properties (exclude dates, ids, `hs_*` internals, `dealstage`). Surfaced in flow detail as **"fed by"** (flows that set a value this flow enrolls on) and **"triggers"** (flows that enroll on a value this flow sets).

## 11. API routes

- `GET /api/workflow-map` → returns the `SystemConfig` snapshot (404/empty-state if never synced). **Read-only; available to every authenticated dashboard user.**
- `POST /api/workflow-map/refresh` → triggers a sync. **Admin-gated** (rate-limited; returns job status).
- `GET /api/cron/workflow-map-sync` → cron entry (existing cron auth).
- SOP edit reuses the **existing** SOP section update endpoint `PUT /api/admin/sop/sections/[id]` + `SopRevision` flow (no new write path). The endpoint has an in-route ADMIN||EXECUTIVE check, but the `/api/admin` middleware prefix gate blocks every non-ADMIN role before that in-route check runs (a pre-existing platform constraint — the existing /sop editor has the same gate). So **editing is ADMIN-only** in practice; viewing is everyone. (Broadening SOP-edit rights is a change to that existing endpoint + middleware — out of scope for this feature.)

**Access wiring (per project policy — new routes must be allow-listed or middleware 403s silently):**
- The page `/dashboards/workflow-map` and `GET /api/workflow-map` are added to **every role's** `allowedRoutes` in `src/lib/roles.ts` (all authenticated dashboard users can view). `VIEWER` included.
- `POST /api/workflow-map/refresh` is **not** broadly allow-listed — added to `ADMIN_ONLY_ROUTES` (admin only).
- **Placement:** surfaced as a card on the suites where process matters (Operations, Design & Engineering, Permitting & Interconnection, Service, D&R + Roofing, Intelligence) and reachable via global search. Because the route is allow-listed for all roles, no suite-card-implies-route 403 risk.

## 12. UI

`/dashboards/workflow-map`, wrapped in `DashboardShell`. Client component holds drill state + breadcrumb. Data via React Query against `GET /api/workflow-map`. The edit-in-place affordance renders for **ADMIN only** — the `/api/admin` middleware prefix gate blocks EXECUTIVE before the SOP write route's in-route ADMIN||EXECUTIVE check runs, so showing the affordance to EXECUTIVE would mean a 403 on Save (a pre-existing platform constraint; the existing /sop editor has the same gate). Everyone else sees the map read-only.

- **L1 Pipelines:** cards — Sales at top branching (arrow) to Project (hero) / D&R / Roofing / Service — each with ON/OFF flow counts.
- **L2 Stages:** selected pipeline's stages in display order + a Cross-cutting bucket. Per-stage drift badges.
- **L2 detail panes:** **Process** (live SOP HTML for the stage — Project pipeline only in v1) | **Automation** (flows at the stage, clones collapsed, ON/OFF — all pipelines). For non-Project pipelines, only the Automation pane shows in v1.
- **L3 Flow detail:** plain-English trigger + action steps; "fed by"/"triggers" progression links; deep link to HubSpot.
- **Plain / Technical toggle:** page-level switch, **default Plain**, persisted in `localStorage`. Plain = narrative + property labels (the whole page reads like prose for non-technical staff). Technical = reveals internal property names, raw operators/enum values, `actionTypeId`s, flow id + `revisionId`, the HubSpot deep link, and the full untruncated condition chains. Default keeps the page approachable; the detail is one click away for whoever's debugging an automation.
- **Search:** client-side filter across all flows (name/trigger/action).
- **Edit-in-place (final slice):** from a drift flag or the Process pane, inline-edit the `SopSection` via the existing SOP revision API (versioned, reversible).

## 13. Build slices

1. Sync lib + `SystemConfig` snapshot + cron + backfill (port & match the verified Python).
2. `GET /api/workflow-map` + all-roles allowlist; `POST .../refresh` admin-gated.
3. UI drill-down (L1–L3) + flow detail + search + Plain/Technical toggle (default Plain).
4. SOP Process pane + drift badges.
5. Progression links in flow detail.
6. Edit-in-place (reuses SOP revision API).

MVP = slices 1–5 (read-only map). Slice 6 last (lowest risk; reuses existing write path).

## 14. Testing

- **Summarizer unit tests** against the id-named fixtures in `data/hubspot-flows/detail/` (the canonical fixture dir; the few top-level `detail-<id>.json` files are early one-offs and are superseded by `detail/<id>.json`). Assert: every operator HubSpot uses render (no generic fallback), all 4 enrollment types produce non-empty triggers, execution-order action walk handles `LIST_BRANCH` (`detail/451599947.json` = `02. DA Flow - DA Sent for Approval`, the conditional fixture). Mirrors the coverage audit already passing in `build_sop_tables.py`.
- **Stage-mapping tests:** inclusion-only (a flow that only excludes "Cancelled" must NOT map to Cancelled).
- **Progression tests:** `layout_status = "Sent For Approval"` links `PandaDoc DA Sent`/`02. DA Flow` → `03. DA Flow - DA Follow Up Task`.
- **Sync tests:** incremental diff (unchanged `revisionId` → no detail fetch); 429 → keep last good snapshot.
- **Route/role tests:** any authenticated role can `GET /api/workflow-map` (incl. VIEWER); unauthenticated → redirect; `POST /api/workflow-map/refresh` as non-admin → 403; edit-in-place affordance hidden for non-ADMIN (matches the effective ADMIN-only gate from the `/api/admin` middleware prefix).

## 15. Risks / open questions

- **HubSpot rate limits** during initial backfill (~855 detail calls). Mitigation: throttle + resumable + run backfill off-peak; steady state is incremental.
- **`stageId → sopSectionId` map** is hand-maintained; new pipelines/stages need a one-line addition. Acceptable; documented.
- **Snapshot size** (~1–2 MB in `SystemConfig`). Acceptable for one shared read route; revisit if it grows.

**Resolved (were open):**
- SOP section layout for the Design & Engineering stage = `wf-design` + `wf-da`; revisions are design-owned but cross-stage; Quality Flow is cross-cutting (§8).
- v1 Process panes are **Project-pipeline only**; D&R / Roofing / Service show Automation only and get SOP panes as a fast follow (§8).
