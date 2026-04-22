# Pricing & Adder Governance — Design Spec

**Date:** 2026-04-22
**Status:** Draft
**Author:** Zach + Claude

## Problem

Pricing accuracy is a known pain point at PB, surfacing in two tightly-linked ways:

1. **Sales quoting inconsistency.** Reps quote in OpenSolar, which has an adder library, but the library is ungoverned. Adders are inconsistent across reps and shops: different names for the same condition, stale prices, some reps skip the library and type free-form line items. Nobody at PB currently knows how many distinct adders exist today.
2. **Adders are caught too late.** Today, conditions that warrant adders (MPU, trenching, steep/tall roof, ground mount, decommission, re-roof coordination) are often missed at point of sale and only surface during design, site survey, or install. That creates change-order back-and-forth with the customer after contract signature — the single biggest pain point the business owner has called out. Change orders themselves are handled ad-hoc (email, DocuSign) outside OpenSolar, so the HubSpot deal value, Zoho SO, and eventual invoice drift from the as-sold record.

The downstream effects:

- **Margin leakage.** Missed adders show up as unfunded labor at install.
- **No feedback loop.** The BOM pipeline already extracts what designers drew from plansets, and we already have HubSpot deal + Zoho SO data. But there's no layer that reconciles *what was sold* against *what was designed / installed*, so we can't answer "was this deal priced correctly?" at scale.
- **Customer trust.** CO conversations that could have been priced up front feel like surprises because they arrive after contract signature.

OpenSolar is where reps live and it owns the quote-facing UX well. It cannot own reconciliation — it doesn't see the planset BOM, the Zoho SO, install photos, or the final invoice. PB Ops Suite is the only place in the stack that already touches all of those systems.

## Solution

Build an **Adder Catalog + Point-of-Sale Triage + Change Order module** in PB Ops Suite as the canonical source of truth for pricing. The catalog syncs **into** OpenSolar so reps quote from a governed library, and a **triage checklist** surfaces the right adders at the moment of sale (in-home / consult) so they're captured before contract, not discovered at install.

The point of building the catalog is not "we have a clean list." It's "we can prompt reps with structured questions that auto-surface the correct adders at point of sale, eliminating the back-and-forth that currently shows up as change orders."

Ship in four phases — **this spec covers Phases 0 and 1**. Phases 2 and 3 become follow-on specs once the catalog + triage are live.

| Phase | Scope | Artifact |
|-------|-------|----------|
| **0 (this spec)** | Audit current adder usage; assign one library owner; produce canonical adder list with definitions, triggers, triage questions, and prices | CSV + owner sign-off (no code) |
| **1 (this spec)** | Adder Catalog module + Point-of-Sale Triage checklist + OpenSolar sync; reps capture adders during the consult, not after | Code |
| 2 (future spec) | Governed Change Order workflow tied to HubSpot deal; uses same catalog + triage; writes back to deal value + Zoho SO. Site-survey re-triage revalidates Phase 1 answers with ground truth | Code |
| 3 (future spec) | Ops discovery → pricing feedback loop; BOM-vs-sold reconciliation; margin dashboard by adder category | Code |

Sequencing rationale: Phase 0 is a prerequisite — you cannot build a governed catalog without knowing what's in the (currently broken) source. Phase 1 closes the point-of-sale capture gap (the primary pain: too much back-and-forth after the fact). Phase 2 adds the governed CO workflow for conditions that legitimately change after signature (and re-triages at site survey). Phase 3 closes the learning loop so pricing improves over time from actual data instead of gut feel.

## Non-Goals (This Spec)

- **Not replacing OpenSolar.** OpenSolar remains the quote-facing UX. We sync *into* it.
- **Not building a margin dashboard yet.** That's Phase 3.
- **Not building the CO workflow yet.** That's Phase 2. Phase 1 only governs the adder library that CO will later consume.
- **Not doing base-system pricing.** This spec covers adders only ($/W base pricing stays in OpenSolar as-is for now).
- **Not touching customer-facing documents.** Phase 1 is internal.

