# Estimator v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the estimator rebuild — a shared pure-function engine plus a public-facing New Installation wizard at `/estimator` that writes leads into HubSpot, replacing the Craft CMS iframe on `photonbrothers.com/learn/estimator`.

**Spec:** [docs/superpowers/specs/2026-04-21-estimator-v2-design.md](../specs/2026-04-21-estimator-v2-design.md)

**Architecture:** Pure-function engine in `lib/estimator/` (no I/O); data loaded from seed JSON at API boundary; public Next.js pages at `/estimator/*`; public API routes at `/api/estimator/*`; HubSpot writes happen after local persistence so submissions survive third-party outages; reconcile cron backfills failed HubSpot writes.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, TypeScript strict, Zod, React Query, React Email, Jest, Google Places Autocomplete, Google Maps Static API, reCAPTCHA v3.

---

## File Structure

### New modules
```
src/lib/estimator/
├── types.ts              # EstimatorInput / EstimatorResult / IncentiveRecord
├── constants.ts          # FALLBACK_PANEL_WATTAGE, defaults
├── sizing.ts             # Pure: kWh usage → system kW → panel count
├── production.ts         # Pure: (state, shade) → kWh/kW/year
├── pricing.ts            # Pure: retail price computation
├── incentives.ts         # Pure: apply incentive stack
├── financing.ts          # Pure: amortize(principal, apr, months)
├── service-area.ts       # Pure: zip → Location | null
├── engine.ts             # Pure: compose modules → full estimate
├── validation.ts         # Zod schemas for all inputs/outputs
├── hash.ts               # Re-export of normalizedAddressHash from property-sync
├── data-loader.ts        # Load + validate seed JSON files
├── recaptcha.ts          # Server-side verify
├── rate-limit.ts         # Wraps existing RateLimit model for estimator endpoints
├── hubspot.ts            # createEstimatorContact, createEstimatorDeal
├── index.ts              # Public exports
└── data/
    ├── service-area.json
    ├── utilities.json
    ├── incentives.json
    ├── pricing.json
    └── production.json

src/app/api/estimator/
├── address-validate/route.ts
├── utilities/route.ts
├── quote/route.ts
├── submit/route.ts
├── result/[token]/route.ts
└── static-map/route.ts        # Server-side Maps Static proxy

src/app/api/cron/
├── estimator-cleanup/route.ts
└── estimator-hubspot-reconcile/route.ts

src/app/estimator/
├── layout.tsx                 # Public layout (no DashboardShell)
├── page.tsx                   # Entry redirect
├── new-install/
│   ├── page.tsx               # Wizard shell (state machine)
│   └── components/
│       ├── StepLayout.tsx     # Shared chrome: progress bar, back btn
│       ├── AddressStep.tsx
│       ├── RoofConfirmStep.tsx
│       ├── UsageStep.tsx
│       ├── ContactStep.tsx
│       └── UtilityFallback.tsx
├── out-of-area/page.tsx
└── results/[token]/page.tsx

src/emails/
├── EstimatorResultsEmail.tsx
├── EstimatorWaitlistEmail.tsx
└── EstimatorManualQuoteEmail.tsx
```

