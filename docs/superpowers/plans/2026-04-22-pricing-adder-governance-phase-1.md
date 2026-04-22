# Pricing & Adder Governance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the Pricing & Adder Governance initiative — a governed Adder Catalog in PB Ops Suite, a mobile-first point-of-sale Triage flow that captures adders during the in-home consult, one-way sync to OpenSolar, and refactor the in-house pricing calculator to source adder constants from the catalog instead of hardcoded arrays.

**Architecture:** Prisma models back the catalog (Adder + AdderShopOverride + AdderRevision + AdderSyncRun + TriageRun). Pure functions in `src/lib/adders/` handle CRUD, predicate evaluation, shop override resolution, and OpenSolar sync. API routes under `/api/adders/*` and `/api/triage/*` expose the surface. Two dashboard pages (`/dashboards/adders` owner UI, `/triage` rep-facing mobile) consume the API. Existing `src/lib/pricing-calculator.ts` is refactored to receive resolved catalog rows instead of reading hardcoded constants.

**Tech Stack:** Next.js 16.1 App Router, Prisma 7.3 on Neon Postgres, TypeScript 5, React 19, Tailwind v4, React Query v5, Jest. HubSpot integration via existing `src/lib/hubspot.ts`. S3 presigned-URL pattern matching `src/app/api/catalog/upload-photo`. Auth via next-auth v5 + existing `canManageAdders` permission boolean added to `src/lib/roles.ts`.

**Spec:** `docs/superpowers/specs/2026-04-22-pricing-adder-governance-design.md` (same branch).

**Pre-Phase Discovery — blocks code work:** Before starting Chunk 6 (OpenSolar Sync), confirm OpenSolar's adder lockdown capability, per-shop pricing model, and write API endpoints. Chunks 1–5 can proceed in parallel; Chunk 6 escalates to brainstorming if Pre-Phase Discovery reveals a hard blocker.

**Chunk layout:**

| # | Chunk | Ships What |
|---|-------|-----------|
| 1 | Data Model + API Foundation + Role Access + Seed | Governed catalog in DB, manageable via API, no UI |
| 2 | Catalog UI (`/dashboards/adders`) | Owner can maintain the catalog visually |
| 3 | Triage Recommendation Engine + API | Triage works via API, callable by anything |
| 4 | Triage Mobile UI + Deal-Detail Embed | Reps capture adders in the field |
| 5 | Pricing Calculator Refactor + IDR Integration | Calc + IDR both sourced from catalog |
| 6 | OpenSolar Sync + Rollout | Two-way loop closed; ready for cutover |

---

## File Structure

**New files (by chunk that creates them):**

Chunk 1 — Foundation:
- `prisma/migrations/<timestamp>_adder_catalog/migration.sql`
- `src/lib/adders/types.ts` — shared TS interfaces
- `src/lib/adders/zod-schemas.ts` — zod validation for triggerLogic, appliesTo, CRUD DTOs
- `src/lib/adders/applies-to.ts` — predicate parser + evaluator (pure)
- `src/lib/adders/pricing.ts` — VALID_SHOPS const + shop override resolver (stub; full `resolveAddersForCalc` lands in Chunk 5)
- `src/lib/adders/catalog.ts` — CRUD helpers (create, update, retire, list, getById, listRevisions)
- `src/app/api/adders/route.ts` — GET list, POST create
- `src/app/api/adders/[id]/route.ts` — GET, PATCH
- `src/app/api/adders/[id]/retire/route.ts` — POST
- `src/app/api/adders/[id]/revisions/route.ts` — GET
- `scripts/seed-adders.ts` — one-time import from Phase 0 CSV
- `src/__tests__/adders/applies-to.test.ts`
- `src/__tests__/adders/pricing-shop-override.test.ts`
- `src/__tests__/adders/catalog.test.ts`
- `src/__tests__/adders/seed-integrity.test.ts`

Chunk 2 — Catalog UI:
- `src/app/dashboards/adders/page.tsx`
- `src/app/dashboards/adders/AdderEditForm.tsx`
- `src/app/dashboards/adders/AdderRevisionsDrawer.tsx`
- `src/app/dashboards/adders/SyncStatusBadge.tsx` (renders placeholder until Chunk 6)
- `src/app/dashboards/adders/TriggerLogicBuilder.tsx` — predicate UI
- `src/app/dashboards/adders/ShopOverrideGrid.tsx`

Chunk 3 — Triage API:
- `src/lib/adders/triage.ts` — pure-function predicate evaluator
- `src/app/api/triage/recommend/route.ts`
- `src/app/api/triage/runs/route.ts`
- `src/app/api/triage/runs/[id]/route.ts`
- `src/app/api/triage/runs/[id]/submit/route.ts`
- `src/app/api/triage/upload/route.ts`
- `src/__tests__/adders/triage.test.ts`
- `src/__tests__/adders/triage-submit.test.ts`

Chunk 4 — Triage UI:
- `src/app/triage/page.tsx`
- `src/app/triage/TriageStepper.tsx`
- `src/app/triage/TriagePhotoCapture.tsx`
- `src/app/triage/TriageReview.tsx`
- `src/app/triage/useOfflineDraft.ts` — localStorage sync hook
- `src/components/deal-detail/TriageButton.tsx`

Chunk 5 — Calculator Refactor:
- `src/__tests__/pricing-calculator-catalog.test.ts`

Chunk 6 — Sync:
- `src/lib/adders/sync.ts`
- `src/app/api/adders/sync/route.ts`
- `src/app/api/cron/adders-sync/route.ts`
- `src/__tests__/adders/sync.test.ts`
- `docs/superpowers/runbooks/adder-catalog-cutover.md`

**Modified files:**
- `prisma/schema.prisma` — add 5 models + 6 enums (Chunk 1)
- `src/lib/roles.ts` — add `canManageAdders` permission + per-role defaults + new API routes in allowedRoutes (Chunk 1 for catalog routes; Chunks 3 & 6 extend for triage + sync routes)
- `src/middleware.ts` — add `/api/cron/adders-sync` to cron-authenticated path list (Chunk 6)
- `src/lib/pricing-calculator.ts` — remove hardcoded constants, accept resolved adders, `customAdders` array, fix percentage-loop bug, fix `peEnergyCommunnity` typo (Chunk 5)
- `src/app/dashboards/idr-meeting/PricingBreakdown.tsx` — read from catalog (Chunk 5)
- `src/__tests__/pricing-calculator.test.ts` — extend existing regression suite (Chunk 5)

