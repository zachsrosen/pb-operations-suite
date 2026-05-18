# PE Action Tasks Cross-Reference — Design Spec

**Date:** 2026-05-18
**Author:** Claude + Zach
**Status:** Draft
**Teams:** Project Management, Accounting, Operations Manager
**Related:** [`docs/superpowers/specs/2026-05-16-pe-file-prep-design.md`](./2026-05-16-pe-file-prep-design.md), [`docs/superpowers/specs/2026-05-06-powerhub-integration-design.md`](./2026-05-06-powerhub-integration-design.md)

## Problem

The PE audit (shipped via the PE File Preparation spec) tells a PM whether each PE checklist item is "found", "missing", "needs review", or "N/A". That's useful but shallow. A real PE submission readiness check requires multi-source cross-references: planset model numbers vs Sales Order line items, Tesla PowerHub asset state vs install nameplate photo, photo content vs the PE category it's filed under, and follow-up tracking for things like corrected PowerHub screenshots and Enphase account access.

PMs currently run this cross-reference manually — pulling planset PDFs, Zoho SO line items, PowerHub screenshots, install photos, and comparing them by eye, then writing up a per-deal action task list. The artifact at `~/Downloads/PE-Turnover/PE_Action_Task_List_2026-05-17.pdf` is a representative example: 28 projects, 118 distinct action tasks, grouped by priority code (P1–P11), with specific actionable instructions like:

- "P1 WRONG HARDWARE: Confirmed 11-M (SN: TG12530600006T5, 'LEADER' sticker). PowerHub WRONG shows 21-M."
- "P7 SO FIX: Change 'Powerwall 3 (USA module)' to 'Tesla 1707000-21-Y', remove 11-J note on SO-9043."
- "P10 PLANSET: Revise PW3 model XX-Y to 21-Y on PV-5 (p6) (specs box + schematic labels)."
- "P11B PHOTO [CONDITIONAL]: Photo_09 shows house front, not storage wide angle. Re-file correct photo."

Doing this by hand for 28+ active PE deals every cycle is unsustainable.

## Goal

Automate the equipment cross-reference. Produce per-deal action task lists that match the depth and specificity of the manual artifact, surface them on the PE Prep page and a new PE Action Queue dashboard, and let PMs work through tasks with auto-resolution when source data is fixed.

## Scope

### In scope

- New `pe-crossref` subsystem decoupled from the existing PE audit
- Structured extractors for: planset (vision), Zoho SO (API), PowerHub (API), install-photo nameplates (vision), M1 folder scan (Drive API)
- Five analyzers, one per P-code family:
  - HardwareAnalyzer (P1, P6)
  - SalesOrderAnalyzer (P2, P3, P4, P5, P7, P8, P9)
  - PlansetAnalyzer (P10, P10B, P10C)
  - PhotoCritiqueAnalyzer (P11B) — only analyzer that calls LLM at detect time
  - MonitoringAnalyzer (MONITORING, ENPHASE)
- Persistent task model with identity-based reconciliation across re-runs
- Manual resolve / dismiss state machine
- API routes for task lifecycle
- Per-deal "Action Tasks" panel on `/dashboards/pe-prep/[dealId]`
- New `/dashboards/pe-action-queue` batch dashboard
- Auto-trigger after audit completion (async, separate request)
- Role allowlist updates

### Out of scope

- Modifying upstream sources (no Zoho SO writeback, no PowerHub updates, no planset edits — tasks describe required actions, PM acts in the source system)
- Real-time monitoring or alerts (PMs check the dashboard on their cadence)
- Cross-deal "rollup" insights beyond what filters provide
- Mobile-first UI tuning (existing desktop responsive patterns suffice)

## Architecture