### Modified files
- `prisma/schema.prisma` — add `EstimatorRun`, add 2 `ActivityType` enum values, add `defaultForEstimator` to `InternalProduct`
- `src/middleware.ts` — add `/estimator` to `ALWAYS_ALLOWED`, `/api/estimator` to `PUBLIC_API_ROUTES`
- `.env.example` — new env vars
- `src/lib/roles.ts` — no changes (public routes don't need role entries)

### Tests
Unit tests under `src/__tests__/estimator/` mirror the `lib/estimator/` structure.

---

## Chunk 1: Database Schema + Migration

### Task 1.1: Add `EstimatorRun` model, `ActivityType` values, and `InternalProduct.defaultForEstimator`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1.1: Locate the `ActivityType` enum and add two new values**

Add `ESTIMATOR_SUBMISSION` and `ESTIMATOR_OUT_OF_AREA` alphabetically within the existing `enum ActivityType { ... }` block.

- [ ] **Step 1.1.2: Locate `InternalProduct` model and add field**

Add `defaultForEstimator Boolean @default(false)` to `InternalProduct`. Add `@@index([defaultForEstimator, category])`.

- [ ] **Step 1.1.3: Append `EstimatorRun` model**

Append to `prisma/schema.prisma`:

```prisma
model EstimatorRun {
  id                    String   @id @default(cuid())
  token                 String   @unique
  quoteType             String
  inputSnapshot         Json
  resultSnapshot        Json?
  contactSnapshot       Json
  firstName             String
  lastName              String
  email                 String
  address               String
  normalizedAddressHash String?
  location              String?
  hubspotContactId      String?
  hubspotDealId         String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  expiresAt             DateTime
  ipHash                String?
  outOfArea             Boolean  @default(false)
  manualQuoteRequest    Boolean  @default(false)
  recaptchaScore        Float?
  flaggedForReview      Boolean  @default(false)
  retryCount            Int      @default(0)

  @@index([email])
  @@index([createdAt])
  @@index([hubspotDealId])
  @@index([expiresAt])
  @@index([normalizedAddressHash])
}
```

- [ ] **Step 1.1.4: Generate migration SQL (do NOT apply to prod)**

```bash
npx prisma migrate dev --name estimator_v2 --create-only
```

Expected: creates `prisma/migrations/<timestamp>_estimator_v2/migration.sql` with CREATE TABLE for EstimatorRun, ALTER TYPE for the enum, ALTER TABLE for InternalProduct.

- [ ] **Step 1.1.5: Regenerate Prisma client**

```bash
npx prisma generate
```

Expected: `src/generated/prisma/` updated with `EstimatorRun` type.

- [ ] **Step 1.1.6: Verify build still passes**

```bash
npm run lint && npm run build
```

Expected: no type errors. Build succeeds.

- [ ] **Step 1.1.7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/prisma/
git commit -m "feat(estimator): add EstimatorRun model and activity types"
```

**CRITICAL — Migration deploy order (HUMAN ACTION REQUIRED before Chunk 4+):**

Per the `feedback_prisma_migration_before_code.md` memory, additive schema fields trigger client regen on Vercel build. If a build against prod DB queries `defaultForEstimator` before the migration lands, it breaks. Therefore:

**Two-PR rollout:**
1. **PR #1 (this chunk alone)**: schema + migration + regen only. No code that references new fields. Merge → `prisma migrate deploy` on prod (orchestrator-only action — ASK THE USER before running).
2. **PR #2 (Chunks 2–7)**: engine + API + UI. Merges only after migration is in prod.

Do NOT run `prisma migrate deploy` from a subagent — this is an orchestrator-only action per `feedback_subagents_no_migrations.md`.

---

## Chunk 2: Seed Data + Data Loader

### Task 2.1: Service-area JSON + validator

**Files:**
- Create: `src/lib/estimator/data/service-area.json`
- Create: `src/lib/estimator/service-area.ts`
- Create: `src/__tests__/estimator/service-area.test.ts`

- [ ] **Step 2.1.1: Create minimal service-area JSON**

Seed with representative zips from each of the 5 locations. Must include every Colorado Springs zip that appears in `utilities.json` (80903–80932) so both JSONs stay consistent — the utilities file is the wider list; mirror it here. Plus a handful each for DTC / WESTY / CA / CAMARILLO metros. Ops can expand later.

```json
{
  "80202": { "location": "DTC" },
  "80021": { "location": "WESTY" },
  "80903": { "location": "COSP" },
  "80904": { "location": "COSP" },
  "...": "... all COSP zips listed in utilities.json ..."
}
```

- [ ] **Step 2.1.2: Write failing test**

```ts
// src/__tests__/estimator/service-area.test.ts
import { resolveLocationFromZip, isInServiceArea } from "@/lib/estimator/service-area";

describe("service-area", () => {
  it("resolves DTC for a Denver zip", () => {
    expect(resolveLocationFromZip("80202")).toBe("DTC");
  });
  it("returns null for unknown zip", () => {
    expect(resolveLocationFromZip("99999")).toBeNull();
  });
  it("isInServiceArea returns boolean", () => {
    expect(isInServiceArea("80202")).toBe(true);
    expect(isInServiceArea("99999")).toBe(false);
  });
});
```

Run: `npm test -- service-area` → FAIL (module not defined).

- [ ] **Step 2.1.3: Implement `service-area.ts`**

```ts
import serviceArea from "./data/service-area.json";
import type { Location } from "./types";

const MAP: Record<string, { location: Location }> = serviceArea as Record<string, { location: Location }>;

export function resolveLocationFromZip(zip: string): Location | null {
  const trimmed = (zip ?? "").trim().slice(0, 5);
  return MAP[trimmed]?.location ?? null;
}

export function isInServiceArea(zip: string): boolean {
  return resolveLocationFromZip(zip) !== null;
}
```

Run tests: `npm test -- service-area` → PASS.

- [ ] **Step 2.1.4: Commit**

```bash
git add src/lib/estimator/data/service-area.json src/lib/estimator/service-area.ts src/__tests__/estimator/service-area.test.ts
git commit -m "feat(estimator): service-area lookup from zip"
```

### Task 2.2: Utilities JSON + loader

**Files:**
- Create: `src/lib/estimator/data/utilities.json`
- Create: `src/lib/estimator/data-loader.ts` (initial version — will grow)

- [ ] **Step 2.2.1: Create utilities JSON**

```json
[
  { "id": "xcel_co", "name": "xcel_energy", "displayName": "Xcel Energy (CO)", "states": ["CO"], "avgBlendedRateUsdPerKwh": 0.14 },
  { "id": "pge", "name": "pge", "displayName": "PG&E", "states": ["CA"], "avgBlendedRateUsdPerKwh": 0.32 },
  { "id": "sce", "name": "sce", "displayName": "Southern California Edison", "states": ["CA"], "avgBlendedRateUsdPerKwh": 0.28 },
  { "id": "black_hills", "name": "black_hills", "displayName": "Black Hills Energy", "states": ["CO"], "avgBlendedRateUsdPerKwh": 0.13 },
  { "id": "colorado_springs_utilities", "name": "csu", "displayName": "Colorado Springs Utilities", "states": ["CO"], "zips": ["80903","80904","80905","80906","80907","80908","80909","80910","80915","80916","80917","80918","80919","80920","80921","80922","80923","80924","80925","80926","80927","80928","80929","80930","80931","80932","80933"], "avgBlendedRateUsdPerKwh": 0.15 }
]
```

- [ ] **Step 2.2.2: Write failing test for data-loader**

```ts
// src/__tests__/estimator/data-loader.test.ts
import { loadUtilitiesForState, loadUtilityById } from "@/lib/estimator/data-loader";

describe("data-loader / utilities", () => {
  it("filters utilities by state", () => {
    const utilities = loadUtilitiesForState("CO");
    expect(utilities.length).toBeGreaterThan(0);
    expect(utilities.every(u => u.states.includes("CO"))).toBe(true);
  });
  it("prioritizes utilities with matching zip", () => {
    const utilities = loadUtilitiesForState("CO", "80903");
    expect(utilities[0].id).toBe("colorado_springs_utilities");
  });
  it("loads a utility by id", () => {
    const utility = loadUtilityById("xcel_co");
    expect(utility?.displayName).toBe("Xcel Energy (CO)");
  });
  it("returns null for unknown id", () => {
    expect(loadUtilityById("nope")).toBeNull();
  });
});
```

Run: FAIL.

- [ ] **Step 2.2.3: Implement data-loader (initial, utility-only)**

```ts
import utilities from "./data/utilities.json";
import { z } from "zod";

const UtilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  states: z.array(z.string()),
  zips: z.array(z.string()).optional(),
  avgBlendedRateUsdPerKwh: z.number(),
});
const UtilitiesSchema = z.array(UtilitySchema);

const UTILITIES = UtilitiesSchema.parse(utilities);

export type Utility = z.infer<typeof UtilitySchema>;