---

## Chunk 1: Data Model + API Foundation + Role Access + Seed

**Goal:** Ship a governed adder catalog backed by Postgres, manageable via REST API, with role-gated access. No UI yet; no OpenSolar sync yet; no triage yet. At the end of this chunk the catalog can be created, edited, retired, and queried via HTTP, and the seed script has loaded the Phase 0 CSV.

**Dependencies:** Phase 0 canonical CSV exists at `scripts/data/adders-seed.csv` (deliverable from Phase 0 — if not yet available, use `scripts/data/adders-seed.example.csv` with 3 representative rows as placeholder; seed test uses the example).

### Task 1.1: Add Prisma enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Open `prisma/schema.prisma` and add the following enum blocks at the end of the file (after the last existing enum):

```prisma
enum AdderCategory {
  ELECTRICAL
  ROOFING
  STRUCTURAL
  SITEWORK
  LOGISTICS
  DESIGN
  PERMITTING
  REMOVAL
  ORG
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

enum AdderSyncRunStatus {
  RUNNING
  SUCCESS
  PARTIAL
  FAILED
}

enum AdderSyncTrigger {
  ON_SAVE
  CRON
  MANUAL
}
```

Note: existing `SyncRunStatus` and `SyncTrigger` may already exist for other features — prefix these with `Adder` to avoid collision. If `rg '^enum SyncRunStatus' prisma/schema.prisma` returns empty, drop the prefix.

- [ ] **Step 2:** Verify schema parses cleanly.

Run: `npx prisma validate`
Expected: `Prisma schema loaded from prisma/schema.prisma` with no errors.

- [ ] **Step 3:** Commit.

```bash
git add prisma/schema.prisma
git commit -m "feat(adders): add Prisma enums for adder catalog"
```

### Task 1.2: Add Prisma models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1:** Add the following model blocks to `prisma/schema.prisma`, placed after the enum block added in Task 1.1:

```prisma
model Adder {
  id                 String   @id @default(cuid())
  code               String   @unique
  name               String
  category           AdderCategory
  type               AdderType      @default(FIXED)
  direction          AdderDirection @default(ADD)
  autoApply          Boolean        @default(false)
  appliesTo          String?
  triggerCondition   String?
  triageQuestion     String?
  triageAnswerType   TriageAnswerType?
  triageChoices      Json?
  triggerLogic       Json?
  photosRequired     Boolean        @default(false)
  unit               AdderUnit
  basePrice          Decimal
  baseCost           Decimal
  marginTarget       Decimal?
  active             Boolean        @default(true)
  notes              String?
  openSolarId        String?
  createdBy          String
  updatedBy          String
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  overrides          AdderShopOverride[]
  revisions          AdderRevision[]

  @@index([category, active])
}

model AdderShopOverride {
  id         String   @id @default(cuid())
  adderId    String
  shop       String
  priceDelta Decimal
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  adder      Adder    @relation(fields: [adderId], references: [id], onDelete: Cascade)

  @@unique([adderId, shop])
}

model AdderRevision {
  id         String   @id @default(cuid())
  adderId    String
  snapshot   Json
  changedBy  String
  changedAt  DateTime @default(now())
  changeNote String?

  adder      Adder    @relation(fields: [adderId], references: [id], onDelete: Cascade)

  @@index([adderId, changedAt])
}

model AdderSyncRun {
  id           String              @id @default(cuid())
  startedAt    DateTime            @default(now())
  finishedAt   DateTime?
  status       AdderSyncRunStatus
  trigger      AdderSyncTrigger
  addersPushed Int                 @default(0)
  addersFailed Int                 @default(0)
  errorLog     Json?
}

model TriageRun {
  id                 String    @id @default(cuid())
  dealId             String?
  prelimAddress      Json?
  runBy              String
  runAt              DateTime  @default(now())
  answers            Json
  recommendedAdders  Json
  selectedAdders     Json
  photos             Json?
  submitted          Boolean   @default(false)
  submittedAt        DateTime?
  hubspotLineItemIds Json?
  notes              String?

  @@index([dealId, runAt])
}
```

- [ ] **Step 2:** Validate.

Run: `npx prisma validate`
Expected: no errors.

- [ ] **Step 3:** Format.

Run: `npx prisma format`
Expected: schema rewritten with consistent formatting; no content changes beyond whitespace.

- [ ] **Step 4:** Commit.

```bash
git add prisma/schema.prisma
git commit -m "feat(adders): add Prisma models for adder catalog and triage runs"
```

### Task 1.3: Generate migration

**Files:**
- Create: `prisma/migrations/<timestamp>_adder_catalog/migration.sql`

Per CLAUDE.md: "Do NOT run `prisma migrate deploy` automatically." This task generates the migration file only; deploy is a manual step the user runs. Subagents must not invoke migrate deploy.

- [ ] **Step 1:** Generate migration file (local dev DB).

Run: `npx prisma migrate dev --create-only --name adder_catalog`
Expected: new directory `prisma/migrations/<timestamp>_adder_catalog/` with `migration.sql` inside. No DB apply yet if `--create-only` is honored; review the SQL before apply.

- [ ] **Step 2:** Inspect migration SQL and confirm it creates the expected tables, enums, indexes, and unique constraints.

Run: `cat prisma/migrations/<latest>_adder_catalog/migration.sql | head -200`
Expected: `CREATE TYPE "AdderCategory"`, `CREATE TABLE "Adder"`, `CREATE TABLE "AdderShopOverride"`, `CREATE UNIQUE INDEX` on `(adderId, shop)`, `CREATE INDEX` on `(category, active)`, and similar for the other models.

- [ ] **Step 3:** Apply migration locally to smoke test (dev DB only).

Run: `npx prisma migrate dev`
Expected: migration applies cleanly to local dev DB; `prisma generate` runs; client reflects new models.

- [ ] **Step 4:** Verify generated client types.

Run: `npx tsc --noEmit`
Expected: compiles (no type errors from new Prisma types).

- [ ] **Step 5:** Commit.

```bash
git add prisma/migrations
git commit -m "feat(adders): generate adder catalog migration (not yet deployed to prod)"
```

### Task 1.4: Shared TypeScript types

**Files:**
- Create: `src/lib/adders/types.ts`