```
[Audit completes]  OR  [PM clicks "Re-run cross-ref"]  OR  [Batch dashboard "Refresh all"]
                                     │
                                     ▼
                  ┌──────────────────────────────────────────┐
                  │  runCrossReference(dealId, triggeredBy)  │
                  │                                          │
                  │  Stage 1 — Build context (parallel)      │
                  │   ├── extractPlansetStructure  (Sonnet)  │
                  │   ├── fetchZohoSalesOrder      (API)     │
                  │   ├── fetchPowerHubAsset       (API)     │
                  │   ├── extractInstallNameplates (Sonnet)  │
                  │   └── scanM1MonitoringFolder   (Drive)   │
                  │                                          │
                  │  Stage 2 — Run analyzers (parallel)      │
                  │   ├── HardwareAnalyzer       → P1, P6    │
                  │   ├── SalesOrderAnalyzer  → P2-P5, P7-P9 │
                  │   ├── PlansetAnalyzer      → P10/B/C     │
                  │   ├── PhotoCritiqueAnalyzer    → P11B    │
                  │   └── MonitoringAnalyzer → MONITORING,   │
                  │                              ENPHASE     │
                  │                                          │
                  │  Stage 3 — Reconcile detected vs DB      │
                  │   - same identityKey + status=OPEN→keep  │
                  │   - same identityKey + RESOLVED_MANUAL   │
                  │     AND re-detected   →flip to OPEN      │
                  │   - same identityKey + DISMISSED→stays   │
                  │   - prior OPEN no longer detected        │
                  │                       →RESOLVED_AUTO     │
                  │   - new identity      →create OPEN       │
                  └─────────────┬────────────────────────────┘
                                ▼
                       PeActionTask rows (DB)
                                │
                ┌───────────────┴─────────────────┐
                ▼                                 ▼
       PE Prep detail page              PE Action Queue dashboard
       Per-deal Tasks panel             /dashboards/pe-action-queue
```

### Module layout

```
src/lib/pe-crossref/
├── index.ts                    — public entry: runCrossReference(dealId, opts)
├── types.ts                    — DetectedTask, CrossRefContext, analyzer interface
├── context.ts                  — buildCrossRefContext() pulls extractors in parallel
├── reconciler.ts               — diffs detected tasks vs existing PeActionTask rows, mutates DB
├── extractors/
│   ├── planset.ts              — extractPlansetStructure(plansetFileId) → { specsByPage }
│   ├── sales-order.ts          — fetchZohoSalesOrder(dealId) → ZohoSalesOrder normalized
│   ├── powerhub.ts             — fetchPowerHubAsset(dealId) → PowerHubAsset | null
│   ├── nameplate.ts            — extractInstallNameplates(photo) → NameplateData
│   └── monitoring-folder.ts    — scanM1MonitoringFolder(folderId) → { corrected, enphaseFlag }
└── analyzers/
    ├── hardware.ts             — P1, P6
    ├── sales-order.ts          — P2-P5, P7-P9
    ├── planset.ts              — P10, P10B, P10C
    ├── photo-critique.ts       — P11B (uses LLM)
    └── monitoring.ts           — MONITORING, ENPHASE

src/app/api/pe-crossref/
├── [dealId]/run/route.ts       — POST: trigger cross-ref (SSE stream)
├── [dealId]/tasks/route.ts     — GET:  list tasks for one deal
├── tasks/[taskId]/route.ts     — PATCH: resolve | dismiss | reopen
├── queue/route.ts              — GET: aggregate across deals, with filters
└── queue/bulk/route.ts         — PATCH: bulk task status update

src/app/dashboards/pe-action-queue/
└── page.tsx                    — cross-deal table view

src/components/pe-prep/
└── PeActionTasksPanel.tsx      — per-deal panel embedded on PE Prep detail page

prisma/migrations/.../
└── add_pe_action_task.sql      — new tables
```

Each extractor and analyzer is a pure function — easy to unit-test with fixture data. The orchestrator (`index.ts`) coordinates parallelism and is the only async-orchestration layer.

## Data Model

Two new Prisma models. Tasks are first-class rows (not nested JSON) so they're queryable for the batch dashboard and survive across runs.