export function loadUtilitiesForState(state: string, zip?: string): Utility[] {
  const filtered = UTILITIES.filter(u => u.states.includes(state));
  if (!zip) return filtered;
  // Zip-specific utilities sort first
  return [...filtered].sort((a, b) => {
    const aMatch = a.zips?.includes(zip) ? 1 : 0;
    const bMatch = b.zips?.includes(zip) ? 1 : 0;
    return bMatch - aMatch;
  });
}

export function loadUtilityById(id: string): Utility | null {
  return UTILITIES.find(u => u.id === id) ?? null;
}
```

Run tests: PASS.

- [ ] **Step 2.2.4: Commit**

```bash
git add src/lib/estimator/data/utilities.json src/lib/estimator/data-loader.ts src/__tests__/estimator/data-loader.test.ts
git commit -m "feat(estimator): utilities seed data and loader"
```

### Task 2.3: Production, pricing, incentives JSON + loaders

**Files:**
- Create: `src/lib/estimator/data/production.json`, `pricing.json`, `incentives.json`
- Modify: `src/lib/estimator/data-loader.ts`, `src/__tests__/estimator/data-loader.test.ts`

- [ ] **Step 2.3.1: Create `production.json`**

kWh/kW/year by state + shade bucket. Conservative-ish CO numbers and coastal-CA numbers:

```json
{
  "CO": { "light": 1550, "moderate": 1400, "heavy": 1150 },
  "CA": { "light": 1600, "moderate": 1450, "heavy": 1200 }
}
```

- [ ] **Step 2.3.2: Create `pricing.json`**

```json
{
  "basePricePerWatt": {
    "DTC": 3.00,
    "WESTY": 3.00,
    "COSP": 2.95,
    "CA": 3.50,
    "CAMARILLO": 3.50
  },
  "addOns": {
    "evCharger": 1800,
    "panelUpgrade": 3500
  },
  "financing": {
    "defaultApr": 0.07,
    "defaultTermMonths": 300
  }
}
```

- [ ] **Step 2.3.3: Create `incentives.json`**

```json
[
  { "id": "federal_itc_2026", "scope": "federal", "match": {}, "type": "percent", "value": 0.30, "label": "Federal Investment Tax Credit", "disclosure": "30% federal tax credit; subject to eligibility and ITC phase-down schedule." },
  { "id": "co_state_rebate_2026", "scope": "state", "match": { "state": "CO" }, "type": "fixed", "value": 500, "label": "Colorado state sales tax exemption estimated value" },
  { "id": "xcel_solar_rewards", "scope": "utility", "match": { "utilityId": "xcel_co" }, "type": "perWatt", "value": 0.05, "cap": 2500, "label": "Xcel Solar Rewards", "disclosure": "Rebate capped at $2,500." }
]
```

- [ ] **Step 2.3.4: Add loaders + failing tests**

Add to `data-loader.ts`:

```ts
import production from "./data/production.json";
import pricing from "./data/pricing.json";
import incentivesData from "./data/incentives.json";

const ProductionSchema = z.record(z.string(), z.record(z.enum(["light","moderate","heavy"]), z.number()));
const PricingSchema = z.object({
  basePricePerWatt: z.record(z.string(), z.number()),
  addOns: z.object({ evCharger: z.number(), panelUpgrade: z.number() }),
  financing: z.object({ defaultApr: z.number(), defaultTermMonths: z.number() }),
});
const IncentiveSchema = z.object({
  id: z.string(),
  scope: z.enum(["federal","state","utility","local"]),
  match: z.object({ state: z.string().optional(), zip: z.string().optional(), utilityId: z.string().optional() }),
  type: z.enum(["percent","fixed","perWatt"]),
  value: z.number(),
  cap: z.number().optional(),
  label: z.string(),
  disclosure: z.string().optional(),
});

const PRODUCTION = ProductionSchema.parse(production);
const PRICING = PricingSchema.parse(pricing);
const INCENTIVES = z.array(IncentiveSchema).parse(incentivesData);

export type ShadeBucket = "light" | "moderate" | "heavy";

export function loadKwhPerKwYear(state: string, shade: ShadeBucket): number {
  return PRODUCTION[state]?.[shade] ?? 1400; // default fallback
}
export function loadPricePerWatt(location: string): number {
  return PRICING.basePricePerWatt[location] ?? 3.20;
}
export function loadAddOnPricing() { return PRICING.addOns; }
export function loadFinancingDefaults() { return PRICING.financing; }

export type Incentive = z.infer<typeof IncentiveSchema>;

export function loadApplicableIncentives(opts: { state: string; zip: string; utilityId: string }): Incentive[] {
  return INCENTIVES.filter(i => {
    if (i.match.state && i.match.state !== opts.state) return false;
    if (i.match.zip && i.match.zip !== opts.zip) return false;
    if (i.match.utilityId && i.match.utilityId !== opts.utilityId) return false;
    return true;
  });
}
```

Add tests covering each loader — fall-back for unknown state, zip-specific vs state-wide incentives, etc.

Run: PASS.

- [ ] **Step 2.3.5: Commit**

```bash
git add src/lib/estimator/data/ src/lib/estimator/data-loader.ts src/__tests__/estimator/data-loader.test.ts
git commit -m "feat(estimator): production/pricing/incentives seed data and loaders"
```

---

## Chunk 3: Engine Core

### Task 3.1: Types + constants

**Files:**
- Create: `src/lib/estimator/types.ts`
- Create: `src/lib/estimator/constants.ts`

- [ ] **Step 3.1.1: Write types.ts**

Full `EstimatorInput` / `EstimatorResult` / `IncentiveRecord` / `QuoteType` / `Location` / `ShadeBucket` / `RoofType` per the spec's Engine Types section. No runtime code, pure types.

- [ ] **Step 3.1.2: Write constants.ts**

```ts
export const FALLBACK_PANEL_WATTAGE = 440;
export const DEFAULT_OFFSET_TARGET = 1.0;
export const EV_ADD_KWH_PER_YEAR = 3500;
export const HOT_TUB_ADD_KWH_PER_YEAR = 2500;
export const TOKEN_TTL_DAYS = 90;
export const RECAPTCHA_REJECT_THRESHOLD = 0.3;
export const RECAPTCHA_REVIEW_THRESHOLD = 0.5;
export const ESTIMATOR_SOURCE_STANDARD = "public_estimator_v2";
export const ESTIMATOR_SOURCE_MANUAL = "public_estimator_v2_manual";
```

- [ ] **Step 3.1.3: Commit**

```bash
git add src/lib/estimator/types.ts src/lib/estimator/constants.ts
git commit -m "feat(estimator): types and constants"
```

### Task 3.2: Sizing module (TDD)

**Files:**
- Create: `src/lib/estimator/sizing.ts`
- Create: `src/__tests__/estimator/sizing.test.ts`

- [ ] **Step 3.2.1: Write failing tests**

```ts
import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "@/lib/estimator/sizing";

