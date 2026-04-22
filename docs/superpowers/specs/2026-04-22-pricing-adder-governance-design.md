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
- **Internal drift between pricing systems.** PB already has an in-house pricing calculator (`src/lib/pricing-calculator.ts`) reverse-engineered from OpenSolar's "Costing Scheme Itemized" (ID 10059), plus an IDR Meeting adder-tracking system (boolean columns on `IdrEscalationQueue`). Both hold adder data today, they disagree, and the IDR columns (trenching, ground mount, MPU, EV charger) are tracked for context but are **never priced** by the calculator — they have zero dollar value in the engine.

OpenSolar is where reps live and it owns the quote-facing UX well. It cannot own reconciliation — it doesn't see the planset BOM, the Zoho SO, install photos, or the final invoice. PB Ops Suite is the only place in the stack that already touches all of those systems, and it's also the place that already contains the pricing math — just without a governed source for the inputs.

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
   - `category` — one of: ELECTRICAL, ROOFING, STRUCTURAL, SITEWORK, LOGISTICS, DESIGN, PERMITTING, REMOVAL, ORG, MISC
   - `trigger_condition` — plain-English rule (e.g., "roof pitch > 8/12", "run length > 50 ft")
   - `triage_question` — rep-facing question asked at point of sale (e.g., "What is the main panel amp rating?", "What is the steepest roof pitch?")
   - `triage_answer_type` — `boolean` | `numeric` | `choice` | `measurement` (lowercase in CSV; the import script uppercases to match the `TriageAnswerType` Prisma enum)
   - `trigger_logic` — structured predicate mapping answer to adder-needed (e.g., `answer < 200` for MPU, `answer >= 8` for steep roof). JSON-expressible in Phase 1.
   - `photos_required` — whether rep/surveyor must upload a photo when this adder is selected
   - `unit` — one of: `flat`, `per_module`, `per_kw`, `per_linear_ft`, `per_hour`, `tiered`
   - `base_price` — customer-facing price in the chosen unit
   - `base_cost` — internal cost (labor + materials) for margin tracking
   - `margin_target` — target gross margin %
   - `active` — true/false
   - `shop_overrides` — optional per-location price delta. Shop values match existing `CrewMember.location` strings: `"Westminster"`, `"DTC"`, `"Colorado Springs"`, `"SLO"`, `"Camarillo"`. (SLO and Camarillo share an install calendar but are distinct shops for pricing.) CSV encoding: one column per shop, blank = no override.
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
- **`triggerLogic` JSON shape (Phase 1):** `{ op: "lt" | "lte" | "eq" | "gte" | "gt" | "contains" | "truthy", value?: number | string | boolean, qtyFrom?: "answer" | "constant", qtyConstant?: number }`. The authoring UI renders a simple predicate builder that writes this shape; `lib/adders/triage.ts` evaluates it. **Validation:** enforced by a zod schema at the `/api/adders` POST/PATCH boundary — invalid shapes return 400 and never hit the DB. Composite predicates (`and`/`or`) are explicitly out of scope for Phase 1.
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
  type               AdderType   @default(FIXED) // FIXED | PERCENTAGE
  direction          AdderDirection @default(ADD) // ADD (adds to price) | DISCOUNT (subtracts)
  autoApply          Boolean  @default(false)    // applied without rep selection (e.g., PE -30%)
  appliesTo          String?                     // scope rule, e.g., "deal.dealType=='PE'" (parsed by pricing engine)
  triggerCondition   String?                     // plain-English rule for rep guidance
  triageQuestion     String?                     // rep-facing question at point of sale
  triageAnswerType   TriageAnswerType?
  triageChoices      Json?                       // for CHOICE: array of {label, value}
  triggerLogic       Json?                       // predicate evaluated against answer → adder-needed (zod-validated on write)
  photosRequired     Boolean  @default(false)
  unit               AdderUnit                   // interpreted with `type`: PERCENTAGE + FLAT means "flat percentage of subtotal"
  basePrice          Decimal                     // customer-facing. Always positive; `direction` expresses sign.
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
  answers            Json                        // { [adderId]: { question, answer, unit } } — question text captured at run-time for point-in-time reconstruction, same rationale as AdderRevision.snapshot
  recommendedAdders  Json                        // [{ adderId, code, qty, price }] computed at submit time
  selectedAdders     Json                        // rep-confirmed subset written to HubSpot
  photos             Json?                       // [{ adderId, storageKey, url, uploadedAt }]
  submitted          Boolean  @default(false)
  submittedAt        DateTime?
  hubspotLineItemIds Json?                       // [{ adderId, lineItemId }] for rollback on partial failure
  notes              String?                     // free-text rep notes — surfaced on the deal detail page; never sent to the customer

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
  ORG                                              // org-level promotions, regional discounts, PE adjustments
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