```prisma
model PeActionTask {
  id              String   @id @default(cuid())
  dealId          String

  // Identity (composed by analyzer) used for re-run reconciliation.
  // Same identity across runs = same task.
  // Versioning prefix: e.g. "P10@v1:..." allows future analyzer rule changes
  // without orphaning historical tasks.
  identityKey     String

  pCode           String   // "P1" | "P10B" | "MONITORING" | "ENPHASE"
  severity        String   // "critical" | "major" | "conditional" | "monitoring"
  category        String   // "hardware" | "so" | "planset" | "photo" | "monitoring"
  analyzer        String   // module name for debug / filter (e.g. "HardwareAnalyzer")

  // Content
  title           String   // short label
  message         String   // PM-visible description
  action          String   // suggested next step
  evidence        Json     // analyzer-specific structured payload

  // State machine
  status          String   // "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED"
  resolvedBy      String?  // "auto" | userEmail
  resolvedAt      DateTime?
  manualResolvedAt DateTime?  // separate from resolvedAt so we can show
                              // "PM resolved 2 days ago, then re-flagged"
  dismissedReason String?

  // Run tracking
  firstSeenRunId  String?
  lastSeenRunId   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([dealId, identityKey])
  @@index([dealId, status])
  @@index([severity, status])
  @@index([category, status])
  @@index([pCode])
}

model CrossRefRun {
  id              String   @id @default(cuid())
  dealId          String
  status          String   // "running" | "completed" | "failed"
  triggeredBy     String   // "audit-completion" | "manual:userEmail" | "batch-refresh"
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  durationMs      Int?

  // Counts for the run
  detectedCount   Int      @default(0)
  newCount        Int      @default(0)
  resolvedCount   Int      @default(0)

  // Per-extractor success/failure for debug
  extractorResults Json?   // { planset: "ok", powerhub: "error: timeout" }

  errorMessage    String?
  createdAt       DateTime @default(now())

  @@index([dealId, startedAt])
}
```

### State machine

| Status | Re-run STILL detects | Re-run does NOT detect |
|---|---|---|
| `OPEN` | stays `OPEN` (`lastSeenRunId` updated) | → `RESOLVED_AUTO` |
| `RESOLVED_AUTO` | → `OPEN` (regressed) | stays `RESOLVED_AUTO` |
| `RESOLVED_MANUAL` | **→ `OPEN`** (source still wrong despite PM marking done) | stays `RESOLVED_MANUAL` |
| `DISMISSED` | stays `DISMISSED` (PM declared N/A — permanent) | stays `DISMISSED` |

**Manual resolve** = "I did this, don't keep showing it in my queue *unless* the next run validates it's still broken." Source data wins on re-runs.

**Dismiss** = "This rule doesn't apply to this deal." Permanent — re-runs do not change this state.

### Identity key examples

| P-code | Identity composition |
|---|---|
| P1 wrong hardware | `P1@v1:powerhub:{powerhubModel}:nameplate:{nameplateModel}` |
| P1 photo missing | `P1@v1:no-nameplate-photo` |
| P6 powerhub mixed | `P6@v1:powerhub:mixed:{sortedModels}` |
| P7 SO PW3 text | `P7@v1:so:{soNumber}:line:{lineIdx}:pw3-text` |
| P9 SO BS generic | `P9@v1:so:{soNumber}:line:{lineIdx}:bs-generic` |
| P10 planset PW3 generic | `P10@v1:planset:{fileId}:pw3-generic:p{page}` |
| P11B photo wrong subject | `P11B@v1:photo:{checklistId}:{photoFileId}` |
| MONITORING | `MONITORING@v1:m1-folder:powerhub-corrected` |
| ENPHASE | `ENPHASE@v1:account-access` |

Source data changes (e.g. SO line item edited from "1707000-XX-Y" to "1707000-21-Y") → new run no longer emits the prior identity → reconciler auto-resolves it.

## Analyzers

Each implements the same interface:

```ts
interface Analyzer {
  readonly name: string;
  readonly version: string;  // for identityKey versioning
  detectTasks(context: CrossRefContext): Promise<DetectedTask[]>;
}

interface DetectedTask {
  pCode: string;
  identityKey: string;
  severity: "critical" | "major" | "conditional" | "monitoring";
  category: "hardware" | "so" | "planset" | "photo" | "monitoring";
  title: string;
  message: string;
  action: string;
  evidence: Record<string, unknown>;
}
```

### HardwareAnalyzer (P1, P6)

**Inputs:** `context.powerHubAsset`, `context.nameplateExtractions`

| Rule | Detection | Severity |
|---|---|---|
| P1 WRONG HARDWARE | `nameplate.pw3Model !== powerHub.pw3Model && both present` | critical |
| P1 NEEDS VERIFICATION | PowerHub data present, no nameplate photo extracted | major |
| P6 POWERHUB MIXED | PowerHub returns ≥2 PW3 variants for the site | critical |

If PowerHub data is missing entirely (e.g. `POWERHUB_ENABLED=false`), HardwareAnalyzer skips all rules and the run's `extractorResults.powerhub` records the cause.

### SalesOrderAnalyzer (P2, P3, P4, P5, P7, P8, P9)

**Inputs:** `context.salesOrder`, `context.planset`

| Rule | Detection | Severity |
|---|---|---|
| P2 SO WRONG CUSTOMER | `so.contact.name` doesn't match `deal.customer` | critical |
| P2 SO INCOMPLETE | PW3 present in SO but BS / MSP / electrical missing while planset has them | critical |
| P3 ADD PW3 | `planset.pw3 && !so.lineItems.some(matchesPw3)` | major |
| P4 ADD INVERTER | `planset.inverter && !so.lineItems.some(matchesInverter)` | major |
| P5 SCOPE MISMATCH | module brand differs OR qty differs between planset and SO | major |
| P7 PW3 LEGACY TEXT | SO description contains "Powerwall 3 (USA module)" or "-11-J" | conditional |
| P8 PW3 GENERIC SKU | SO description contains "1707000-XX-Y" | conditional |
| P9 BS GENERIC | BS line description not equal to "1624171-00-E" | conditional |

Skips if `context.salesOrder` is null (no Zoho linkage).

### PlansetAnalyzer (P10, P10B, P10C)

**Inputs:** `context.planset.specsByPage`

The PlansetExtractor uses Sonnet vision to read the electrical specs box and schematic labels on each PV page of the planset. It returns:

```ts
type ExtractedPlanset = {
  fileId: string;
  specsByPage: Array<{
    page: number;
    pw3Model: string | null;       // e.g. "1707000-XX-Y" or "1707000-21-Y"
    bsModel: string | null;        // e.g. "1624171-00-E" or "1624171-XX-Y"
    expansionUnitModel: string | null;
    moduleBrand: string | null;
    moduleQty: number | null;
    inverterModel: string | null;
  }>;
};
```

| Rule | Detection |
|---|---|
| P10 PW3 GENERIC | any `specsByPage[i].pw3Model === "1707000-XX-Y"` |
| P10B BS GENERIC | any `specsByPage[i].bsModel === "1624171-XX-Y"` (or anything not equal to "1624171-00-E" when PE requires specificity) |
| P10C EXP GENERIC | any `specsByPage[i].expansionUnitModel === "1807000-XX-Y"` |

Identity composed per page so a deal with the issue on PV-4 AND PV-5 emits two tasks.

### PhotoCritiqueAnalyzer (P11B)

**Inputs:** photo-to-checklist assignments from existing audit triage (`auditRun.results[...].items[...].foundFile` for `isPhoto` items)

For each assigned photo, ask Sonnet: "Does this photo actually depict {expected subject from checklist label}?" Verdict `fail` with reason mentioning wrong subject → emit P11B.

This is the only analyzer that calls the LLM at detect time. Cache key is `photoFileId` — if the file ID hasn't changed since the last critique, reuse the prior verdict.

Skips entirely if no audit has ever run for the deal.