describe("sizing.computeAnnualKwh", () => {
  it("converts monthly bill using utility rate", () => {
    expect(computeAnnualKwh({ kind: "bill", avgMonthlyBillUsd: 140 }, 0.14)).toBeCloseTo(12000, 0);
  });
  it("converts monthly kWh", () => {
    expect(computeAnnualKwh({ kind: "kwh", avgMonthlyKwh: 1000 }, 0.14)).toBe(12000);
  });
});

describe("sizing.computeTargetKwh", () => {
  it("adds EV load when planning EV", () => {
    expect(computeTargetKwh(10000, { planningEv: true, planningHotTub: false, needsPanelUpgrade: false, mayNeedNewRoof: false })).toBe(13500);
  });
  it("adds hot tub load", () => {
    expect(computeTargetKwh(10000, { planningEv: false, planningHotTub: true, needsPanelUpgrade: false, mayNeedNewRoof: false })).toBe(12500);
  });
  it("adds both when both set", () => {
    expect(computeTargetKwh(10000, { planningEv: true, planningHotTub: true, needsPanelUpgrade: false, mayNeedNewRoof: false })).toBe(16000);
  });
});

describe("sizing.sizeSystem", () => {
  it("sizes system to meet target within panel granularity", () => {
    const result = sizeSystem({ targetKwh: 12000, kWhPerKwYear: 1400, panelWattage: 440 });
    expect(result.panelCount).toBe(Math.ceil((12000 / 1400) * 1000 / 440));
    expect(result.systemKwDc).toBeCloseTo(result.panelCount * 440 / 1000, 5);
    expect(result.annualProductionKwh).toBeCloseTo(result.systemKwDc * 1400, 5);
  });
  it("caps offset at 100%", () => {
    const result = sizeSystem({ targetKwh: 12000, kWhPerKwYear: 1400, panelWattage: 440 });
    const offset = Math.min(100, (result.annualProductionKwh / 12000) * 100);
    expect(offset).toBeLessThanOrEqual(100);
  });
});
```

Run: FAIL.

- [ ] **Step 3.2.2: Implement sizing.ts**

```ts
import type { EstimatorInput } from "./types";
import { EV_ADD_KWH_PER_YEAR, HOT_TUB_ADD_KWH_PER_YEAR } from "./constants";

export function computeAnnualKwh(usage: EstimatorInput["usage"], utilityRateUsdPerKwh: number): number {
  if (usage.kind === "bill") return (usage.avgMonthlyBillUsd * 12) / utilityRateUsdPerKwh;
  return usage.avgMonthlyKwh * 12;
}

export function computeTargetKwh(annualKwh: number, considerations: EstimatorInput["considerations"]): number {
  let target = annualKwh;
  if (considerations.planningEv) target += EV_ADD_KWH_PER_YEAR;
  if (considerations.planningHotTub) target += HOT_TUB_ADD_KWH_PER_YEAR;
  return target;
}

export function sizeSystem(input: { targetKwh: number; kWhPerKwYear: number; panelWattage: number }) {
  const systemKwDcTarget = input.targetKwh / input.kWhPerKwYear;
  const panelCount = Math.ceil((systemKwDcTarget * 1000) / input.panelWattage);
  const systemKwDc = (panelCount * input.panelWattage) / 1000;
  const annualProductionKwh = systemKwDc * input.kWhPerKwYear;
  return { panelCount, systemKwDc, annualProductionKwh };
}
```

Run tests: PASS.

- [ ] **Step 3.2.3: Commit**

```bash
git add src/lib/estimator/sizing.ts src/__tests__/estimator/sizing.test.ts
git commit -m "feat(estimator): sizing module"
```

### Task 3.3: Pricing, incentives, financing modules (TDD)

**Files:**
- Create: `src/lib/estimator/pricing.ts`, `incentives.ts`, `financing.ts`
- Create: `src/__tests__/estimator/{pricing,incentives,financing}.test.ts`

- [ ] **Step 3.3.1: financing.ts + test (TDD)**

Test + implement:
```ts
// financing.ts
export function amortize(principal: number, apr: number, termMonths: number): number {
  if (principal <= 0) return 0;
  const r = apr / 12;
  if (r === 0) return principal / termMonths;
  const pow = Math.pow(1 + r, termMonths);
  return (principal * r * pow) / (pow - 1);
}
```

Tests: 0 principal = 0, 0 APR = principal/months, known-good case ($30k @ 7% / 300mo ≈ $212).

- [ ] **Step 3.3.2: pricing.ts + test (TDD)**

```ts
// pricing.ts
import type { EstimatorInput } from "./types";

export function computeRetail(input: { finalKwDc: number; pricePerWatt: number; addOns: EstimatorInput["addOns"]; addOnPricing: { evCharger: number; panelUpgrade: number } }) {
  const baseSystemUsd = input.finalKwDc * 1000 * input.pricePerWatt;
  const addOnsUsd =
    (input.addOns.evCharger ? input.addOnPricing.evCharger : 0) +
    (input.addOns.panelUpgrade ? input.addOnPricing.panelUpgrade : 0);
  const retailUsd = baseSystemUsd + addOnsUsd;
  return { baseSystemUsd, addOnsUsd, retailUsd };
}
```

Tests: no add-ons, both add-ons, EV only, panel upgrade only.

- [ ] **Step 3.3.3: incentives.ts + test (TDD)**

```ts
// incentives.ts
import type { IncentiveRecord } from "./types";