enum AdderType {
  FIXED
  PERCENTAGE
}

enum AdderDirection {
  ADD
  DISCOUNT
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

- `AdderShopOverride.shop` is `String`, not an enum, to match existing conventions (e.g., `CrewMember.location`). Allowlist lives in `lib/adders/pricing.ts` as `export const VALID_SHOPS = ["Westminster", "DTC", "Colorado Springs", "SLO", "Camarillo"] as const;` — imported wherever shop is validated so the CSV, sync, UI, and migration seed all share one list. Creating a canonical `Shop` enum is a separate cleanup effort, out of scope here.
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
- Photo capture uses the browser File API; compressed client-side before upload. Storage target: new endpoint `/api/triage/upload` following the presigned-S3-URL pattern used by [/api/catalog/upload-photo](src/app/api/catalog/upload-photo) and [/api/bom/upload](src/app/api/bom/upload) (no generic `/api/upload` exists in this repo). `TriageRun.photos` stores `{ storageKey, url, uploadedAt }` per photo.
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
| `/api/triage/runs/[id]` | GET, PATCH | Load / update draft answers | authenticated; writer must be the `runBy` user, or hold `canManageAdders` |
| `/api/triage/runs/[id]/submit` | POST | Finalize, write HubSpot line items | authenticated |
| `/api/triage/recommend` | POST | Pure-function endpoint: given answers, return recommended adders | authenticated |
| `/api/triage/upload` | POST | Presigned S3 URL for photo upload (pattern: `/api/catalog/upload-photo`) | authenticated |

**Required middleware changes:**

- All new `/api/*` paths must be added to every role's `allowedRoutes` in `src/lib/roles.ts` or middleware returns 403 silently.
- `/api/cron/adders-sync` must be added to `PUBLIC_API_ROUTES` / cron-authenticated path list in `src/middleware.ts` (pattern: existing cron endpoints).

### Testing

Required test coverage shipping with Phase 1:

- **`lib/adders/triage.ts` predicate evaluator** — unit tests covering every `op` variant, nullable/missing answers, type coercion (numeric strings → numbers), and the "truthy" special case. Must include table-driven tests with the seed catalog's real triggerLogic values.
- **`lib/adders/pricing.ts::resolveAddersForCalc`** — unit tests for shop override resolution, inactive adder exclusion, auto-apply filtering by `appliesTo` predicate, and `direction: DISCOUNT` sign handling.
- **`calcPrice()` regression suite** — extend the existing 8+ sold-project fixture tests to run with DB-sourced adders AND the deprecated `customFixedAdder` scalar path, proving both produce identical output during the migration window.
- **OpenSolar sync idempotency** — integration tests using a mocked OS API: repeated pushes of the same `Adder` row emit zero writes on the second call; retire flips to archived; resurrection of an archived adder reuses `openSolarId`.
- **Triage submit rollback** — when a HubSpot line-item write fails partway through, the stored `hubspotLineItemIds` enables a clean rollback and the run stays `submitted=false`.
- **Seed integrity** — a test that fails if any `IdrEscalationQueue.adder*` boolean column lacks a matching `Adder.code` in the seeded catalog.

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
- **Retire behavior:** when `active` flips to `false`, sync pushes an archive/disable mutation to OpenSolar so the adder disappears from the rep picker. Exact mutation shape depends on Pre-Phase Discovery finding — if OpenSolar supports a boolean "archived" flag, use that; otherwise delete and re-create on reactivation. Retired adders are never deleted from the PB catalog (revision history depends on them).
- If a sync fails mid-batch, `AdderSyncRun` logs partial failures and the next run retries failed rows. Never block the UI save on sync success.
- Credentials: new env vars `OPENSOLAR_API_TOKEN` and `OPENSOLAR_ORG_ID`. Must be added to Vercel production env **before** cutover (verify with `vercel env ls production`).
- **Kill switch:** env var `ADDER_SYNC_ENABLED` — when false, writes go to the DB but nothing pushes to OpenSolar. Safe default for staging and for emergency stop.

### Pricing Calculator Integration

PB already has an in-house pricing calculator at [src/lib/pricing-calculator.ts](src/lib/pricing-calculator.ts) — a pure-function `calcPrice()` reverse-engineered from OpenSolar's "Costing Scheme Itemized" (ID 10059) and verified against 8+ sold projects. It's sound math. It also holds three sets of hardcoded adder constants (`ROOF_TYPES`, `STOREY_ADDERS`, `PITCH_ADDERS`, `ORG_ADDERS`), and it's disconnected from the IDR Meeting adder-tracking system (boolean columns on `IdrEscalationQueue`: `adderTrenching`, `adderGroundMount`, `adderMpuUpgrade`, `adderEvCharger`, `adderSteepPitch`, `adderTwoStorey`, `adderTileRoof` + a `customAdders` JSON array).

Today:
- The pricing calculator knows how to price roof type, storey, and pitch but **cannot price trenching, ground mount, MPU, or EV charger** — those are tracked in IDR with no dollar amount and are silently ignored by `calcPrice()`.
- The IDR Meeting checkbox UI is effectively an ad-hoc triage checklist already in use, but its outputs don't flow into the pricing math.
- The calculator's `customFixedAdder` input is a single scalar number, while the IDR `customAdders` column is an array of `{name, amount}` objects. Audit trail is lost at the boundary.

**Phase 1 scope — the Adder Catalog becomes the source of truth for these constants:**

1. **Replace hardcoded constants with DB-backed lookups.** `ROOF_TYPES`, `STOREY_ADDERS`, `PITCH_ADDERS`, and `ORG_ADDERS` move out of `pricing-calculator.ts` and into seeded `Adder` rows:
   - Roof/storey/pitch → `category: ROOFING | STRUCTURAL`, `type: FIXED`, `direction: ADD`, `unit: FLAT | PER_KW | PER_MODULE`
   - PE -30% discount → `category: ORG`, `type: PERCENTAGE`, `direction: DISCOUNT`, `basePrice: 30`, `autoApply: true`, `appliesTo: "deal.dealType=='PE'"`
   - Q1-2026 promo → `category: ORG`, `type: FIXED`, `direction: DISCOUNT`, `basePrice: 1000`, `autoApply: true`, `appliesTo: "now < '2026-04-01'"` (or similar date predicate)
   - SoCo regional discount → `category: ORG`, `type: FIXED`, `direction: DISCOUNT`, `basePrice: 1500`, `autoApply: true`, `appliesTo: "shop in ['SLO','Camarillo']"`