### MonitoringAnalyzer (MONITORING, ENPHASE)

**Inputs:** `context.monitoringFolder`, `context.planset`

| Rule | Detection |
|---|---|
| MONITORING | M1 folder contains a file matching `/PowerHub.*corrected/i` with `modifiedTime` newer than the original PowerHub screenshot | Action: "Re-upload corrected screenshot to PE portal" |
| ENPHASE | `planset.inverterBrand === "Enphase"` AND no monitoring screenshot in M1 folder | Action: "Capture Enphase Enlighten monitoring screenshot, save to M1 folder" |

No LLM. Deterministic file-pattern + metadata check.

## UI Surfaces

### Per-deal panel on PE Prep detail page

New section below the existing checklist sections on `/dashboards/pe-prep/[dealId]`.

```
ACTION TASKS                                       [↻ Re-run cross-ref]
Last computed: 4 min ago by audit-completion          2 critical · 5 major · 3 conditional · 2 monitoring

▼ Critical (2)
  ┌─────────────────────────────────────────────────────────────────┐
  │ [P1] WRONG HARDWARE                          [✓ Resolve] [✗]    │
  │ Confirmed 11-M (SN: TG12530600006T5, "LEADER" sticker).         │
  │ PowerHub WRONG shows 21-M.                                      │
  │ → Correct PowerHub to 11-M (or update after swap).              │
  │ Evidence: [10__Storage_Nameplate_*.jpg ↗] [PowerHub asset ↗]    │
  └─────────────────────────────────────────────────────────────────┘
▼ Major (5) ...
▼ Conditional (3) ...
▼ Monitoring (2) ...
▶ Resolved (8) — click to expand
```

Tasks that flipped from `RESOLVED_MANUAL` back to `OPEN` because a re-run still detected them get a `↻ Re-flagged after manual resolve` badge so PMs see when their action didn't stick.

### `/dashboards/pe-action-queue` batch dashboard

A new card in the PE & Compliance suite linking here.

- Stat tiles: # open critical, # open major, # deals affected, # resolved this week
- Filter chips: severity, P-code, deal stage, location, status (open / resolved / dismissed)
- Table: deal name | P-code badge | message snippet | severity | last detected | actions
- Bulk actions: select N tasks → "Resolve all" or "Dismiss all"
- Group toggle: by deal (matches the PDF) | by P-code | flat
- Each row links to `/dashboards/pe-prep/[dealId]` for the full context