export function applyIncentives(opts: { incentives: IncentiveRecord[]; retailUsd: number; finalKwDc: number }) {
  const applied = opts.incentives.map(i => {
    let amount = 0;
    if (i.type === "fixed") amount = i.value;
    else if (i.type === "perWatt") amount = i.value * opts.finalKwDc * 1000;
    else if (i.type === "percent") amount = Math.min(opts.retailUsd * i.value, i.cap ?? Infinity);
    return { id: i.id, label: i.label, amountUsd: amount };
  });
  const total = applied.reduce((s, a) => s + a.amountUsd, 0);
  return { applied, totalUsd: total };
}
```

Tests: percent capped, fixed, perWatt, empty array, cap enforcement.

- [ ] **Step 3.3.4: Commit each module after its tests pass**

Three commits (financing, pricing, incentives).

### Task 3.4: Engine composition

**Files:**
- Create: `src/lib/estimator/engine.ts`
- Create: `src/__tests__/estimator/engine.test.ts`

- [ ] **Step 3.4.1: Write failing end-to-end test**

Test full engine on a representative Denver input. Compute expected values by hand:

- Inputs: 1000 kWh/mo (annualKwh = 12000), no EV/hot tub, moderate shade CO → kWhPerKwYear = 1400, 440W panels, $3/W DTC, 30% federal + $500 CO fixed + $0.05/W Xcel capped at $2500, no add-ons
- `targetKwh` = 12000
- `systemKwDcTarget` = 12000 / 1400 = 8.571 kW
- `panelCount` = ceil(8571 / 440) = 20
- `systemKwDc` = 20 × 440 / 1000 = 8.8 kW
- `annualProductionKwh` = 8.8 × 1400 = 12320 kWh
- `offsetPercent` = min(100, 12320 / 12000 × 100) = 100
- `baseSystemUsd` = 8800 × 3 = 26400
- `retailUsd` = 26400 (no add-ons)
- Federal: min(26400 × 0.30, ∞) = 7920
- CO state: 500
- Xcel: min(0.05 × 8800, 2500) = min(440, 2500) = 440
- `incentivesUsd` = 7920 + 500 + 440 = 8860
- `finalUsd` = 26400 − 8860 = 17540
- `monthlyPaymentUsd` = amortize(17540, 0.07, 300) ≈ 123.95

Write assertions using `toBeCloseTo(expected, 2)`.

- [ ] **Step 3.4.2: Implement engine.ts**

```ts
import type { EstimatorInput, EstimatorResult } from "./types";
import { computeAnnualKwh, computeTargetKwh, sizeSystem } from "./sizing";
import { computeRetail } from "./pricing";
import { applyIncentives } from "./incentives";
import { amortize } from "./financing";