---

## Phase 0: Inventory & Ownership

**Duration estimate:** ~2 weeks, no code.

### Deliverables

1. **Single named owner** for the adder library. Proposed: a Precon or Ops lead with authority to set prices (needs executive sign-off). Owner approves all adds/changes in Phase 1+.
2. **Canonical adder list** as a CSV/Google Sheet with the following columns per row:
   - `code` — short stable identifier (e.g., `MPU_200A`, `TRENCH_LF`, `ROOF_STEEP_8_12`)
   - `name` — human-readable label
   - `category` — one of: ELECTRICAL, ROOFING, STRUCTURAL, SITEWORK, LOGISTICS, DESIGN, PERMITTING, REMOVAL, MISC
   - `trigger_condition` — plain-English rule (e.g., "roof pitch > 8/12", "run length > 50 ft")
   - `triage_question` — rep-facing question asked at point of sale (e.g., "What is the main panel amp rating?", "What is the steepest roof pitch?")
   - `triage_answer_type` — `boolean` | `numeric` | `choice` | `measurement`
   - `trigger_logic` — structured predicate mapping answer to adder-needed (e.g., `answer < 200` for MPU, `answer >= 8` for steep roof). JSON-expressible in Phase 1.
   - `photos_required` — whether rep/surveyor must upload a photo when this adder is selected
   - `unit` — one of: `flat`, `per_module`, `per_kw`, `per_linear_ft`, `per_hour`, `tiered`
   - `base_price` — customer-facing price in the chosen unit
   - `base_cost` — internal cost (labor + materials) for margin tracking
   - `margin_target` — target gross margin %
   - `active` — true/false
   - `shop_overrides` — optional per-location price delta (DTC / WESTY / COSP / CA / CAMARILLO)
   - `notes` — definition, edge cases

### Process

- Export the last 12 months of OpenSolar deals via OpenSolar API; extract every adder + custom line item description + price + shop.
- Classify and dedupe (fuzzy-match on description; resolve synonyms — "main panel upgrade" = "MPU" = "service upgrade").
- Reconcile against ops reality: for each adder, the owner + an ops lead agree on definition, trigger, triage question, unit, and price. Pricing should be set using recent actual installed cost data, not gut feel.
- Flag adders that should **not** carry forward (obsolete, redundant, mispriced) so they don't get imported into Phase 1.

### Exit criteria

- Owner identified and committed.
- Canonical CSV reviewed and signed off by owner + ops lead + (ideally) one sales lead.
- Executive sign-off that the library is authoritative — sales reps lose the ability to type free-form adders once Phase 1 ships.

---

## Phase 1: Adder Catalog + Point-of-Sale Triage

### Pre-Phase Discovery (blocks code work)

Before any code starts, confirm with OpenSolar support/admin:

1. **Lockdown capability** — can the OpenSolar account be configured so reps cannot create free-form adder line items? If no, Phase 1 value drops (library is advisory, not enforceable) and we need to decide whether to proceed or pivot.
2. **Shop-aware pricing** — does an OpenSolar adder support per-shop pricing on a single record, or must we push N adders (one per shop)?
3. **API write surface** — confirm create/update/retire endpoints for the adder library and rate limits.

Fold discovery findings into the implementation plan. Hard-blocking issues escalate back to brainstorming.

### Architecture