- [ ] **Step 1:** Create `src/lib/adders/types.ts` with:

```typescript
import type {
  Adder,
  AdderShopOverride,
  AdderRevision,
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma";

export type { Adder, AdderShopOverride, AdderRevision };
export {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
};

/** Adder row enriched with its shop overrides. */
export type AdderWithOverrides = Adder & { overrides: AdderShopOverride[] };

/**
 * `triggerLogic` predicate evaluated against a triage answer.
 * Phase 1: single-predicate only — no and/or combinators.
 */
export type TriggerLogic = {
  op: "lt" | "lte" | "eq" | "gte" | "gt" | "contains" | "truthy";
  value?: number | string | boolean;
  qtyFrom?: "answer" | "constant";
  qtyConstant?: number;
};

/**
 * `appliesTo` predicate for auto-apply adders.
 * Phase 1: single-predicate only — no boolean combinators.
 *
 * Supported LHS identifiers: shop, deal.dealType, deal.valueCents, now.
 * Supported ops: ==, !=, <, <=, >, >=, in, not in.
 */
export type AppliesToContext = {
  shop?: string;
  deal?: { dealType?: string; valueCents?: number };
  now?: Date;
};

/** A pricing-ready adder with its shop-resolved unit price. */
export type ResolvedAdder = {
  code: string;
  name: string;
  category: AdderCategory;
  type: AdderType;
  direction: AdderDirection;
  unit: AdderUnit;
  unitPrice: number; // basePrice + shop delta; positive even for DISCOUNT
  qty: number;
  amount: number; // signed: negative when direction=DISCOUNT
};
```

- [ ] **Step 2:** Verify typecheck.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/lib/adders/types.ts
git commit -m "feat(adders): shared types for adder catalog module"
```

### Task 1.5: `applies-to` predicate parser + evaluator (TDD)

**Files:**
- Test: `src/__tests__/adders/applies-to.test.ts`
- Create: `src/lib/adders/applies-to.ts`

- [ ] **Step 1:** Write failing tests.

Create `src/__tests__/adders/applies-to.test.ts`:

```typescript
import { parseAppliesTo, evaluateAppliesTo } from "@/lib/adders/applies-to";

describe("parseAppliesTo", () => {
  test.each([
    ["shop == 'DTC'", { lhs: "shop", op: "==", rhs: "DTC" }],
    ["deal.valueCents > 1000000", { lhs: "deal.valueCents", op: ">", rhs: 1_000_000 }],
    ["shop in ['SLO','Camarillo']", { lhs: "shop", op: "in", rhs: ["SLO", "Camarillo"] }],
    ["deal.dealType != 'PE'", { lhs: "deal.dealType", op: "!=", rhs: "PE" }],
    ["now < '2026-04-01'", { lhs: "now", op: "<", rhs: new Date("2026-04-01") }],
  ])("parses %s", (input, expected) => {
    expect(parseAppliesTo(input)).toEqual(expected);
  });

  test.each([
    "shop == 'DTC' && shop == 'WESTY'", // boolean combinator banned
    "shop === 'DTC'",                    // invalid op
    "unknown.field == 1",                // unknown identifier
    "'DTC' == shop",                     // LHS must be identifier
    "",                                  // empty
  ])("rejects invalid input: %s", (input) => {
    expect(() => parseAppliesTo(input)).toThrow();
  });
});

describe("evaluateAppliesTo", () => {
  test("shop == literal matches", () => {
    expect(evaluateAppliesTo("shop == 'DTC'", { shop: "DTC" })).toBe(true);
    expect(evaluateAppliesTo("shop == 'DTC'", { shop: "SLO" })).toBe(false);
  });

  test("shop in list matches any member", () => {
    expect(evaluateAppliesTo("shop in ['SLO','Camarillo']", { shop: "SLO" })).toBe(true);
    expect(evaluateAppliesTo("shop in ['SLO','Camarillo']", { shop: "DTC" })).toBe(false);
  });

  test("deal.valueCents numeric comparison", () => {
    expect(evaluateAppliesTo("deal.valueCents > 1000000", { deal: { valueCents: 1_500_000 } })).toBe(true);
    expect(evaluateAppliesTo("deal.valueCents > 1000000", { deal: { valueCents: 500_000 } })).toBe(false);
  });

  test("now date comparison", () => {
    expect(evaluateAppliesTo("now < '2026-04-01'", { now: new Date("2026-03-15") })).toBe(true);
    expect(evaluateAppliesTo("now < '2026-04-01'", { now: new Date("2026-05-01") })).toBe(false);
  });

  test("missing context value returns false (does not throw)", () => {
    expect(evaluateAppliesTo("shop == 'DTC'", {})).toBe(false);
  });

  test("null/empty expression always matches (unconditional)", () => {
    expect(evaluateAppliesTo(null, {})).toBe(true);
    expect(evaluateAppliesTo("", {})).toBe(true);
  });
});
```

- [ ] **Step 2:** Run tests; confirm they fail because the module doesn't exist.

Run: `npm test -- src/__tests__/adders/applies-to.test.ts`
Expected: `Cannot find module '@/lib/adders/applies-to'`.

- [ ] **Step 3:** Implement `src/lib/adders/applies-to.ts`.

```typescript
import type { AppliesToContext } from "./types";

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not in";
export type ParsedAppliesTo = {
  lhs: "shop" | "deal.dealType" | "deal.valueCents" | "now";
  op: Op;
  rhs: string | number | boolean | Date | string[];
};

const LHS_IDENTIFIERS = new Set(["shop", "deal.dealType", "deal.valueCents", "now"]);
const OPS: Op[] = ["<=", ">=", "!=", "==", "<", ">", "in", "not in"];

/** Phase 1 parser: single predicate, no combinators. */
export function parseAppliesTo(input: string): ParsedAppliesTo {
  if (!input || !input.trim()) throw new Error("empty appliesTo expression");

  // Reject boolean combinators explicitly.
  if (/&&|\|\|/.test(input)) {
    throw new Error("boolean combinators (&&, ||) are not supported in Phase 1");
  }
  if (/===|!==/.test(input)) {
    throw new Error("use ==/!= not ===/!==");
  }

  // Try ops in length-desc order so "<=" matches before "<".
  for (const op of OPS) {
    const idx = findOp(input, op);
    if (idx >= 0) {
      const lhsRaw = input.slice(0, idx).trim();
      const rhsRaw = input.slice(idx + op.length).trim();
      if (!LHS_IDENTIFIERS.has(lhsRaw)) {
        throw new Error(`LHS must be one of: ${[...LHS_IDENTIFIERS].join(", ")}`);
      }
      const rhs = parseRhs(rhsRaw, lhsRaw, op);
      return { lhs: lhsRaw as ParsedAppliesTo["lhs"], op, rhs };
    }
  }
  throw new Error(`no recognized operator in: ${input}`);
}