export function runEstimator(input: EstimatorInput): EstimatorResult {
  const annualKwh = computeAnnualKwh(input.usage, input.utility.avgBlendedRateUsdPerKwh);
  const targetKwh = computeTargetKwh(annualKwh, input.considerations);
  const { panelCount, systemKwDc, annualProductionKwh } = sizeSystem({
    targetKwh,
    kWhPerKwYear: input.kWhPerKwYear,
    panelWattage: input.panelWattage,
  });
  const offsetPercent = Math.min(100, (annualProductionKwh / annualKwh) * 100);
  const { baseSystemUsd, addOnsUsd, retailUsd } = computeRetail({
    finalKwDc: systemKwDc,
    pricePerWatt: input.pricePerWatt,
    addOns: input.addOns,
    addOnPricing: input.addOnPricing,
  });
  const { applied: appliedIncentives, totalUsd: incentivesUsd } = applyIncentives({
    incentives: input.incentives,
    retailUsd,
    finalKwDc: systemKwDc,
  });
  const finalUsd = Math.max(0, retailUsd - incentivesUsd);
  const monthlyPaymentUsd = amortize(finalUsd, input.financing.apr, input.financing.termMonths);

  return {
    systemKwDc,
    panelCount,
    panelWattage: input.panelWattage,
    annualProductionKwh,
    annualConsumptionKwh: annualKwh,
    offsetPercent,
    pricing: {
      retailUsd,
      addOnsUsd,
      incentivesUsd,
      finalUsd,
      monthlyPaymentUsd,
      breakdown: {
        baseSystemUsd,
        lineItems: [
          ...(input.addOns.evCharger ? [{ label: "EV Charger + install", amountUsd: input.addOnPricing.evCharger }] : []),
          ...(input.addOns.panelUpgrade ? [{ label: "Main panel upgrade", amountUsd: input.addOnPricing.panelUpgrade }] : []),
        ],
        appliedIncentives,
      },
    },
    assumptions: [
      "Homeowner of the address provided",
      "Single-family home, no more than 2 stories",
      "Roof is structurally sound for the expected system weight",
      "Utility rate held constant (no escalation modeling)",
      "Incentive eligibility based on address only — final eligibility confirmed during consult",
      "System size is an estimate — final design may vary after site survey",
    ],
  };
}
```

Run tests: PASS.

- [ ] **Step 3.4.3: Commit**

```bash
git add src/lib/estimator/engine.ts src/__tests__/estimator/engine.test.ts
git commit -m "feat(estimator): engine composition"
```

### Task 3.5: Validation + index re-exports

**Files:**
- Create: `src/lib/estimator/validation.ts`, `index.ts`

- [ ] **Step 3.5.1: Write Zod schemas mirroring types**

Wire validation.ts with Zod schemas for `EstimatorInput`, `EstimatorResult`, the API request shapes for `address-validate`, `quote`, `submit`. Export inferred types.

- [ ] **Step 3.5.2: Write index.ts public exports**

```ts
export * from "./types";
export * from "./engine";
export * from "./validation";
export { runEstimator } from "./engine";
export { isInServiceArea, resolveLocationFromZip } from "./service-area";
export * from "./data-loader";
```

- [ ] **Step 3.5.3: Commit**

```bash
git add src/lib/estimator/validation.ts src/lib/estimator/index.ts
git commit -m "feat(estimator): validation schemas and public exports"
```

---

## Chunk 4: API Routes

### Task 4.1: Middleware + env scaffolding

**Files:**
- Modify: `src/middleware.ts`
- Modify: `.env.example`

- [ ] **Step 4.1.1: Add routes to middleware allowlists**

In `src/middleware.ts`, add `"/estimator"` to the `ALWAYS_ALLOWED` array and `"/api/estimator"` to `PUBLIC_API_ROUTES`.

**Middleware flow trace (confirmed)** — `PUBLIC_API_ROUTES` check at line ~242 returns early before the role-check branch, so `/api/estimator/*` bypasses role lookup entirely regardless of whether the caller is authenticated. No `roles.ts` changes needed.

- [ ] **Step 4.1.2: Add env vars to `.env.example`**

```
# Estimator v2
NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=false
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
IP_HASH_SALT=
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=
GOOGLE_MAPS_STATIC_API_KEY=
```

- [ ] **Step 4.1.3: Commit**

```bash
git add src/middleware.ts .env.example
git commit -m "feat(estimator): public route allowlist and env scaffolding"
```

### Task 4.2: `POST /api/estimator/address-validate`

**Files:**
- Create: `src/app/api/estimator/address-validate/route.ts`
- Create: `src/__tests__/estimator/api/address-validate.test.ts`

- [ ] **Step 4.2.1: Integration test**

Mock `fetch` to Google Geocode. Assert:
- Valid CO zip → 200 with `{ inServiceArea: true, location: "DTC", utilities: [...] }`
- Invalid zip → 200 with `{ inServiceArea: false }`
- Malformed body → 400
- Rate limit → 429 after 20 calls/minute from same IP

- [ ] **Step 4.2.2: Implement route**

Behavior:
1. Zod-validate body `{ address: string }` (full single-line address acceptable; Google will parse).
2. Apply rate limit (20/min per IP-hash).
3. Call Google Geocode. Grep `src/lib/` for an existing geocode helper first (likely inside `property-sync.ts` or its neighborhood). If none is exported, add a minimal `geocodeAddress(address): Promise<{ lat, lng, street, city, state, zip, formatted }>` to `src/lib/geocode.ts` using `GOOGLE_GEOCODING_API_KEY` (or the existing Google key already configured in the repo). Export and reuse.
4. Extract `zip`, call `resolveLocationFromZip`.
5. If in-service-area, call `loadUtilitiesForState(state, zip)`.
6. Return JSON: `{ normalized: { lat, lng, street, city, state, zip, formatted }, inServiceArea, location, utilities }`.

- [ ] **Step 4.2.3: Commit**

### Task 4.3: `GET /api/estimator/utilities?state=&zip=`

**Files:**
- Create: `src/app/api/estimator/utilities/route.ts`
- Create: `src/__tests__/estimator/api/utilities.test.ts`

Simple wrapper around `loadUtilitiesForState`. Rate-limited 60/min per IP.

### Task 4.4: `POST /api/estimator/quote`

**Files:**
- Create: `src/app/api/estimator/quote/route.ts`
- Create: `src/__tests__/estimator/api/quote.test.ts`

- [ ] **Step 4.4.1: Integration test**

Post a representative input, assert the returned `EstimatorResult` shape and that key numbers are in-range for a Denver example.

- [ ] **Step 4.4.2: Implement route**

1. Zod-validate body.
2. Apply rate limit (30/min per IP-hash).
3. Resolve production/pricing/incentives from data-loaders.
4. Resolve panel wattage: query `InternalProduct.findFirst({ where: { category: "MODULE", defaultForEstimator: true, status: "ACTIVE" }, include: { moduleSpec: true }})`; fall back to `FALLBACK_PANEL_WATTAGE` with Sentry warning.
5. Run engine, return result.

- [ ] **Step 4.4.3: Commit**

### Task 4.5: `POST /api/estimator/submit`

**Files:**
- Create: `src/app/api/estimator/submit/route.ts`
- Create: `src/lib/estimator/hubspot.ts`, `recaptcha.ts`, `hash.ts`, `rate-limit.ts`
- Create: `src/__tests__/estimator/api/submit.test.ts`

- [ ] **Step 4.5.1: hash.ts — re-export/wrap hash algorithm**

`src/lib/address-hash.ts` already exports the canonical `addressHash(parts)` helper used by the Property Object webhook. From `src/lib/estimator/hash.ts`:

```ts
export { addressHash } from "@/lib/address-hash";
```

Do not reimplement — keeping this single source of truth is critical so the estimator's hash matches the HubSpotPropertyCache row that the webhook later creates.

- [ ] **Step 4.5.2: recaptcha.ts**

```ts
export async function verifyRecaptcha(token: string, action: string): Promise<{ success: boolean; score: number | null }> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.warn("RECAPTCHA_SECRET_KEY not configured — allowing with null score");
    return { success: true, score: null };
  }
  const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = await resp.json();
  return { success: !!data.success && (!action || data.action === action), score: typeof data.score === "number" ? data.score : null };
}
```

- [ ] **Step 4.5.3: rate-limit.ts**

The `RateLimit` Prisma model is `{ identifier (unique), count, windowStart, expiresAt }` — fixed-window. Implement:

```ts
// src/lib/estimator/rate-limit.ts
import { prisma } from "@/lib/db";

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  // Atomic upsert-and-increment via a transaction.
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimit.findUnique({ where: { identifier: key } });
    if (!existing || existing.windowStart < windowStart) {
      // Start a new window
      await tx.rateLimit.upsert({
        where: { identifier: key },
        create: { identifier: key, count: 1, windowStart: now, expiresAt: new Date(now.getTime() + windowMs) },
        update: { count: 1, windowStart: now, expiresAt: new Date(now.getTime() + windowMs) },
      });
      return true;
    }
    if (existing.count >= limit) return false;
    await tx.rateLimit.update({ where: { identifier: key }, data: { count: { increment: 1 } } });
    return true;
  });
  return result;
}

export function ipHashKey(prefix: string, ipHash: string): string {
  return `estimator:${prefix}:${ipHash}`;
}
```

Identifier composition: `estimator:submit:${ipHash}`, `estimator:quote:${ipHash}`, `estimator:address-validate:${ipHash}`. Check the existing `RateLimit` schema for the exact `expiresAt` field — if absent, remove from upsert.

- [ ] **Step 4.5.4: hubspot.ts — lead creation helpers**

Build `upsertEstimatorContact(input)` and `createEstimatorDeal(input)` calling existing HubSpot primitives in `lib/hubspot.ts`. If there's no deal-create primitive, add one there (smallest addition needed for our use case — name, pipeline, stage, contactId, properties).

- [ ] **Step 4.5.5: Integration test for submit**

Mock HubSpot, email, recaptcha. Assert:
- Happy path: `EstimatorRun` created; `hubspotContactId` and `hubspotDealId` populated; email sent; token returned.
- Idempotent: second submit with same inputs returns same token, no dupe HubSpot writes.
- HubSpot failure: `EstimatorRun` still created (with nulls); token returned; Sentry warn.
- Recaptcha score 0.2: 403.
- Recaptcha score 0.4: submission accepted with `flaggedForReview: true`.
- Out-of-area: no deal created.
- Manual quote request: no engine re-run; deal created with source = manual.

- [ ] **Step 4.5.6: Implement submit route**

Per spec's Submit Sequence section.

- [ ] **Step 4.5.7: Commit**

### Task 4.6: `GET /api/estimator/result/[token]`

**Files:**
- Create: `src/app/api/estimator/result/[token]/route.ts`

Behavior: `prisma.estimatorRun.findUnique({ where: { token }})`; if null or `expiresAt < now`, return 404; else return `{ input: inputSnapshot, result: resultSnapshot, assumptions, quoteType }`. No PII returned (no contactSnapshot).

### Task 4.7: Static-map proxy + cron routes

**Files:**
- Create: `src/app/api/estimator/static-map/route.ts`
- Create: `src/app/api/cron/estimator-cleanup/route.ts`
- Create: `src/app/api/cron/estimator-hubspot-reconcile/route.ts`

- **static-map**: Proxies `https://maps.googleapis.com/maps/api/staticmap?...&key=${GOOGLE_MAPS_STATIC_API_KEY}` so the server-side key isn't exposed. Accepts `?lat=&lng=` and returns image bytes with cache headers.

- **cleanup cron**: Deletes `EstimatorRun` rows where `expiresAt < now()`. Guarded by cron secret like existing cron endpoints.

- **reconcile cron**: For each `EstimatorRun` with `hubspotDealId IS NULL AND createdAt < now() - 15min AND outOfArea = false AND manualQuoteRequest = false AND retryCount < 3`, re-try HubSpot upsert + deal create. `retryCount` is already on the model from Chunk 1.

- [ ] **Step 4.7.1: Implement all three routes with tests**

Cron-secret guard pattern: inspect another existing `/api/cron/*` route (e.g., `src/app/api/cron/audit-digest/route.ts`) for the header check; mirror it.

- [ ] **Step 4.7.2: Register crons in `vercel.json`**

Append to the `crons` array:

```json
{
  "path": "/api/cron/estimator-cleanup",
  "schedule": "0 3 * * *"
},
{
  "path": "/api/cron/estimator-hubspot-reconcile",
  "schedule": "*/20 * * * *"
}
```

No `functions` entry needed — both default to 60s, which is plenty. If reconcile ever needs longer under load, add an entry later.

- [ ] **Step 4.7.3: Commit**

---

## Chunk 5: Public UI — Wizard

### Task 5.1: Layout + entry page

**Files:**
- Create: `src/app/estimator/layout.tsx` (minimal public layout, brand header, no DashboardShell, no auth checks)
- Create: `src/app/estimator/page.tsx` (server component — if flag off, render "coming soon"; if on, redirect to `/estimator/new-install`)

- [ ] **Step 5.1.1: Implement + manual verify via `npm run dev` + Chrome MCP**

### Task 5.2: Wizard shell + step state machine

**Files:**
- Create: `src/app/estimator/new-install/page.tsx`
- Create: `src/app/estimator/new-install/components/StepLayout.tsx`
- Create: `src/app/estimator/new-install/state.ts` (Zustand or simple context + reducer; prefer React Query + URL state, no new dep)

- [ ] **Step 5.2.1: Build step state via URL query param (`?step=address|roof|usage|contact`)**

Pattern:
- Top-level client component reads `useSearchParams().get("step")` and renders the matching step.
- Form state kept in React state + `sessionStorage` for refresh survival.
- Back/forward buttons use `router.push(`/estimator/new-install?step=…`)`.

- [ ] **Step 5.2.2: Commit**

### Task 5.3: AddressStep

**Files:**
- Create: `src/app/estimator/new-install/components/AddressStep.tsx`

- [ ] **Step 5.3.1: Integrate Google Places Autocomplete**

Use `@react-google-maps/api` if already in the repo; otherwise use the raw Google Places JS library loaded via `<Script>` in layout. Fallback: manual address form.

- [ ] **Step 5.3.2: On submit, POST to `/api/estimator/address-validate`**

- If `inServiceArea: false`, `router.push("/estimator/out-of-area?zip=...")`.
- Else store resolved address + utilities in state, advance to `?step=roof`.

- [ ] **Step 5.3.3: Manual verify with Chrome MCP**

Drive to `/estimator/new-install`, type an address, confirm advancement.

- [ ] **Step 5.3.4: Commit**

### Task 5.4: RoofConfirmStep

**Files:**
- Create: `src/app/estimator/new-install/components/RoofConfirmStep.tsx`

- [ ] **Step 5.4.1: Render `<img src="/api/estimator/static-map?lat=...&lng=..."/>`**

- [ ] **Step 5.4.2: Yes → advance to `?step=usage`. No → back to address.**

- [ ] **Step 5.4.3: Commit**

### Task 5.5: UsageStep + UtilityFallback

**Files:**
- Create: `src/app/estimator/new-install/components/UsageStep.tsx`
- Create: `src/app/estimator/new-install/components/UtilityFallback.tsx`

- [ ] **Step 5.5.1: Form**: utility dropdown, usage tabs (bill XOR kWh), roof type, shade, heat pump, considerations

- [ ] **Step 5.5.2: "Don't see your provider?"**: opens UtilityFallback → POST submit `kind: manual_quote_request` → confirmation screen

- [ ] **Step 5.5.3: On continue: advance to `?step=contact`**

### Task 5.6: ContactStep + reCAPTCHA

**Files:**
- Create: `src/app/estimator/new-install/components/ContactStep.tsx`

- [ ] **Step 5.6.1: reCAPTCHA v3 integration**

Load `https://www.google.com/recaptcha/api.js?render=${NEXT_PUBLIC_RECAPTCHA_SITE_KEY}` via `<Script>`. On submit, `grecaptcha.execute(siteKey, { action: "estimator_submit" })` → attach token to request.