```
PB Ops Suite                                                   OpenSolar
┌────────────────────────────────────────────┐                ┌────────────┐
│  /dashboards/adders (owner UI)             │                │  Adder     │
│  ├─ list, create/edit, overrides, audit    │   push via     │  library   │
│                                            │─── OpenSolar ─→│  (locked:  │
│  /triage (rep-facing, mobile-first)        │   API sync     │   reps     │
│  ├─ enter dealId or address                │                │   select   │
│  ├─ walk through triage questions          │                │   from     │
│  ├─ photos-required capture                │                │   catalog) │
│  ├─ submit → writes to HubSpot deal        │                └────────────┘
│  └─ also embeddable on deal detail page    │                      ▲
│                                            │                      │
│  /api/adders/*            (REST)           │                      │
│  /api/adders/sync         (cron + on-save) │──────────────────────┘
│  /api/triage/*            (triage run CRUD + submit)
│                                            │
│  lib/adders/                               │
│  ├─ catalog.ts  (Adder CRUD)               │
│  ├─ sync.ts     (push to OpenSolar, idempotent)
│  ├─ pricing.ts  (shop override → resolved price)
│  ├─ triage.ts   (evaluate trigger_logic against answers → recommended adders)
│  └─ types.ts
└────────────────────────────────────────────┘
```

- **Catalog is authoritative in PB Ops Suite.** OpenSolar receives a mirror.
- **Sync is one-way** in Phase 1 (PB → OpenSolar). Reverse sync is unnecessary because reps are locked to the library in OpenSolar — nothing new originates there.
- **Sync runs on two triggers:** (1) on successful write in the Adder Catalog UI (push-on-save), (2) nightly cron as a safety net. This mirrors the existing `property-sync.ts` + `/api/cron/property-reconcile` pattern — reuse that design for consistency.
- **Shop overrides** are resolved at sync time based on the Pre-Phase Discovery finding on OpenSolar's shape.

### Point-of-Sale Triage Flow

The triage surface is the primary user-visible artifact of Phase 1 — it is what reps actually touch day-to-day, and it is what delivers the "capture adders earlier" win.

**Two entry points:**

1. **Standalone mobile-first page** at `/triage` — rep enters a deal ID (or creates a pre-deal by address) and walks through a questionnaire on their phone during the in-home consult. Optimized for one-handed use and spotty LTE.
2. **Deal detail page embed** — from any HubSpot deal surface in PB Ops Suite, click "Run Triage" to open the same flow inline.

**Questionnaire logic:**

- Engine loads all `active` adders whose `triageQuestion` is non-null.
- Questions are grouped by category and shown in a fixed, owner-defined order.
- Each answer is evaluated against `triggerLogic` via `lib/adders/triage.ts` (pure function). A match means "this adder is needed."
- **`triggerLogic` JSON shape (Phase 1):** `{ op: "lt" | "lte" | "eq" | "gte" | "gt" | "contains" | "truthy", value?: number | string | boolean, qtyFrom?: "answer" | "constant", qtyConstant?: number }`. The authoring UI renders a simple predicate builder that writes this shape; `lib/adders/triage.ts` evaluates it. Composite predicates (`and`/`or`) are explicitly out of scope for Phase 1.
- Matched adders appear in a review panel with quantity fields (auto-populated from the answer when possible, e.g., trench linear feet from a numeric question).
- `photosRequired` adders block submit until a photo is attached.
- On submit:
  - A `TriageRun` row is saved with the full Q&A snapshot.
  - Selected adders are written as line items to the HubSpot deal via existing `lib/hubspot.ts` line-item primitives.
  - The OpenSolar quote is updated via the sync API so when the rep returns to OpenSolar the adders are already applied.

**Re-triage:** a deal can have multiple `TriageRun` rows. Phase 2 will add automatic re-triage at site survey by the field surveyor; Phase 1 allows re-runs manually from the deal detail page.

**Offline tolerance:** drafts persist to `localStorage` keyed by deal ID until submit succeeds. Spotty cell service on roofs and in basements is a known reality.

### Data Model

New Prisma models:

```prisma
model Adder {
  id                 String   @id @default(cuid())
  code               String   @unique            // stable identifier, e.g., "MPU_200A"
  name               String                      // display name
  category           AdderCategory
  triggerCondition   String?                     // plain-English rule for rep guidance
  triageQuestion     String?                     // rep-facing question at point of sale
  triageAnswerType   TriageAnswerType?
  triageChoices      Json?                       // for CHOICE: array of {label, value}
  triggerLogic       Json?                       // predicate evaluated against answer → adder-needed
  photosRequired     Boolean  @default(false)
  unit               AdderUnit
  basePrice          Decimal                     // customer-facing
  baseCost           Decimal                     // internal
  marginTarget       Decimal?                    // target GM %
  active             Boolean  @default(true)
  notes              String?
  openSolarId        String?                     // external ID after first sync
  createdBy          String                      // user.id
  updatedBy          String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  overrides          AdderShopOverride[]
  revisions          AdderRevision[]

  @@index([category, active])
}

model AdderShopOverride {
  id          String   @id @default(cuid())
  adderId     String
  shop        String                             // matches existing location-as-string convention (CrewMember.location etc.)
  priceDelta  Decimal                            // added to basePrice
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  adder       Adder    @relation(fields: [adderId], references: [id], onDelete: Cascade)

  @@unique([adderId, shop])
}

model AdderRevision {
  id          String   @id @default(cuid())
  adderId     String
  snapshot    Json                               // full Adder state + overrides for point-in-time reconstruction
  changedBy   String
  changedAt   DateTime @default(now())
  changeNote  String?

  adder       Adder    @relation(fields: [adderId], references: [id], onDelete: Cascade)

  @@index([adderId, changedAt])
}

model AdderSyncRun {
  id              String   @id @default(cuid())
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  status          SyncRunStatus
  trigger         SyncTrigger
  addersPushed    Int      @default(0)
  addersFailed    Int      @default(0)
  errorLog        Json?
}

model TriageRun {
  id                 String   @id @default(cuid())
  dealId             String?                     // HubSpot deal ID; null for pre-deal (address-only) entry
  prelimAddress      Json?                       // { street, unit, city, state, zip } when dealId is null
  runBy              String                      // user.id
  runAt              DateTime @default(now())
  answers            Json                        // { [adderId]: {question, answer, unit} }
  recommendedAdders  Json                        // [{ adderId, code, qty, price }] computed at submit time
  selectedAdders     Json                        // rep-confirmed subset written to HubSpot
  photos             Json?                       // [{ adderId, storageKey, url, uploadedAt }]
  submitted          Boolean  @default(false)
  submittedAt        DateTime?
  hubspotLineItemIds Json?                       // [{ adderId, lineItemId }] for rollback on partial failure
  notes              String?

  @@index([dealId, runAt])
}

enum AdderCategory {
  ELECTRICAL
  ROOFING
  STRUCTURAL
  SITEWORK
  LOGISTICS
  DESIGN
  PERMITTING
  REMOVAL
  MISC
}

enum AdderUnit {
  FLAT
  PER_MODULE
  PER_KW
  PER_LINEAR_FT
  PER_HOUR
  TIERED
}

enum TriageAnswerType {
  BOOLEAN
  NUMERIC
  CHOICE
  MEASUREMENT
}

enum SyncRunStatus {
  RUNNING
  SUCCESS
  PARTIAL
  FAILED
}

enum SyncTrigger {
  ON_SAVE
  CRON
  MANUAL
}
```

**Schema convention notes:**

- `AdderShopOverride.shop` is `String`, not an enum, to match existing conventions (e.g., `CrewMember.location`). Validated against an allowlist in `lib/adders/pricing.ts`. Creating a canonical `Shop` enum is a separate cleanup effort, out of scope here.
- `Decimal` columns use no explicit precision to match the rest of `prisma/schema.prisma` house style.
- `AdderRevision.snapshot` captures the full `Adder` row **plus its overrides** at time of change so Phase 3 reconciliation can answer "what did this adder cost at this shop on this date?" without history joins.
- `TriageRun.hubspotLineItemIds` enables rollback if the HubSpot write partially fails mid-submit.