function findOp(input: string, op: Op): number {
  // Find op token not inside quotes or brackets.
  let inString = false;
  let bracket = 0;
  for (let i = 0; i <= input.length - op.length; i++) {
    const c = input[i];
    if (c === "'") inString = !inString;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    if (!inString && bracket === 0 && input.startsWith(op, i)) {
      // ensure it's whole-token for in / not in
      if (op === "in" || op === "not in") {
        const before = i > 0 ? input[i - 1] : " ";
        const after = input[i + op.length] ?? " ";
        if (/\w/.test(before) || /\w/.test(after)) continue;
      }
      return i;
    }
  }
  return -1;
}

function parseRhs(raw: string, lhs: string, op: Op): ParsedAppliesTo["rhs"] {
  if (op === "in" || op === "not in") {
    const m = raw.match(/^\[\s*(.*?)\s*\]$/);
    if (!m) throw new Error(`expected list literal for '${op}'`);
    return m[1].split(",").map((s) => stripQuotes(s.trim()));
  }
  // String literal
  if (raw.startsWith("'") && raw.endsWith("'")) {
    const s = raw.slice(1, -1);
    // If LHS is `now`, coerce to Date.
    if (lhs === "now") return new Date(s);
    return s;
  }
  // Boolean
  if (raw === "true" || raw === "false") return raw === "true";
  // Number
  const n = Number(raw);
  if (!Number.isNaN(n)) return n;
  throw new Error(`could not parse RHS: ${raw}`);
}