- [ ] **Step 5.6.2: POST to `/api/estimator/submit`** with full collected state. On success, `router.push(`/estimator/results/${token}`)`.

### Task 5.7: Results page

**Files:**
- Create: `src/app/estimator/results/[token]/page.tsx`

- [ ] **Step 5.7.1: Server component fetches `/api/estimator/result/[token]`**

404 if expired or missing. Otherwise render:
- Hero: system kW, panel count, offset %
- ± panel count buttons (re-price via `/api/estimator/quote` on click)
- Price card: retail, incentives itemized, final, monthly payment
- Toggles: EV charger, panel upgrade (re-price)
- Assumptions footer
- "Schedule Consultation" CTA → `https://www.photonbrothers.com/free-solar-estimate`

Progressive enhancement: server renders first state; client takes over for add-on toggles.

- [ ] **Step 5.7.2: Commit**

### Task 5.8: Out-of-area page

**Files:**
- Create: `src/app/estimator/out-of-area/page.tsx`

- [ ] **Step 5.8.1: Form collecting first name / last name / email; on submit POST `{ kind: "out_of_area", zip, ...contact }`**

- [ ] **Step 5.8.2: Thank-you screen after submit.**

- [ ] **Step 5.8.3: Commit**

---

## Chunk 6: Email templates