### UI

**Adder catalog (`/dashboards/adders`)**
- List view, filterable by category / shop / active status via `MultiSelectFilter`. Wrapped in `DashboardShell` with `accentColor="green"`.
- Detail/edit form with category-aware fields driven by a config map (pattern: `lib/catalog-fields.ts`).
- Shop override sub-panel: grid of 5 shops × price delta.
- Triage authoring panel on each adder: question text, answer type, answer choices (if applicable), trigger logic builder (simple predicate UI — Phase 1 supports `<`, `<=`, `=`, `>=`, `>`, `contains` against a single value).
- Revision history drawer (pattern: `BomHistoryDrawer`).
- Sync status badge in page header (last sync time, last run status, manual "sync now" button).

**Triage (`/triage`)**
- Mobile-first single-column layout; large touch targets.
- Deal lookup step (by ID, address, or customer name).
- Stepper: one question per screen, with progress indicator. Category groupings visible.
- Photo capture uses the browser File API; compressed client-side before upload. Storage target: the existing `/api/upload` pattern used for BOM planset uploads (S3-backed via signed URL). `TriageRun.photos` stores `{ storageKey, url, uploadedAt }` per photo.
- Review screen lists recommended adders with quantity/price; rep can uncheck any with a mandatory `notes` reason for audit (Phase 3 reconciliation uses this to detect common opt-outs).
- Submit shows success state + link back to the deal.