function stripQuotes(s: string): string {
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

/** Evaluate an `appliesTo` expression against context. Null/empty → true (unconditional). */
export function evaluateAppliesTo(
  expr: string | null | undefined,
  ctx: AppliesToContext
): boolean {
  if (!expr || !expr.trim()) return true;
  const parsed = parseAppliesTo(expr);
  const lhsValue = resolveLhs(parsed.lhs, ctx);
  if (lhsValue === undefined) return false;

  switch (parsed.op) {
    case "==":
      return lhsValue === parsed.rhs || sameDay(lhsValue, parsed.rhs);
    case "!=":
      return lhsValue !== parsed.rhs;
    case "<":
      return compare(lhsValue, parsed.rhs) < 0;
    case "<=":
      return compare(lhsValue, parsed.rhs) <= 0;
    case ">":
      return compare(lhsValue, parsed.rhs) > 0;
    case ">=":
      return compare(lhsValue, parsed.rhs) >= 0;
    case "in":
      return Array.isArray(parsed.rhs) && parsed.rhs.includes(String(lhsValue));
    case "not in":
      return Array.isArray(parsed.rhs) && !parsed.rhs.includes(String(lhsValue));
  }
}

function resolveLhs(lhs: string, ctx: AppliesToContext): unknown {
  if (lhs === "shop") return ctx.shop;
  if (lhs === "deal.dealType") return ctx.deal?.dealType;
  if (lhs === "deal.valueCents") return ctx.deal?.valueCents;
  if (lhs === "now") return ctx.now ?? new Date();
  return undefined;
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function sameDay(a: unknown, b: unknown): boolean {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}
```

- [ ] **Step 4:** Run tests; confirm all pass.

Run: `npm test -- src/__tests__/adders/applies-to.test.ts`
Expected: all tests pass.

- [ ] **Step 5:** Commit.

```bash
git add src/lib/adders/applies-to.ts src/__tests__/adders/applies-to.test.ts
git commit -m "feat(adders): appliesTo predicate parser and evaluator"
```

### Task 1.6: Zod validation schemas

**Files:**
- Create: `src/lib/adders/zod-schemas.ts`

- [ ] **Step 1:** Create `src/lib/adders/zod-schemas.ts`:

```typescript
import { z } from "zod";
import {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma";
import { parseAppliesTo } from "./applies-to";

export const TriggerLogicSchema = z.object({
  op: z.enum(["lt", "lte", "eq", "gte", "gt", "contains", "truthy"]),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  qtyFrom: z.enum(["answer", "constant"]).optional(),
  qtyConstant: z.number().optional(),
}).refine(
  (v) => v.op === "truthy" || v.value !== undefined,
  { message: "value is required except when op is 'truthy'" }
);

const AppliesToString = z
  .string()
  .optional()
  .nullable()
  .refine(
    (v) => {
      if (!v) return true;
      try {
        parseAppliesTo(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "invalid appliesTo syntax; see spec for supported grammar" }
  );

export const CreateAdderSchema = z.object({
  code: z.string().min(1).regex(/^[A-Z0-9_]+$/, "code must be UPPER_SNAKE"),
  name: z.string().min(1),
  category: z.nativeEnum(AdderCategory),
  type: z.nativeEnum(AdderType).default("FIXED"),
  direction: z.nativeEnum(AdderDirection).default("ADD"),
  autoApply: z.boolean().default(false),
  appliesTo: AppliesToString,
  triggerCondition: z.string().nullable().optional(),
  triageQuestion: z.string().nullable().optional(),
  triageAnswerType: z.nativeEnum(TriageAnswerType).nullable().optional(),
  triageChoices: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })).nullable().optional(),
  triggerLogic: TriggerLogicSchema.nullable().optional(),
  photosRequired: z.boolean().default(false),
  unit: z.nativeEnum(AdderUnit),
  basePrice: z.number().nonnegative(),
  baseCost: z.number().nonnegative(),
  marginTarget: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateAdderInput = z.infer<typeof CreateAdderSchema>;

export const UpdateAdderSchema = CreateAdderSchema.partial().extend({
  changeNote: z.string().optional(),
});

export type UpdateAdderInput = z.infer<typeof UpdateAdderSchema>;

export const ShopOverrideSchema = z.object({
  shop: z.string().min(1),
  priceDelta: z.number(),
  active: z.boolean().default(true),
});
```

- [ ] **Step 2:** Verify typecheck.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3:** Commit.

```bash
git add src/lib/adders/zod-schemas.ts
git commit -m "feat(adders): zod validation schemas for catalog CRUD"
```

### Task 1.7: Shop override resolver (TDD)

**Files:**
- Test: `src/__tests__/adders/pricing-shop-override.test.ts`
- Create: `src/lib/adders/pricing.ts`

- [ ] **Step 1:** Write failing tests.

Create `src/__tests__/adders/pricing-shop-override.test.ts`:

```typescript
import { VALID_SHOPS, resolveShopPrice, isValidShop } from "@/lib/adders/pricing";
import type { AdderWithOverrides } from "@/lib/adders/types";

describe("VALID_SHOPS", () => {
  test("matches CrewMember.location strings", () => {
    expect(VALID_SHOPS).toEqual(["Westminster", "DTC", "Colorado Springs", "SLO", "Camarillo"]);
  });
});

describe("isValidShop", () => {
  test("accepts known shops", () => {
    for (const s of VALID_SHOPS) expect(isValidShop(s)).toBe(true);
  });
  test("rejects unknowns", () => {
    expect(isValidShop("DTCC")).toBe(false);
    expect(isValidShop("")).toBe(false);
  });
});

describe("resolveShopPrice", () => {
  const baseAdder: AdderWithOverrides = {
    id: "a1",
    code: "MPU_200A",
    name: "MPU to 200A",
    // ... minimal fields filled for typechecking
    basePrice: 500 as unknown as never,
    overrides: [],
  } as unknown as AdderWithOverrides;

  test("returns basePrice when no override", () => {
    expect(resolveShopPrice(baseAdder, "DTC")).toBe(500);
  });

  test("applies matching active override", () => {
    const adder = { ...baseAdder, overrides: [
      { id: "o1", adderId: "a1", shop: "SLO", priceDelta: 150 as unknown as never, active: true, createdAt: new Date(), updatedAt: new Date() },
    ] } as AdderWithOverrides;
    expect(resolveShopPrice(adder, "SLO")).toBe(650);
    expect(resolveShopPrice(adder, "DTC")).toBe(500); // no match
  });

  test("ignores inactive overrides", () => {
    const adder = { ...baseAdder, overrides: [
      { id: "o1", adderId: "a1", shop: "SLO", priceDelta: 150 as unknown as never, active: false, createdAt: new Date(), updatedAt: new Date() },
    ] } as AdderWithOverrides;
    expect(resolveShopPrice(adder, "SLO")).toBe(500);
  });

  test("throws on invalid shop", () => {
    expect(() => resolveShopPrice(baseAdder, "Nowhere")).toThrow();
  });
});
```

- [ ] **Step 2:** Run tests; confirm failure.

Run: `npm test -- src/__tests__/adders/pricing-shop-override.test.ts`
Expected: module not found.

- [ ] **Step 3:** Implement `src/lib/adders/pricing.ts`.

```typescript
import type { AdderWithOverrides } from "./types";

/** Canonical shop list — matches existing `CrewMember.location` strings. */
export const VALID_SHOPS = [
  "Westminster",
  "DTC",
  "Colorado Springs",
  "SLO",
  "Camarillo",
] as const;

export type Shop = (typeof VALID_SHOPS)[number];

export function isValidShop(value: string): value is Shop {
  return (VALID_SHOPS as readonly string[]).includes(value);
}

/** Resolve final unit price for an adder at a given shop. basePrice + active override delta. */
export function resolveShopPrice(adder: AdderWithOverrides, shop: string): number {
  if (!isValidShop(shop)) throw new Error(`invalid shop: ${shop}`);
  const base = Number(adder.basePrice);
  const override = adder.overrides.find((o) => o.shop === shop && o.active);
  return base + (override ? Number(override.priceDelta) : 0);
}
```

- [ ] **Step 4:** Run tests; confirm pass.

Run: `npm test -- src/__tests__/adders/pricing-shop-override.test.ts`
Expected: all tests pass.

- [ ] **Step 5:** Commit.

```bash
git add src/lib/adders/pricing.ts src/__tests__/adders/pricing-shop-override.test.ts
git commit -m "feat(adders): VALID_SHOPS const + resolveShopPrice helper"
```

### Task 1.8: Catalog CRUD helpers (TDD)

**Files:**
- Test: `src/__tests__/adders/catalog.test.ts`
- Create: `src/lib/adders/catalog.ts`

- [ ] **Step 1:** Write failing tests using the real Prisma client against the test database (pattern: see `src/__tests__/on-call-rotation.test.ts` for reference on test-DB setup).

Create `src/__tests__/adders/catalog.test.ts`:

```typescript
import { prisma } from "@/lib/db";
import {
  createAdder,
  updateAdder,
  retireAdder,
  listAdders,
  getAdderById,
  listRevisions,
} from "@/lib/adders/catalog";
import type { CreateAdderInput } from "@/lib/adders/zod-schemas";

const SAMPLE: CreateAdderInput = {
  code: "TEST_MPU",
  name: "Test MPU",
  category: "ELECTRICAL",
  type: "FIXED",
  direction: "ADD",
  autoApply: false,
  photosRequired: false,
  unit: "FLAT",
  basePrice: 500,
  baseCost: 300,
};

async function cleanup(code: string) {
  await prisma.adder.deleteMany({ where: { code } });
}

describe("catalog CRUD", () => {
  afterEach(async () => {
    await cleanup("TEST_MPU");
    await cleanup("TEST_MPU2");
  });

  test("createAdder inserts row and writes initial revision", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    expect(a.code).toBe("TEST_MPU");
    expect(a.createdBy).toBe("user-1");
    const revs = await listRevisions(a.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].changeNote).toMatch(/created/i);
  });

  test("createAdder rejects duplicate code", async () => {
    await createAdder(SAMPLE, { userId: "user-1" });
    await expect(createAdder(SAMPLE, { userId: "user-2" })).rejects.toThrow(/unique/i);
  });

  test("updateAdder writes revision with snapshot of prior state", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const updated = await updateAdder(
      a.id,
      { basePrice: 600, changeNote: "price increase" },
      { userId: "user-2" }
    );
    expect(Number(updated.basePrice)).toBe(600);
    const revs = await listRevisions(a.id);
    expect(revs).toHaveLength(2);
    const snapshot = revs[1].snapshot as Record<string, unknown>;
    expect(snapshot.basePrice).toBe("500"); // prior value captured
  });

  test("retireAdder flips active to false and writes revision", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const retired = await retireAdder(a.id, { userId: "user-1", reason: "obsolete" });
    expect(retired.active).toBe(false);
    const revs = await listRevisions(a.id);
    expect(revs.some((r) => (r.changeNote ?? "").match(/retired/i))).toBe(true);
  });

  test("listAdders filters by category and active", async () => {
    await createAdder(SAMPLE, { userId: "user-1" });
    await createAdder({ ...SAMPLE, code: "TEST_MPU2", category: "ROOFING" }, { userId: "user-1" });
    const electrical = await listAdders({ category: "ELECTRICAL" });
    expect(electrical.map((x) => x.code)).toContain("TEST_MPU");
    expect(electrical.map((x) => x.code)).not.toContain("TEST_MPU2");
  });

  test("getAdderById returns adder with overrides eager-loaded", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const fetched = await getAdderById(a.id);
    expect(fetched?.overrides).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run tests; confirm failure (module not found).

Run: `npm test -- src/__tests__/adders/catalog.test.ts`
Expected: `Cannot find module '@/lib/adders/catalog'`.

- [ ] **Step 3:** Implement `src/lib/adders/catalog.ts`.

```typescript
import { prisma } from "@/lib/db";
import type { Adder, AdderWithOverrides, AdderRevision, AdderCategory } from "./types";
import {
  CreateAdderSchema,
  UpdateAdderSchema,
  type CreateAdderInput,
  type UpdateAdderInput,
} from "./zod-schemas";

type AuthCtx = { userId: string };

export async function createAdder(input: CreateAdderInput, auth: AuthCtx): Promise<Adder> {
  const data = CreateAdderSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const adder = await tx.adder.create({
      data: {
        ...data,
        basePrice: data.basePrice,
        baseCost: data.baseCost,
        marginTarget: data.marginTarget ?? undefined,
        createdBy: auth.userId,
        updatedBy: auth.userId,
        triggerLogic: data.triggerLogic ?? undefined,
        triageChoices: data.triageChoices ?? undefined,
      },
    });
    await tx.adderRevision.create({
      data: {
        adderId: adder.id,
        snapshot: adder as unknown as object,
        changedBy: auth.userId,
        changeNote: "created",
      },
    });
    return adder;
  });
}

export async function updateAdder(
  id: string,
  input: UpdateAdderInput,
  auth: AuthCtx
): Promise<Adder> {
  const parsed = UpdateAdderSchema.parse(input);
  const { changeNote, ...rest } = parsed;
  return prisma.$transaction(async (tx) => {
    const current = await tx.adder.findUniqueOrThrow({
      where: { id },
      include: { overrides: true },
    });
    await tx.adderRevision.create({
      data: {
        adderId: id,
        snapshot: current as unknown as object,
        changedBy: auth.userId,
        changeNote: changeNote ?? "updated",
      },
    });
    return tx.adder.update({
      where: { id },
      data: { ...rest, updatedBy: auth.userId },
    });
  });
}

export async function retireAdder(
  id: string,
  auth: AuthCtx & { reason?: string }
): Promise<Adder> {
  return updateAdder(
    id,
    { active: false, changeNote: auth.reason ?? "retired" },
    auth
  );
}

export async function listAdders(filters: {
  category?: AdderCategory;
  active?: boolean;
  shop?: string;
} = {}): Promise<AdderWithOverrides[]> {
  return prisma.adder.findMany({
    where: {
      category: filters.category,
      active: filters.active,
      ...(filters.shop
        ? { overrides: { some: { shop: filters.shop, active: true } } }
        : {}),
    },
    include: { overrides: true },
    orderBy: [{ category: "asc" }, { code: "asc" }],
  });
}

export async function getAdderById(id: string): Promise<AdderWithOverrides | null> {
  return prisma.adder.findUnique({
    where: { id },
    include: { overrides: true },
  });
}

export async function listRevisions(adderId: string): Promise<AdderRevision[]> {
  return prisma.adderRevision.findMany({
    where: { adderId },
    orderBy: { changedAt: "asc" },
  });
}
```

- [ ] **Step 4:** Run tests; confirm pass.

Run: `npm test -- src/__tests__/adders/catalog.test.ts`
Expected: all tests pass.

- [ ] **Step 5:** Commit.

```bash
git add src/lib/adders/catalog.ts src/__tests__/adders/catalog.test.ts
git commit -m "feat(adders): catalog CRUD helpers with revision audit trail"
```

### Task 1.9: Add `canManageAdders` permission and role routes

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `prisma/schema.prisma` (add boolean column)

- [ ] **Step 1:** Add `canManageAdders Boolean @default(false)` to the `User` model in `prisma/schema.prisma` alongside the other permission booleans (e.g., next to `canScheduleSurveys`).

Run: `rg 'canScheduleSurveys' prisma/schema.prisma -n`
Expected: one or two matches on the `User` model — add the new field right after.

- [ ] **Step 2:** Generate a follow-up migration.

Run: `npx prisma migrate dev --create-only --name adder_can_manage_permission`
Expected: new migration dir with `ALTER TABLE "User" ADD COLUMN "canManageAdders" BOOLEAN NOT NULL DEFAULT false`.

- [ ] **Step 3:** Apply locally.

Run: `npx prisma migrate dev`
Expected: migration applies; client regen succeeds.

- [ ] **Step 4:** Modify `src/lib/roles.ts`.

Locate the role-to-permission defaults table (search: `rg 'canScheduleSurveys' src/lib/roles.ts -n`). For each role, add a `canManageAdders` field:
- `ADMIN`: `true`
- `OWNER`: `true`
- all other roles: `false`

Then locate the per-role `allowedRoutes` arrays and add the new API paths:
- All roles (read-only catalog access): `"/api/adders"`, `"/api/adders/[id]"`, `"/api/adders/[id]/revisions"` — ADD to every role's `allowedRoutes` except VIEWER (which should also get them — confirm with CLAUDE.md convention).
- Catalog dashboard page: `"/dashboards/adders"` — add to same roles.
- Writer-only routes (enforced inside handler via `canManageAdders` check): `"/api/adders"` POST, `"/api/adders/[id]"` PATCH, `"/api/adders/[id]/retire"` — the path itself must be in `allowedRoutes`; the handler gates the verb.

Per feedback in memory [feedback_api_route_role_allowlist.md], missing this causes silent 403s.

- [ ] **Step 5:** Typecheck.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6:** Commit.

```bash
git add prisma/schema.prisma prisma/migrations src/lib/roles.ts
git commit -m "feat(adders): canManageAdders permission + role allowlist for catalog routes"
```

### Task 1.10: API route — `/api/adders` (list + create)

**Files:**
- Create: `src/app/api/adders/route.ts`

- [ ] **Step 1:** Create `src/app/api/adders/route.ts`.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdder, listAdders } from "@/lib/adders/catalog";
import { CreateAdderSchema } from "@/lib/adders/zod-schemas";
import { AdderCategory } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const categoryRaw = sp.get("category");
  const activeRaw = sp.get("active");
  const shop = sp.get("shop") ?? undefined;

  const category =
    categoryRaw && categoryRaw in AdderCategory
      ? (categoryRaw as AdderCategory)
      : undefined;
  const active = activeRaw == null ? undefined : activeRaw === "true";

  const adders = await listAdders({ category, active, shop });
  return NextResponse.json({ adders });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.user.canManageAdders) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateAdderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const adder = await createAdder(parsed.data, { userId: session.user.id });
    return NextResponse.json({ adder }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg.includes("Unique")) {
      return NextResponse.json({ error: "duplicate code" }, { status: 409 });
    }
    throw e;
  }
}
```

- [ ] **Step 2:** Test happy path manually (dev server).

Run: `npm run dev` and in a second terminal:
```bash
curl -s -X POST http://localhost:3000/api/adders -H 'Content-Type: application/json' \
  -H "Cookie: $(cat .test-session-cookie)" \
  -d '{"code":"SMOKE_1","name":"Smoke","category":"MISC","unit":"FLAT","basePrice":10,"baseCost":5}'