## API Routes

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/pe-crossref/[dealId]/run` | POST | Trigger cross-ref (SSE response stream) | session + role |
| `/api/pe-crossref/[dealId]/tasks` | GET | List tasks for one deal | session + role |
| `/api/pe-crossref/tasks/[taskId]` | PATCH | Update status (resolve / dismiss / reopen) | session + role |
| `/api/pe-crossref/queue` | GET | Aggregate across deals, with filter params | session + role |
| `/api/pe-crossref/queue/bulk` | PATCH | Bulk status update | session + role |

### Auto-trigger

After `runPeAudit` marks `auditRun.status = "completed"` AND `mode in ("full", "docs")`, the orchestrator fires `POST /api/pe-crossref/{dealId}/run` async (`void fetch(...)`, no await) using the existing `API_SECRET_TOKEN` machine-auth header. Failures inside cross-ref are logged but never fail the audit.

The PE Prep UI subscribes to the cross-ref SSE stream when open and live-updates the panel as analyzers complete.

## Role Allowlist Changes

Per the `feedback_api_route_role_allowlist` memory note: every new `/api/*` route needs to be added to every role's `allowedRoutes` in `src/lib/roles.ts`, and every dashboard that surfaces it needs explicit suite-card visibility.

Add `/api/pe-crossref` and `/dashboards/pe-action-queue` to:

- PROJECT_MANAGER
- OPERATIONS_MANAGER
- ACCOUNTING

ADMIN, EXECUTIVE, OWNER cover them via wildcard `["*"]`.

The PE Action Queue card joins the PE & Compliance suite at `src/app/suites/pe-compliance/page.tsx`.

## Performance & Cost

Per-deal cross-ref budget (within Vercel 300s):

| Stage | Wall time | Vision calls |
|---|---|---|
| Planset structured extract | 10–15s | 1 |
| SO fetch (Zoho) | ~1s | 0 |
| PowerHub fetch | ~1s | 0 |
| Nameplate extract (photos 7, 10) | 5–10s | 2 |
| M1 folder scan (Drive) | ~1s | 0 |
| Photo critique (assigned photos only) | 10–15s | 1 batch |
| Analyzer execution | <1s | 0 |
| Reconciler DB writes | ~1s | 0 |
| **Total** | **~30–45s** | **~4 per deal** |

Batch dashboard's "Refresh all" fires one independent cross-ref request per deal (not a single batched request) so each stays inside the 300s budget. Run history is shown in the dashboard so PMs see when each deal was last computed.

Caches:
- Planset structured extraction keyed by `(plansetFileId, plansetSize, modifiedTime)` — same planset → reuse extraction
- Nameplate extraction keyed by `photoFileId`
- Photo critique verdicts keyed by `(photoFileId, expectedCategory)`

## Risks & Open Questions

1. **PhotoCritique cost** — naive re-runs across 28 deals × 11 photos = 308 calls. Mitigated by `photoFileId` caching; only changed photos re-critique.
2. **PowerHub flag** — when `POWERHUB_ENABLED=false`, HardwareAnalyzer's P1 / P6 rules have no comparator. Skip gracefully + diagnostic in `extractorResults.powerhub`.
3. **Planset OCR scope** — most plansets are 50+ pages but only PV pages (typically 4–8) carry the specs box. PlansetExtractor must locate those pages, not OCR everything.
4. **Identity drift** — if an analyzer changes how it composes `identityKey`, old OPEN tasks become orphans. Identity prefixed with analyzer version (`P10@v1:...`) — explicit migration when bumping.
5. **Cross-ref before any audit exists** — PhotoCritique depends on audit triage assignments. If no audit has run, skip P11B detection (other analyzers still work).
6. **Manual resolve gets re-flagged immediately** — UX risk: PM marks task done, next auto-cross-ref (within a minute) re-detects, task pops back to OPEN before PM has time to act. Mitigation: cross-ref auto-trigger only fires after audit completion (not on every minor save), and the re-flagged badge clarifies what happened.

## Testing Strategy

- Unit tests per extractor with mocked external clients (Sonnet, Zoho, PowerHub, Drive)
- Unit tests per analyzer with fixture `CrossRefContext` objects — pure functions, no I/O
- Integration test that runs the full pipeline against a known-bad fixture deal (Brownell synthetic data) and asserts the expected task identities
- Reconciler unit tests covering all state-transition combinations (OPEN→AUTO, AUTO→OPEN, MANUAL→OPEN, DISMISSED→stays, etc.)
- API route tests: auth, role-gated access, task lifecycle PATCH semantics

## Implementation Phasing

| Phase | Scope | Effort |
|---|---|---|
| 1 | Schema + module skeleton + API routes + empty UI panel | ~1 day |
| 2 | MonitoringAnalyzer (simplest; validates pipeline E2E) | ~1 day |
| 3 | HardwareAnalyzer (P1, P6) + nameplate extractor | ~2 days |
| 4 | SalesOrderAnalyzer (P2-P5, P7-P9) + SO extractor | ~3 days |
| 5 | PlansetAnalyzer (P10, P10B, P10C) + planset extractor | ~3 days |
| 6 | PhotoCritiqueAnalyzer (P11B) | ~1 day |
| 7 | `/dashboards/pe-action-queue` batch dashboard | ~1.5 days |
| 8 | Auto-trigger hook in audit completion + per-deal panel polish | ~0.5 day |

Total ~13 days of focused work. Phases 1, 2, and 7 give a working end-to-end MVP at ~3.5 days that can be iterated on while remaining phases land.