### API Routes

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/adders` | GET | List (filters: category, shop, active) | authenticated |
| `/api/adders` | POST | Create | `canManageAdders` |
| `/api/adders/[id]` | GET | Detail | authenticated |
| `/api/adders/[id]` | PATCH | Update (writes revision) | `canManageAdders` |
| `/api/adders/[id]/retire` | POST | Set active=false | `canManageAdders` |
| `/api/adders/[id]/revisions` | GET | List revisions | authenticated |
| `/api/adders/sync` | POST | Trigger sync to OpenSolar | `canManageAdders` |
| `/api/cron/adders-sync` | POST | Nightly sync (cron-secret gated) | cron secret |
| `/api/triage/runs` | POST | Create a draft `TriageRun` for a deal | authenticated |
| `/api/triage/runs/[id]` | GET, PATCH | Load / update draft answers | authenticated; write requires `runBy` match or `canManageAdders` |
| `/api/triage/runs/[id]/submit` | POST | Finalize, write HubSpot line items | authenticated |
| `/api/triage/recommend` | POST | Pure-function endpoint: given answers, return recommended adders | authenticated |

**Required middleware changes:**

- All new `/api/*` paths must be added to every role's `allowedRoutes` in `src/lib/roles.ts` or middleware returns 403 silently.
- `/api/cron/adders-sync` must be added to `PUBLIC_API_ROUTES` / cron-authenticated path list in `src/middleware.ts` (pattern: existing cron endpoints).

### Role Access

- **ADMIN, OWNER** — full access. Both receive `canManageAdders = true` by default in the role-to-permission map in `src/lib/roles.ts` (matching the pattern of other permission booleans like `canScheduleSurveys`).
- **`canManageAdders`** — new permission boolean on `User`. Grantable to the designated library owner regardless of their other roles, so the owner doesn't need to be elevated to ADMIN just to maintain the catalog. Follows the CLAUDE.md "permission booleans override role defaults" convention.
- **OPS_MGR, PROJECT_MANAGER, OPERATIONS** — read-only on catalog; can run triage.
- **SALES_MANAGER, SALES** — read-only on catalog; can run triage (primary users of `/triage`).
- **TECH_OPS, DESIGN, PERMIT, INTERCONNECT** — read-only on catalog; can run triage if a site surveyor.
- All others — no access to the catalog route; triage access scoped to roles that realistically use it.

### OpenSolar Sync

- OpenSolar adders are keyed by `openSolarId` once created; `Adder.openSolarId` stores the external ID for idempotent updates.
- On save, push mutations are diffed: only changed fields sync.
- If a sync fails mid-batch, `AdderSyncRun` logs partial failures and the next run retries failed rows. Never block the UI save on sync success.
- Credentials: new env vars `OPENSOLAR_API_TOKEN` and `OPENSOLAR_ORG_ID`. Must be added to Vercel production env **before** cutover (verify with `vercel env ls production`).
- **Kill switch:** env var `ADDER_SYNC_ENABLED` — when false, writes go to the DB but nothing pushes to OpenSolar. Safe default for staging and for emergency stop.

---

## Rollout & Cutover

1. Ship Phase 1 with `ADDER_SYNC_ENABLED=false`. Populate the catalog with the Phase 0 CSV via a one-time import script. Owner audits the imported data in the UI.
2. Flip `ADDER_SYNC_ENABLED=true` in staging; verify OpenSolar mirror matches for a sample of adders.
3. Soft-launch triage to 2–3 pilot reps for one week. Collect feedback; fix bugs; tune question wording.
4. Coordinate cutover window with OpenSolar admin: in the same change window, (a) flip sync to true in prod, (b) lock down OpenSolar so reps can no longer create free-form adders, (c) require triage completion as part of the sales-to-ops handoff SOP, (d) announce to sales.
5. Monitor `AdderSyncRun` and `TriageRun` for 2 weeks; triage (ha) any issues.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OpenSolar API can't fully lock reps out of free-form items | Verified in Pre-Phase Discovery. If unsupported, publish monthly report of line items whose text doesn't match a catalog adder; flag offending reps for coaching. |
| Sync fails silently, OS and PB drift | `AdderSyncRun` visible in UI; alert if last successful run > 24h ago. |
| Reps skip triage on mobile because UX is clunky | Pilot with 2–3 reps before cutover; iterate on wording/flow. Measure: adders-per-deal before vs. after. |
| Owner becomes a bottleneck | Delegate via `canManageAdders` permission — grant to 2–3 trusted leads, not just one person. |
| Triage writes line items to HubSpot that conflict with OpenSolar-originated items | Phase 1: use a distinct `pb_source=triage` marker on the line item (or naming convention) so downstream systems can distinguish. Document the reconciliation rule in the implementation plan. |
| Phase 0 audit stalls | Timebox to 2 weeks; if incomplete, ship Phase 1 with the partial canonical list and treat the remainder as ongoing cleanup. |

## Open Questions

1. **Who owns the library?** Proposed: a Precon or Ops lead. Needs executive sign-off before Phase 0 kicks off.
2. **OpenSolar Pre-Phase Discovery outcomes** — lockdown capability, shop-aware pricing, write API shape. Must be answered before implementation plan locks.
3. **Deal-state rule for triage:** can triage only be run on open/pre-contract deals, or also on closed deals (e.g., during site survey before install)? Leaning: Phase 1 allows any open deal; Phase 2 formalizes "re-triage at site survey" as the CO trigger.
4. **Historical tail:** deals already quoted with the old library remain as-is; Phase 1 governs new quotes only. Phases 2 and 3 handle the historical tail.

## Success Metrics

- **Phase 0 exit:** canonical CSV exists, signed off by owner + ops lead.
- **Phase 1 exit:**
  - 100% of OpenSolar adders sync from PB Ops Suite.
  - Rep-created free-form adder count drops to ~0 within 30 days of cutover.
  - ≥ 80% of new deals have a `TriageRun` with `submitted=true` and at least one `selectedAdders` entry reviewed before contract signature, within 60 days of cutover.
  - Median adders-per-deal at contract signature increases (indicator that we're catching adders earlier, not missing them).
- **Longer term (Phase 3 milestone):** change-order rate per deal trends down; margin variance per adder category trends down QoQ as the library is tuned against install cost.