```
Expected: 201 with `{ adder: { id, code: "SMOKE_1", ... } }`.

If you don't have a test session cookie, skip manual smoke and rely on integration test in Task 1.13.

- [ ] **Step 3:** Typecheck.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4:** Commit.

```bash
git add src/app/api/adders/route.ts
git commit -m "feat(adders): GET /api/adders list + POST /api/adders create"
```

### Task 1.11: API routes — `/api/adders/[id]` (GET, PATCH) + retire + revisions

**Files:**
- Create: `src/app/api/adders/[id]/route.ts`
- Create: `src/app/api/adders/[id]/retire/route.ts`
- Create: `src/app/api/adders/[id]/revisions/route.ts`

- [ ] **Step 1:** `src/app/api/adders/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdderById, updateAdder } from "@/lib/adders/catalog";
import { UpdateAdderSchema } from "@/lib/adders/zod-schemas";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const adder = await getAdderById(id);
  if (!adder) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ adder });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.user.canManageAdders) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateAdderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const adder = await updateAdder(id, parsed.data, { userId: session.user.id });
  return NextResponse.json({ adder });
}
```

- [ ] **Step 2:** `src/app/api/adders/[id]/retire/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retireAdder } from "@/lib/adders/catalog";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.user.canManageAdders) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  const adder = await retireAdder(id, { userId: session.user.id, reason });
  return NextResponse.json({ adder });
}
```

- [ ] **Step 3:** `src/app/api/adders/[id]/revisions/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listRevisions } from "@/lib/adders/catalog";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const revisions = await listRevisions(id);
  return NextResponse.json({ revisions });
}
```

- [ ] **Step 4:** Typecheck.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5:** Commit.

```bash
git add src/app/api/adders/
git commit -m "feat(adders): GET/PATCH /api/adders/[id] + retire + revisions routes"
```

### Task 1.12: Seed script

**Files:**
- Create: `scripts/seed-adders.ts`
- Create: `scripts/data/adders-seed.example.csv` (placeholder until Phase 0 CSV exists)

- [ ] **Step 1:** Create example CSV with three representative rows.

`scripts/data/adders-seed.example.csv`:

```csv
code,name,category,type,direction,autoApply,appliesTo,triggerCondition,triageQuestion,triageAnswerType,triggerLogic,photosRequired,unit,basePrice,baseCost,marginTarget,notes,override_Westminster,override_DTC,override_Colorado Springs,override_SLO,override_Camarillo
MPU_200A,Main Panel Upgrade to 200A,ELECTRICAL,FIXED,ADD,false,,main panel < 200A,What is the main panel amp rating?,NUMERIC,"{""op"":""lt"",""value"":200,""qtyFrom"":""constant"",""qtyConstant"":1}",true,FLAT,2500,1800,0.28,Includes permit + inspection,,,,,
ROOF_STEEP_8_12,Steep Roof (8/12+),ROOFING,FIXED,ADD,false,,roof pitch >= 8/12,What is the steepest roof pitch?,NUMERIC,"{""op"":""gte"",""value"":8,""qtyFrom"":""constant"",""qtyConstant"":1}",true,PER_KW,50,30,0.4,Measured in rise over 12 run,,,,,
PE_DISCOUNT_30,PE Customer Discount,ORG,PERCENTAGE,DISCOUNT,true,deal.dealType == 'PE',,,,false,FLAT,30,0,,Flat 30% discount on PE deals,,,,,
```

- [ ] **Step 2:** Create `scripts/seed-adders.ts`.

```typescript
#!/usr/bin/env ts-node
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/db";
import { CreateAdderSchema } from "@/lib/adders/zod-schemas";
import { VALID_SHOPS } from "@/lib/adders/pricing";