### Task 6.1: Three React Email templates

**Files:**
- Create: `src/emails/EstimatorResultsEmail.tsx`, `EstimatorWaitlistEmail.tsx`, `EstimatorManualQuoteEmail.tsx`

- [ ] **Step 6.1.1: Inspect existing template patterns** (`src/emails/SchedulingNotification.tsx`) for layout conventions. Mirror the brand header/footer.

- [ ] **Step 6.1.2: EstimatorResultsEmail** — subject, summary of system size + price, prominent CTA link to `/estimator/results/[token]`, note about consultation next step.

- [ ] **Step 6.1.3: EstimatorWaitlistEmail** — thank-you for out-of-area zip, "we'll let you know when we expand."

- [ ] **Step 6.1.4: EstimatorManualQuoteEmail** — "got your info, we'll reach out to quote your utility-X setup manually."

- [ ] **Step 6.1.5: Verify with `npm run email:preview`**

- [ ] **Step 6.1.6: Commit**

### Task 6.2: Wire email sending from submit route

- [ ] **Step 6.2.1: In `/api/estimator/submit`, after persist + HubSpot, call `sendEmail()` with the matching template**

- [ ] **Step 6.2.2: Wrap in try/catch — log to Sentry on failure, never throw**

- [ ] **Step 6.2.3: Commit**

---

## Chunk 7: Rollout + verification

### Task 7.1: Feature-flag UI entry

**Files:**
- Modify: `src/app/estimator/page.tsx`, `layout.tsx`, marketing-site link if relevant

- [ ] **Step 7.1.1: Gate all `/estimator/*` pages behind `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED`**

If off, show "Coming soon" placeholder.

- [ ] **Step 7.1.2: Commit**

### Task 7.2: End-to-end manual verification

- [ ] **Step 7.2.1: Start dev server (`npm run dev`) + Chrome MCP walk-through**

1. Navigate to `/estimator/new-install?step=address`, enter a Denver address.
2. Confirm roof step renders satellite tile.
3. Fill usage step; select Xcel.
4. Fill contact step; submit.
5. Verify results page loads with sane numbers.
6. Toggle EV charger add-on; verify price updates.
7. Toggle back; verify restore.
8. Refresh at `/estimator/results/[token]`; verify persistence.

- [ ] **Step 7.2.2: Network tab: confirm no 500s, no leaked API keys in client calls.**

- [ ] **Step 7.2.3: Out-of-area verification**: submit with zip 99999; verify waitlist flow.

- [ ] **Step 7.2.4: Manual-quote-request verification**: click "Don't see your provider?" on usage step; submit.

### Task 7.3: Final checks and docs

- [ ] **Step 7.3.1: Run full test suite**: `npm test`
- [ ] **Step 7.3.2: Run lint + build**: `npm run lint && npm run build`
- [ ] **Step 7.3.3: Update `CLAUDE.md` with Estimator section** under Major Systems (short — one paragraph + file pointers).
- [ ] **Step 7.3.4: Update the spec's Rollout section with any migration/env order notes discovered during implementation**

### Task 7.3a: Vercel prod env sync

Per `feedback_vercel_env_sync.md`, new env vars must be in Vercel prod BEFORE the code ships. Create a checklist in the runbook (below) covering:

- `NEXT_PUBLIC_ESTIMATOR_V2_ENABLED=false` (ship disabled)
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`
- `IP_HASH_SALT` (generate with `openssl rand -hex 32`)
- `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`
- `GOOGLE_MAPS_STATIC_API_KEY`

Verify with `vercel env ls production`.

### Task 7.4: Document remaining human actions

Create `docs/superpowers/runbooks/estimator-v2-rollout.md` with:

1. Order of operations: apply Prisma migration → push Vercel env vars → deploy code (flag off) → create HubSpot properties → flip flag for staff IPs → monitor → gradual rollout.
2. HubSpot custom property creation checklist (copy from spec).
3. Env var checklist.
4. Rollback plan (flag off).

- [ ] **Step 7.4.1: Commit**

---

## Out-of-Band: Deferred to Phase 2/3

Items explicitly out of this plan (Phase 2+ specs will cover):
- EV Charger / Home Backup Battery / Detach & Reset / System Expansion quote flows
- Internal rep-facing dashboard estimator at `/dashboards/estimator`
- Admin UI for incentives/utilities/service-area editing
- v12 engine integration
- EagleView roof measurement
- Shareable result editing (users currently see-only)