   A new helper `lib/adders/pricing.ts::resolveAddersForCalc(shop, context)` returns the catalog rows needed by `calcPrice()`, filtering by `autoApply` + `appliesTo` evaluation. The calculator stays pure — the helper does the I/O and passes resolved values in. **`appliesTo` syntax (Phase 1):** one predicate per expression using ops `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`. Supported left-hand identifiers: `shop`, `deal.dealType`, `deal.valueCents`, `now` (current timestamp). Values are string, number, boolean, or bracketed list literal for `in`/`not in`. Boolean combinators (`&&`, `||`) are explicitly out of scope; express OR logic by creating multiple `Adder` rows. Validation is zod-enforced at the API boundary, same pattern as `triggerLogic`.
2. **Unify IDR booleans with the catalog.** The seven `adder*` boolean columns on `IdrEscalationQueue` stay (no destructive migration), but each maps 1:1 to an `Adder.code`. The IDR meeting view reads amounts from the catalog at render time via the existing `PricingBreakdown` component. Previously-zero adders (trenching, ground mount, MPU, EV charger) now carry catalog prices.
3. **`customFixedAdder` becomes an array.** `CalcInput.customAdders: Array<{ code?: string, name: string, amount: number, source: "catalog" | "adhoc" }>` replaces the single-number field. Catalog-sourced entries reference an `Adder.code`; ad-hoc entries are explicitly labeled so Phase 3 reconciliation can measure how often reps override the catalog.
4. **TriageRun writes to the calculator, not just HubSpot.** On triage submit, the `selectedAdders` set is passed to `calcPrice()` as `customAdders` plus the catalog-sourced roof/storey/pitch rows, producing a deal-level price breakdown that also lands on the deal. HubSpot line items remain the customer-visible record; the calculator breakdown is the internal margin view.
5. **Fix the latent bugs while we're in here** (all small, all blocking correct catalog behavior):
   - `calcPrice()` loops over `type !== "fixed"` at roughly [pricing-calculator.ts:589](src/lib/pricing-calculator.ts) — percentage adders other than PE are silently ignored today. Generalize to handle any `type: "percentage"` adder.
   - Typo `peEnergyCommunnity` (double `n`) in `CalcBreakdown` interface and return object — rename.
   - `DC_QUALIFYING_MODULE_BRANDS` is an empty array today (so PE DC bonus never triggers). Either seed it from Phase 0 data or flag as an open question.
6. **Out of scope for Phase 1:** reverse-engineering additional OpenSolar costing scheme line items beyond what the calculator already covers, or changing the calc's markup/base-$/W math. Only the adder inputs migrate.

This integration is the backbone of Phase 3's margin dashboard — once adders flow from catalog → triage → calculator → HubSpot consistently, the calc output becomes the as-sold margin record we can later reconcile against actual install cost.

---

## Rollout & Cutover

1. Ship Phase 1 with `ADDER_SYNC_ENABLED=false`. Populate the catalog with the Phase 0 CSV via a one-time import script. Owner audits the imported data in the UI.
2. Flip `ADDER_SYNC_ENABLED=true` in staging; verify OpenSolar mirror matches for a sample of adders.
3. Soft-launch triage to 2–3 pilot reps for one week. Collect feedback; fix bugs; tune question wording.
4. Coordinate cutover window with OpenSolar admin: in the same change window, (a) flip sync to true in prod, (b) lock down OpenSolar so reps can no longer create free-form adders, (c) require triage completion as part of the sales-to-ops handoff SOP, (d) announce to sales.
5. Monitor `AdderSyncRun` and `TriageRun` for 2 weeks; address any issues.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| OpenSolar API can't fully lock reps out of free-form items | Verified in Pre-Phase Discovery. If unsupported, publish monthly report of line items whose text doesn't match a catalog adder; flag offending reps for coaching. |
| Sync fails silently, OS and PB drift | `AdderSyncRun` visible in UI; alert if last successful run > 24h ago. |
| Reps skip triage on mobile because UX is clunky | Pilot with 2–3 reps before cutover; iterate on wording/flow. **Post-cutover:** weekly `TriageRun` submission rate report for 90 days; if <60% of new deals have a submitted run after the first 30 days, pause scale-up and iterate. Measure adders-per-deal before vs. after. |
| Owner becomes a bottleneck | Delegate via `canManageAdders` permission — grant to 2–3 trusted leads, not just one person. |
| Triage writes line items to HubSpot that conflict with OpenSolar-originated items | Phase 1: use a distinct `pb_source=triage` marker on the line item (or naming convention) so downstream systems can distinguish. Document the reconciliation rule in the implementation plan. |
| Phase 0 audit stalls | Timebox to 2 weeks; if incomplete, ship Phase 1 with the partial canonical list and treat the remainder as ongoing cleanup. |
| Pricing calculator refactor breaks existing UI | `calcPrice()` has unit tests against 8+ verified sold projects; extend that suite to cover catalog-sourced adder inputs before flipping over. Keep `customFixedAdder` as a deprecated alias that falls back to a single-entry array for one release, then remove. |
| IDR adder booleans fall out of sync with catalog codes | Seed catalog with exact `Adder.code` values matching the seven existing IDR columns; add a lint/test that fails if any `IdrEscalationQueue.adder*` column lacks a matching catalog row. |

## Open Questions

1. **Who owns the library?** Proposed: a Precon or Ops lead. Needs executive sign-off before Phase 0 kicks off.
2. **OpenSolar Pre-Phase Discovery outcomes** — lockdown capability, shop-aware pricing, write API shape. Must be answered before implementation plan locks.
3. **Deal-state rule for triage:** can triage only be run on open/pre-contract deals, or also on closed deals (e.g., during site survey before install)? Leaning: Phase 1 allows any open deal; Phase 2 formalizes "re-triage at site survey" as the CO trigger.
4. **Historical tail:** deals already quoted with the old library remain as-is; Phase 1 governs new quotes only. Phases 2 and 3 handle the historical tail.
5. **DC bonus qualification data:** `DC_QUALIFYING_MODULE_BRANDS` in the pricing calculator is empty today, so the PE solar DC bonus never triggers. Is this an oversight (should be seeded from ops knowledge as part of Phase 0) or intentional (handled outside the calculator)? Needed before Phase 1 ships so the catalog + calc output is correct.

## Success Metrics

- **Phase 0 exit:** canonical CSV exists, signed off by owner + ops lead.
- **Phase 1 exit:**
  - 100% of OpenSolar adders sync from PB Ops Suite.
  - Rep-created free-form adder count drops to ~0 within 30 days of cutover.
  - ≥ 80% of new deals have a `TriageRun` with `submitted=true` and at least one `selectedAdders` entry reviewed before contract signature, within 60 days of cutover.
  - Median adders-per-deal at contract signature increases (indicator that we're catching adders earlier, not missing them).
- **Longer term (Phase 3 milestone):** change-order rate per deal trends down; margin variance per adder category trends down QoQ as the library is tuned against install cost.