const CSV_PATH = process.argv[2] ?? "scripts/data/adders-seed.csv";
const SYSTEM_USER = "system-seed";

async function main() {
  const absPath = path.resolve(process.cwd(), CSV_PATH);
  if (!fs.existsSync(absPath)) {
    console.error(`CSV not found: ${absPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(absPath, "utf8");
  const rows: Record<string, string>[] = parse(raw, { columns: true, skip_empty_lines: true });

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const payload = toCreatePayload(row);
    const parsed = CreateAdderSchema.safeParse(payload);
    if (!parsed.success) {
      console.error(`Skip row ${row.code}: ${JSON.stringify(parsed.error.issues)}`);
      continue;
    }
    const existing = await prisma.adder.findUnique({ where: { code: row.code } });
    const data = {
      ...parsed.data,
      basePrice: parsed.data.basePrice,
      baseCost: parsed.data.baseCost,
      triggerLogic: parsed.data.triggerLogic ?? undefined,
      triageChoices: parsed.data.triageChoices ?? undefined,
      marginTarget: parsed.data.marginTarget ?? undefined,
    };
    if (existing) {
      await prisma.adder.update({
        where: { id: existing.id },
        data: { ...data, updatedBy: SYSTEM_USER },
      });
      updated++;
    } else {
      const adder = await prisma.adder.create({
        data: { ...data, createdBy: SYSTEM_USER, updatedBy: SYSTEM_USER },
      });
      await prisma.adderRevision.create({
        data: {
          adderId: adder.id,
          snapshot: adder as unknown as object,
          changedBy: SYSTEM_USER,
          changeNote: "seeded",
        },
      });
      created++;
    }

    // Shop overrides
    for (const shop of VALID_SHOPS) {
      const col = `override_${shop}`;
      const v = row[col]?.trim();
      if (!v) continue;
      const priceDelta = Number(v);
      if (Number.isNaN(priceDelta)) continue;
      const adder = await prisma.adder.findUniqueOrThrow({ where: { code: row.code } });
      await prisma.adderShopOverride.upsert({
        where: { adderId_shop: { adderId: adder.id, shop } },
        create: { adderId: adder.id, shop, priceDelta, active: true },
        update: { priceDelta, active: true },
      });
    }
  }
  console.log(`seed complete: ${created} created, ${updated} updated`);
  await prisma.$disconnect();
}

function toCreatePayload(row: Record<string, string>) {
  const num = (s: string | undefined) => (s ? Number(s) : undefined);
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    type: row.type || "FIXED",
    direction: row.direction || "ADD",
    autoApply: row.autoApply === "true",
    appliesTo: row.appliesTo || undefined,
    triggerCondition: row.triggerCondition || undefined,
    triageQuestion: row.triageQuestion || undefined,
    triageAnswerType: row.triageAnswerType || undefined,
    triggerLogic: row.triggerLogic ? JSON.parse(row.triggerLogic) : undefined,
    photosRequired: row.photosRequired === "true",
    unit: row.unit,
    basePrice: Number(row.basePrice),
    baseCost: Number(row.baseCost),
    marginTarget: num(row.marginTarget),
    notes: row.notes || undefined,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3:** Add `csv-parse` dep if not present.

Run: `node -e "console.log(require('./package.json').dependencies['csv-parse'] || require('./package.json').devDependencies['csv-parse'])"`
If "undefined": `npm install --save-dev csv-parse`.

- [ ] **Step 4:** Smoke-run the seed against the local dev DB with the example CSV.

Run: `npx tsx scripts/seed-adders.ts scripts/data/adders-seed.example.csv`
Expected: `seed complete: 3 created, 0 updated`.

Verify with: `npx prisma studio` (optional) or `psql $DATABASE_URL -c "SELECT code,name,category FROM \"Adder\" ORDER BY code;"`.

- [ ] **Step 5:** Commit.

```bash
git add scripts/seed-adders.ts scripts/data/adders-seed.example.csv package.json package-lock.json
git commit -m "feat(adders): seed script for Phase 0 CSV import"
```

### Task 1.13: Seed integrity test

**Files:**
- Test: `src/__tests__/adders/seed-integrity.test.ts`

This test enforces the "IDR adder booleans must all have matching catalog codes" rule from the spec's risk table. It will initially fail (seed catalog lacks mapping entries) — the fix is to add those rows to the Phase 0 CSV, not to disable the test.

- [ ] **Step 1:** Create test.

```typescript
import { prisma } from "@/lib/db";

const IDR_ADDER_COLUMNS_TO_CODES: Record<string, string> = {
  adderTileRoof: "ROOF_TILE",
  adderTrenching: "TRENCH_LF",
  adderGroundMount: "GROUND_MOUNT",
  adderMpuUpgrade: "MPU_200A",
  adderEvCharger: "EV_CHARGER_L2",
  adderSteepPitch: "ROOF_STEEP_8_12",
  adderTwoStorey: "STOREY_2",
};

describe("seed integrity", () => {
  test.each(Object.entries(IDR_ADDER_COLUMNS_TO_CODES))(
    "%s has matching catalog code %s",
    async (_column, code) => {
      const adder = await prisma.adder.findUnique({ where: { code } });
      expect(adder).not.toBeNull();
      expect(adder?.active).toBe(true);
    }
  );
});
```

- [ ] **Step 2:** Run test against a freshly seeded DB. Expect SOME to fail if the example CSV only includes a subset. That is intentional — the Phase 0 canonical CSV must include all 7 codes before Chunk 5 ships. File a reminder comment in the test header if any fail on the example CSV.

Run: `npm test -- src/__tests__/adders/seed-integrity.test.ts`
Expected: passes for codes present in the example CSV; fails for missing codes until Phase 0 CSV is loaded.

- [ ] **Step 3:** Commit.

```bash
git add src/__tests__/adders/seed-integrity.test.ts
git commit -m "test(adders): seed integrity — IDR booleans must have catalog codes"
```

### Task 1.14: Run full Chunk 1 verification

- [ ] **Step 1:** Run lint + type + tests end-to-end.

Run: `npm run lint && npx tsc --noEmit && npm test -- src/__tests__/adders/`
Expected: all pass (seed integrity test may fail for missing IDR codes — acceptable until Phase 0 CSV is complete).

- [ ] **Step 2:** Confirm migration files committed and unapplied to production.

Run: `ls prisma/migrations/*adder*`
Expected: two directories (adder_catalog, adder_can_manage_permission). Per CLAUDE.md, prod apply is a manual step outside this plan.

- [ ] **Step 3:** Final chunk commit (if anything trailing).

```bash
git status
# If clean: no commit needed. Otherwise add and commit outstanding changes.
```

**Chunk 1 exit criteria:**
- Prisma schema has 5 new models + 6 new enums + `canManageAdders` boolean on User
- Two migration files generated, not yet deployed to prod
- `src/lib/adders/{types,zod-schemas,applies-to,pricing,catalog}.ts` exist with tests
- Four API routes live under `/api/adders/`
- `scripts/seed-adders.ts` can import the canonical CSV
- All tests pass locally against the dev DB
- All new routes added to `src/lib/roles.ts` allowlist

---

*Chunks 2–6 follow below. Each chunk is self-contained and independently testable.*
