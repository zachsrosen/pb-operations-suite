# AI Assistant Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hybrid AI assistant layer — deterministic check engine for automated reviews and pipeline gates, Claude chat for conversational questions — integrated into the PB Tech Ops Suite dashboard.

**Architecture:** Three pillars sharing one data layer. (1) Check engine: pure TypeScript functions per skill that evaluate HubSpot deal data and return structured findings, exposed via `/api/reviews/*` routes. (2) Claude chat: `/api/chat` route using Anthropic SDK with tool-use for project Q&A, streamed to a slide-out widget. (3) Pipeline webhooks: HubSpot stage-change webhooks trigger the check engine, create tasks + Gmail notifications on failure. New Prisma models `ProjectReview` and `ChatMessage` persist results.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Prisma 7.3 on Neon Postgres, Anthropic SDK (`@anthropic-ai/sdk`), next-auth v5, existing HubSpot/Gmail clients, Tailwind v4 with CSS variable tokens.

**Design doc:** `docs/plans/2026-03-01-ai-assistant-layer-design.md`

---

## Task 1: Prisma Schema — ProjectReview + ChatMessage Models

**Files:**
- Modify: `prisma/schema.prisma` (append after line 1141)
- Create: migration via `prisma migrate dev`

**Step 1: Add ProjectReview and ChatMessage models to schema**

Append to the end of `prisma/schema.prisma`:

```prisma
// ============================================================
// AI Assistant Layer
// ============================================================

model ProjectReview {
  id           String   @id @default(cuid())
  dealId       String
  projectId    String?
  skill        String               // "design-review" | "engineering-review" | "sales-advisor"
  trigger      String               // "manual" | "webhook" | "scheduled"
  triggeredBy  String?              // user email or "system"
  findings     Json                 // Finding[] array
  errorCount   Int      @default(0)
  warningCount Int      @default(0)
  passed       Boolean  @default(false)
  durationMs   Int?
  createdAt    DateTime @default(now())

  @@index([dealId, skill])
  @@index([createdAt])
  @@index([skill, passed])
}

model ChatMessage {
  id        String   @id @default(cuid())
  userId    String
  dealId    String?
  role      String               // "user" | "assistant"
  content   String
  model     String?              // "haiku" | "sonnet"
  createdAt DateTime @default(now())

  @@index([userId, dealId])
  @@index([createdAt])
}
```

**Step 2: Run migration**

Run: `npx prisma migrate dev --name ai_assistant_layer`
Expected: Migration created, schema synced.

**Step 3: Verify generated client**

Run: `npx prisma generate`
Expected: Client generated at `src/generated/prisma`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add ProjectReview and ChatMessage models for AI assistant layer"
```

---

## Task 2: Check Engine Types + Registry

**Files:**
- Create: `src/lib/checks/types.ts`
- Create: `src/lib/checks/index.ts`
- Test: `src/__tests__/lib/checks/registry.test.ts`

**Step 1: Write the types file**

Create `src/lib/checks/types.ts`:

```ts
/**
 * Check Engine Types
 *
 * A check is a pure function: takes deal context in, returns a finding or null.
 * The registry maps skill names to arrays of check functions.
 */

export interface ReviewContext {
  dealId: string;
  properties: Record<string, string | null>;
  associations?: {
    contacts?: Array<{ email?: string; firstname?: string; lastname?: string }>;
    lineItems?: Array<{ name?: string; quantity?: number; price?: number; hs_sku?: string }>;
    files?: string[];
  };
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  check: string;       // machine-readable ID: "site-survey-uploaded"
  severity: Severity;
  message: string;     // human-readable: "Site survey PDF missing from deal attachments"
  field?: string;      // HubSpot property name if relevant
}

export type CheckFn = (context: ReviewContext) => Promise<Finding | null>;

export interface ReviewResult {
  skill: string;
  dealId: string;
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  passed: boolean;
  durationMs: number;
}

export type SkillName = "design-review" | "engineering-review" | "sales-advisor";

export const VALID_SKILLS: SkillName[] = ["design-review", "engineering-review", "sales-advisor"];

/**
 * Roles allowed to run each skill. Checked at the API route level.
 */
export const SKILL_ALLOWED_ROLES: Record<SkillName, string[]> = {
  "design-review": ["ADMIN", "OWNER", "MANAGER", "DESIGNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"],
  "engineering-review": ["ADMIN", "OWNER", "MANAGER", "TECH_OPS", "OPERATIONS_MANAGER", "PROJECT_MANAGER"],
  "sales-advisor": ["ADMIN", "OWNER", "MANAGER", "SALES"],
};
```

**Step 2: Write the registry file**

Create `src/lib/checks/index.ts`:

```ts
/**
 * Check Engine Registry
 *
 * Maps skill names to arrays of check functions.
 * Import individual skill modules and register them here.
 */

import type { CheckFn, SkillName } from "./types";

// Will be populated in Tasks 3-5 as each skill module is built
const registry = new Map<SkillName, CheckFn[]>();

export function registerChecks(skill: SkillName, checks: CheckFn[]): void {
  registry.set(skill, checks);
}

export function getChecks(skill: SkillName): CheckFn[] {
  return registry.get(skill) ?? [];
}

export function getRegisteredSkills(): SkillName[] {
  return Array.from(registry.keys());
}
```

**Step 3: Write a test for the registry**

Create `src/__tests__/lib/checks/registry.test.ts`:

```ts
import { registerChecks, getChecks, getRegisteredSkills } from "@/lib/checks";
import type { CheckFn, ReviewContext } from "@/lib/checks/types";

describe("Check Engine Registry", () => {
  it("returns empty array for unregistered skill", () => {
    expect(getChecks("sales-advisor")).toEqual([]);
  });

  it("registers and retrieves checks", () => {
    const mockCheck: CheckFn = async (_ctx: ReviewContext) => null;
    registerChecks("design-review", [mockCheck]);
    expect(getChecks("design-review")).toHaveLength(1);
    expect(getRegisteredSkills()).toContain("design-review");
  });
});
```

**Step 4: Run test to verify it passes**

Run: `npx jest --roots='<rootDir>/src' src/__tests__/lib/checks/registry.test.ts -v`
Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add src/lib/checks/ src/__tests__/lib/checks/
git commit -m "feat: add check engine types and registry"
```

---

## Task 3: Check Engine Runner + API Route

**Files:**
- Create: `src/lib/checks/runner.ts`
- Create: `src/app/api/reviews/run/route.ts`
- Test: `src/__tests__/lib/checks/runner.test.ts`

**Step 1: Write the runner**

Create `src/lib/checks/runner.ts`:

```ts
/**
 * Check Engine Runner
 *
 * Executes all checks for a given skill against deal data.
 * Returns structured ReviewResult. Pure function — no side effects.
 */

import { getChecks } from "./index";
import type { ReviewContext, ReviewResult, Finding, SkillName } from "./types";

export async function runChecks(
  skill: SkillName,
  context: ReviewContext
): Promise<ReviewResult> {
  const start = Date.now();
  const checks = getChecks(skill);
  const findings: Finding[] = [];

  for (const check of checks) {
    try {
      const finding = await check(context);
      if (finding) findings.push(finding);
    } catch (err) {
      // A check throwing is itself a finding
      findings.push({
        check: "internal-error",
        severity: "warning",
        message: `Check failed internally: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  return {
    skill,
    dealId: context.dealId,
    findings,
    errorCount,
    warningCount,
    passed: errorCount === 0,
    durationMs: Date.now() - start,
  };
}
```

**Step 2: Write test for the runner**

Create `src/__tests__/lib/checks/runner.test.ts`:

```ts
import { runChecks } from "@/lib/checks/runner";
import { registerChecks } from "@/lib/checks";
import type { ReviewContext, CheckFn } from "@/lib/checks/types";

const mockContext: ReviewContext = {
  dealId: "123",
  properties: { dealname: "PROJ-9999 Test", dealstage: "Design" },
};

describe("runChecks", () => {
  it("returns passed=true when no checks registered", async () => {
    const result = await runChecks("sales-advisor", mockContext);
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("collects findings from checks", async () => {
    const errorCheck: CheckFn = async () => ({
      check: "test-error",
      severity: "error",
      message: "Something is wrong",
    });
    const passingCheck: CheckFn = async () => null;

    registerChecks("engineering-review", [errorCheck, passingCheck]);
    const result = await runChecks("engineering-review", mockContext);
    expect(result.passed).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  it("catches throwing checks gracefully", async () => {
    const throwingCheck: CheckFn = async () => { throw new Error("boom"); };
    registerChecks("design-review", [throwingCheck]);
    const result = await runChecks("design-review", mockContext);
    expect(result.passed).toBe(true); // warning, not error
    expect(result.warningCount).toBe(1);
    expect(result.findings[0].check).toBe("internal-error");
  });
});
```

**Step 3: Run tests**

Run: `npx jest --roots='<rootDir>/src' src/__tests__/lib/checks/runner.test.ts -v`
Expected: 3 tests pass.

**Step 4: Write the API route**

Create `src/app/api/reviews/run/route.ts`:

```ts
/**
 * POST /api/reviews/run
 *
 * Run all checks for a skill against a HubSpot deal.
 * Saves result to ProjectReview table. Creates HubSpot task if errors found.
 *
 * Body: { dealId: string, skill: SkillName, trigger?: "manual" | "webhook" }
 * Auth: requireApiAuth() + role check per skill
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { runChecks } from "@/lib/checks/runner";
import { VALID_SKILLS, SKILL_ALLOWED_ROLES } from "@/lib/checks/types";
import type { SkillName } from "@/lib/checks/types";
// Ensure all check modules are loaded so they register with the engine
import "@/lib/checks/design-review";
import "@/lib/checks/engineering-review";
import "@/lib/checks/sales-advisor";

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, role } = authResult;

  let body: { dealId?: string; skill?: string; trigger?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, skill, trigger = "manual" } = body;

  if (!dealId || typeof dealId !== "string") {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }
  if (!skill || !VALID_SKILLS.includes(skill as SkillName)) {
    return NextResponse.json(
      { error: `skill must be one of: ${VALID_SKILLS.join(", ")}` },
      { status: 400 }
    );
  }

  const skillName = skill as SkillName;

  // Role check
  const allowedRoles = SKILL_ALLOWED_ROLES[skillName];
  if (!allowedRoles.includes(role)) {
    return NextResponse.json({ error: "Insufficient permissions for this skill" }, { status: 403 });
  }

  // Fetch deal properties from HubSpot
  let properties: Record<string, string | null>;
  try {
    const { getHubSpotClient } = await import("@/lib/hubspot");
    const client = getHubSpotClient();
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      "dealname", "dealstage", "pipeline", "amount", "pb_location",
      "design_status", "permitting_status", "site_survey_status",
      "install_date", "inspection_date", "pto_date",
      "hubspot_owner_id", "closedate",
    ]);
    properties = deal.properties;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch deal: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }

  // Extract PROJ-XXXX from dealname
  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  // Run checks
  const result = await runChecks(skillName, { dealId, properties });

  // Persist to DB
  const review = await prisma.projectReview.create({
    data: {
      dealId,
      projectId,
      skill: skillName,
      trigger,
      triggeredBy: trigger === "webhook" ? "system" : email,
      findings: result.findings,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      passed: result.passed,
      durationMs: result.durationMs,
    },
  });

  // TODO (Task 8): If !result.passed, create HubSpot task + send Gmail notification

  return NextResponse.json({
    id: review.id,
    ...result,
  });
}
```

**Step 5: Commit**

```bash
git add src/lib/checks/runner.ts src/app/api/reviews/run/ src/__tests__/lib/checks/runner.test.ts
git commit -m "feat: add check engine runner and POST /api/reviews/run route"
```

---

## Task 4: Design Review Checks

**Files:**
- Create: `src/lib/checks/design-review.ts`
- Test: `src/__tests__/lib/checks/design-review.test.ts`

**Step 1: Write the design review checks**

Create `src/lib/checks/design-review.ts`. These checks are derived from the design-reviewer SKILL.md checklist. Start with property-based checks (no file/association fetching needed):

```ts
/**
 * Design Review Checks
 *
 * Deterministic checks for design completeness. Validates HubSpot deal
 * properties that should be set before a project leaves design stage.
 */

import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const designNameSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const name = ctx.properties.dealname;
  if (!name || !name.match(/PROJ-\d+/)) {
    return { check: "project-id-format", severity: "error", message: "Deal name missing PROJ-XXXX identifier", field: "dealname" };
  }
  return null;
};

const designStatusSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.design_status;
  if (!status || status === "" || status === "Not Started") {
    return { check: "design-status-set", severity: "error", message: "Design status not set or still 'Not Started'", field: "design_status" };
  }
  return null;
};

const locationSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const location = ctx.properties.pb_location;
  if (!location || location === "") {
    return { check: "location-set", severity: "warning", message: "PB location not set on deal", field: "pb_location" };
  }
  return null;
};

const amountSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const amount = ctx.properties.amount;
  if (!amount || parseFloat(amount) <= 0) {
    return { check: "amount-set", severity: "warning", message: "Deal amount is zero or not set", field: "amount" };
  }
  return null;
};

const siteSurveyComplete: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.site_survey_status;
  if (!status || !["Complete", "Completed", "Done"].includes(status)) {
    return { check: "site-survey-complete", severity: "error", message: `Site survey not marked complete (current: ${status || "not set"})`, field: "site_survey_status" };
  }
  return null;
};

const installDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const date = ctx.properties.install_date;
  if (!date) {
    return { check: "install-date-set", severity: "info", message: "Install date not yet scheduled", field: "install_date" };
  }
  return null;
};

// Register all checks
registerChecks("design-review", [
  designNameSet,
  designStatusSet,
  locationSet,
  amountSet,
  siteSurveyComplete,
  installDateSet,
]);
```

**Step 2: Write tests**

Create `src/__tests__/lib/checks/design-review.test.ts`:

```ts
import "@/lib/checks/design-review"; // registers checks as side effect
import { runChecks } from "@/lib/checks/runner";
import type { ReviewContext } from "@/lib/checks/types";

function makeContext(overrides: Record<string, string | null> = {}): ReviewContext {
  return {
    dealId: "123",
    properties: {
      dealname: "PROJ-9015 Turner Solar",
      design_status: "Design Complete",
      pb_location: "Westminster",
      amount: "45000",
      site_survey_status: "Complete",
      install_date: "2026-04-15",
      ...overrides,
    },
  };
}

describe("Design Review Checks", () => {
  it("passes when all properties are set correctly", async () => {
    const result = await runChecks("design-review", makeContext());
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("flags missing PROJ-XXXX in dealname", async () => {
    const result = await runChecks("design-review", makeContext({ dealname: "Turner Solar" }));
    expect(result.findings.find((f) => f.check === "project-id-format")).toBeTruthy();
    expect(result.passed).toBe(false);
  });

  it("flags design_status not started", async () => {
    const result = await runChecks("design-review", makeContext({ design_status: "Not Started" }));
    expect(result.findings.find((f) => f.check === "design-status-set")).toBeTruthy();
  });

  it("flags missing site survey as error", async () => {
    const result = await runChecks("design-review", makeContext({ site_survey_status: null }));
    const finding = result.findings.find((f) => f.check === "site-survey-complete");
    expect(finding?.severity).toBe("error");
  });

  it("flags missing amount as warning not error", async () => {
    const result = await runChecks("design-review", makeContext({ amount: "0" }));
    const finding = result.findings.find((f) => f.check === "amount-set");
    expect(finding?.severity).toBe("warning");
    expect(result.passed).toBe(true); // warnings don't fail
  });

  it("flags missing install date as info", async () => {
    const result = await runChecks("design-review", makeContext({ install_date: null }));
    const finding = result.findings.find((f) => f.check === "install-date-set");
    expect(finding?.severity).toBe("info");
  });
});
```

**Step 3: Run tests**

Run: `npx jest --roots='<rootDir>/src' src/__tests__/lib/checks/design-review.test.ts -v`
Expected: 6 tests pass.

**Step 4: Commit**

```bash
git add src/lib/checks/design-review.ts src/__tests__/lib/checks/design-review.test.ts
git commit -m "feat: add design review checks (6 checks)"
```

---

## Task 5: Engineering Review + Sales Advisor Checks (Stubs)

**Files:**
- Create: `src/lib/checks/engineering-review.ts`
- Create: `src/lib/checks/sales-advisor.ts`
- Test: `src/__tests__/lib/checks/engineering-review.test.ts`
- Test: `src/__tests__/lib/checks/sales-advisor.test.ts`

These are initially stub modules with 2-3 checks each. They register with the engine so the full pipeline works end-to-end. More checks will be added iteratively as the team identifies what to validate.

**Step 1: Write engineering-review.ts**

Create `src/lib/checks/engineering-review.ts`:

```ts
import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const permittingStatusSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const status = ctx.properties.permitting_status;
  if (!status || status === "" || status === "Not Started") {
    return { check: "permitting-status-set", severity: "warning", message: "Permitting status not set", field: "permitting_status" };
  }
  return null;
};

const inspectionDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const date = ctx.properties.inspection_date;
  if (!date) {
    return { check: "inspection-date-set", severity: "info", message: "Inspection date not yet scheduled", field: "inspection_date" };
  }
  return null;
};

registerChecks("engineering-review", [permittingStatusSet, inspectionDateSet]);
```

**Step 2: Write sales-advisor.ts**

Create `src/lib/checks/sales-advisor.ts`:

```ts
import { registerChecks } from "./index";
import type { CheckFn, ReviewContext, Finding } from "./types";

const dealAmountReasonable: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  const amount = parseFloat(ctx.properties.amount ?? "0");
  if (amount > 0 && amount < 5000) {
    return { check: "deal-amount-low", severity: "warning", message: `Deal amount $${amount.toLocaleString()} seems unusually low for a solar install`, field: "amount" };
  }
  if (amount > 200000) {
    return { check: "deal-amount-high", severity: "info", message: `Deal amount $${amount.toLocaleString()} is above $200k — verify this is correct`, field: "amount" };
  }
  return null;
};

const closeDateSet: CheckFn = async (ctx: ReviewContext): Promise<Finding | null> => {
  if (!ctx.properties.closedate) {
    return { check: "close-date-set", severity: "warning", message: "Close date not set on deal", field: "closedate" };
  }
  return null;
};

registerChecks("sales-advisor", [dealAmountReasonable, closeDateSet]);
```

**Step 3: Write tests for both**

Create `src/__tests__/lib/checks/engineering-review.test.ts`:

```ts
import "@/lib/checks/engineering-review";
import { runChecks } from "@/lib/checks/runner";

describe("Engineering Review Checks", () => {
  it("passes with all properties set", async () => {
    const result = await runChecks("engineering-review", {
      dealId: "123",
      properties: { permitting_status: "Submitted", inspection_date: "2026-05-01" },
    });
    expect(result.passed).toBe(true);
  });

  it("flags missing permitting status", async () => {
    const result = await runChecks("engineering-review", {
      dealId: "123",
      properties: { permitting_status: null, inspection_date: "2026-05-01" },
    });
    expect(result.findings.find((f) => f.check === "permitting-status-set")).toBeTruthy();
  });
});
```

Create `src/__tests__/lib/checks/sales-advisor.test.ts`:

```ts
import "@/lib/checks/sales-advisor";
import { runChecks } from "@/lib/checks/runner";

describe("Sales Advisor Checks", () => {
  it("flags unusually low amount", async () => {
    const result = await runChecks("sales-advisor", {
      dealId: "123",
      properties: { amount: "3000", closedate: "2026-06-01" },
    });
    expect(result.findings.find((f) => f.check === "deal-amount-low")).toBeTruthy();
  });

  it("passes with normal amount and close date", async () => {
    const result = await runChecks("sales-advisor", {
      dealId: "123",
      properties: { amount: "45000", closedate: "2026-06-01" },
    });
    expect(result.passed).toBe(true);
    expect(result.errorCount).toBe(0);
  });
});
```

**Step 4: Run all check tests**

Run: `npx jest --roots='<rootDir>/src' src/__tests__/lib/checks/ -v`
Expected: All tests pass across 4 test files.

**Step 5: Commit**

```bash
git add src/lib/checks/engineering-review.ts src/lib/checks/sales-advisor.ts src/__tests__/lib/checks/
git commit -m "feat: add engineering review and sales advisor checks (stubs)"
```

---

## Task 6: Review Results API Routes (GET)

**Files:**
- Create: `src/app/api/reviews/[dealId]/route.ts`
- Create: `src/app/api/reviews/[dealId]/latest/route.ts`

**Step 1: Write GET /api/reviews/[dealId]**

Create `src/app/api/reviews/[dealId]/route.ts`:

```ts
/**
 * GET /api/reviews/:dealId
 *
 * Fetch all review results for a deal. Optional ?skill= filter.
 * Auth: any authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const skill = request.nextUrl.searchParams.get("skill");

  const reviews = await prisma.projectReview.findMany({
    where: {
      dealId,
      ...(skill ? { skill } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ reviews });
}
```

**Step 2: Write GET /api/reviews/[dealId]/latest**

Create `src/app/api/reviews/[dealId]/latest/route.ts`:

```ts
/**
 * GET /api/reviews/:dealId/latest
 *
 * Fetch the most recent review for each skill on a deal.
 * Returns at most 3 records (one per skill).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { VALID_SKILLS } from "@/lib/checks/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;

  const latest = await Promise.all(
    VALID_SKILLS.map((skill) =>
      prisma.projectReview.findFirst({
        where: { dealId, skill },
        orderBy: { createdAt: "desc" },
      })
    )
  );

  return NextResponse.json({
    reviews: latest.filter(Boolean),
  });
}
```

**Step 3: Commit**

```bash
git add src/app/api/reviews/
git commit -m "feat: add GET /api/reviews/[dealId] and /latest routes"
```

---

## Task 7: Migrate AI Foundation from OpenAI to Anthropic

**Files:**
- Modify: `src/lib/ai.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)
- Create: `src/lib/anthropic.ts` (new Claude client)

**Step 1: Install Anthropic SDK**

Run: `npm install @anthropic-ai/sdk`

**Step 2: Create Anthropic client module**

Create `src/lib/anthropic.ts`:

```ts
/**
 * Anthropic Claude Client
 *
 * Lazy-initialized Anthropic SDK client for the Claude chat widget
 * and future migration of anomaly/NL-query routes.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const CLAUDE_MODELS = {
  haiku: "claude-sonnet-4-20250514",   // fast, cheap — simple lookups
  sonnet: "claude-sonnet-4-20250514",  // reasoning — complex analysis
} as const;
```

**Step 3: Update ai.ts to add Claude as an option (keep OpenAI for existing routes)**

Add to the bottom of `src/lib/ai.ts`:

```ts
// ============================================================
// Claude (Anthropic) — for new AI assistant layer routes
// ============================================================

export { getAnthropicClient, CLAUDE_MODELS } from "./anthropic";
```

Note: The existing anomaly and NL-query routes continue using OpenAI for now. They can be migrated to Claude in a follow-up PR to avoid changing two things at once.

**Step 4: Add ANTHROPIC_API_KEY to .env.example**

Append to `.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Step 5: Commit**

```bash
git add src/lib/anthropic.ts src/lib/ai.ts package.json package-lock.json .env.example
git commit -m "feat: add Anthropic SDK client for Claude chat"
```

---

## Task 8: Chat API Route

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/lib/chat-tools.ts`

**Step 1: Write chat tools definitions**

Create `src/lib/chat-tools.ts`:

```ts
/**
 * Chat Tool Definitions
 *
 * Tools that Claude can call during chat conversations.
 * Each tool is a thin wrapper around existing data layer functions.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_deal",
    description: "Get HubSpot deal properties for a specific deal by ID",
    input_schema: {
      type: "object" as const,
      properties: {
        dealId: { type: "string", description: "HubSpot deal ID" },
      },
      required: ["dealId"],
    },
  },
  {
    name: "get_review_results",
    description: "Get the latest review results for a deal, optionally filtered by skill",
    input_schema: {
      type: "object" as const,
      properties: {
        dealId: { type: "string", description: "HubSpot deal ID" },
        skill: { type: "string", description: "Optional: design-review, engineering-review, or sales-advisor" },
      },
      required: ["dealId"],
    },
  },
  {
    name: "search_deals",
    description: "Search HubSpot deals by text query (searches deal name, stage, location)",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search text" },
      },
      required: ["query"],
    },
  },
];

/**
 * Execute a tool call and return the result as a string.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_deal": {
      const { getHubSpotClient } = await import("@/lib/hubspot");
      const client = getHubSpotClient();
      const deal = await client.crm.deals.basicApi.getById(
        input.dealId as string,
        ["dealname", "dealstage", "amount", "pb_location", "design_status",
         "permitting_status", "site_survey_status", "install_date",
         "inspection_date", "pto_date", "hubspot_owner_id", "closedate"]
      );
      return JSON.stringify(deal.properties);
    }

    case "get_review_results": {
      const { prisma } = await import("@/lib/db");
      const reviews = await prisma.projectReview.findMany({
        where: {
          dealId: input.dealId as string,
          ...(input.skill ? { skill: input.skill as string } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      return JSON.stringify(reviews);
    }

    case "search_deals": {
      const { getHubSpotClient } = await import("@/lib/hubspot");
      const client = getHubSpotClient();
      const response = await client.crm.deals.searchApi.doSearch({
        query: input.query as string,
        limit: 10,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      });
      return JSON.stringify(response.results.map((r) => r.properties));
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
```

**Step 2: Write the chat route**

Create `src/app/api/chat/route.ts`:

```ts
/**
 * POST /api/chat
 *
 * Claude chat endpoint. Supports tool-use for project lookups.
 * Streams response via SSE. Persists messages to ChatMessage table.
 *
 * Body: { message: string, dealId?: string, history?: { role, content }[] }
 * Auth: any authenticated user
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/ai";
import { CHAT_TOOLS, executeTool } from "@/lib/chat-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an AI assistant for Photon Brothers, a solar installation company.
You help team members with project questions, review results, and operational data.

You have access to HubSpot deal data and review results. Use the tools provided to look up
specific projects when asked. Be concise and actionable.

Key context:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
- Pipeline stages: Site Survey → Design & Engineering → Permitting → Ready To Build → Construction → Inspection → PTO → Close Out
- Review skills: design-review, engineering-review, sales-advisor

If you don't have enough information to answer, say so. Don't guess at deal data — use the tools.`;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, role } = authResult;

  if (isRateLimited(email)) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
  }

  let body: { message?: string; dealId?: string; history?: Array<{ role: string; content: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, dealId, history = [] } = body;
  if (!message || typeof message !== "string" || message.length > 2000) {
    return NextResponse.json({ error: "message is required (max 2000 chars)" }, { status: 400 });
  }

  // Build messages array from history + new message
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-20).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: message },
  ];

  // If dealId provided, prepend context
  let systemPrompt = SYSTEM_PROMPT;
  if (dealId) {
    systemPrompt += `\n\nThe user is currently viewing deal ID: ${dealId}. Use this context when answering questions about "this project" or "this deal".`;
  }
  systemPrompt += `\n\nUser role: ${role}. User email: ${email}.`;

  const client = getAnthropicClient();
  const model = dealId ? CLAUDE_MODELS.sonnet : CLAUDE_MODELS.haiku;

  // Agentic loop: handle tool calls
  let currentMessages = messages;
  let finalText = "";
  const maxToolRounds = 5;

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: CHAT_TOOLS,
      messages: currentMessages,
    });

    // Collect text blocks
    const textBlocks = response.content.filter((b) => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("");

    // Check for tool use
    const toolBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolBlocks.length === 0 || response.stop_reason === "end_turn") break;

    // Execute tools and continue conversation
    const toolResults = await Promise.all(
      toolBlocks.map(async (tool) => {
        const result = await executeTool(tool.name, tool.input as Record<string, unknown>);
        return { type: "tool_result" as const, tool_use_id: tool.id, content: result };
      })
    );

    currentMessages = [
      ...currentMessages,
      { role: "assistant" as const, content: response.content as unknown as string },
      { role: "user" as const, content: toolResults as unknown as string },
    ];
  }

  // Persist messages
  const userId = email; // Use email as userId until we have proper user IDs in chat
  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { userId, dealId, role: "user", content: message },
    }),
    prisma.chatMessage.create({
      data: { userId, dealId, role: "assistant", content: finalText, model },
    }),
  ]);

  return NextResponse.json({ response: finalText, model });
}
```

**Step 3: Commit**

```bash
git add src/lib/anthropic.ts src/lib/chat-tools.ts src/app/api/chat/
git commit -m "feat: add POST /api/chat route with Claude tool-use"
```

---

## Task 9: Pipeline Webhook — Design Review Gate

**Files:**
- Create: `src/app/api/webhooks/hubspot/design-review/route.ts`

This follows the exact same pattern as the existing `design-complete/route.ts` webhook. Reference that file for signature validation and dedup patterns.

**Step 1: Write the webhook route**

Create `src/app/api/webhooks/hubspot/design-review/route.ts`:

```ts
/**
 * HubSpot Webhook — Design Review Gate
 *
 * POST /api/webhooks/hubspot/design-review
 *
 * Triggered when a deal enters a design-review stage. Runs the design
 * check engine and creates a HubSpot task + Gmail notification if issues found.
 *
 * Pattern: same as design-complete webhook (signature validation, waitUntil).
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { logActivity } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Validate HubSpot signature
  const body = await request.text();
  const isValid = await validateHubSpotWebhook(request, body);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { objectId?: number; propertyName?: string; propertyValue?: string };
  try {
    const events = JSON.parse(body);
    payload = Array.isArray(events) ? events[0] : events;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dealId = String(payload.objectId);
  if (!dealId || dealId === "undefined") {
    return NextResponse.json({ error: "No deal ID" }, { status: 400 });
  }

  // Respond immediately, run review in background
  waitUntil(
    (async () => {
      try {
        // Call our own reviews API internally
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL;
        const apiToken = process.env.API_SECRET_TOKEN;

        const response = await fetch(`${baseUrl}/api/reviews/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
            "x-api-token-authenticated": "1",
          },
          body: JSON.stringify({
            dealId,
            skill: "design-review",
            trigger: "webhook",
          }),
        });

        const result = await response.json();

        await logActivity({
          action: "WEBHOOK_DESIGN_REVIEW",
          entity: "deal",
          entityId: dealId,
          detail: `Design review: ${result.passed ? "PASSED" : `FAILED (${result.errorCount} errors)`}`,
          actor: "system",
        });

        // TODO: Create HubSpot task + Gmail notification if !result.passed
        // This will be wired up when Gmail sending is confirmed working
      } catch (err) {
        console.error("[design-review-webhook] Error:", err);
        await logActivity({
          action: "WEBHOOK_DESIGN_REVIEW",
          entity: "deal",
          entityId: dealId,
          detail: `Design review webhook error: ${err instanceof Error ? err.message : "unknown"}`,
          actor: "system",
        });
      }
    })()
  );

  return NextResponse.json({ status: "accepted", dealId });
}
```

**Step 2: Add route to PUBLIC_API_ROUTES**

Find where `PUBLIC_API_ROUTES` is defined (middleware or auth config) and add `/api/webhooks/hubspot/design-review` to bypass session auth (signature validation happens in-route).

**Step 3: Commit**

```bash
git add src/app/api/webhooks/hubspot/design-review/
git commit -m "feat: add design-review webhook for pipeline gate"
```

---

## Task 10: Chat Widget Component

**Files:**
- Create: `src/components/ChatWidget.tsx`
- Modify: `src/components/DashboardShell.tsx` (add ChatWidget)

**Step 1: Write the ChatWidget component**

Create `src/components/ChatWidget.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatWidgetProps {
  dealId?: string;
  projectId?: string;
}

export default function ChatWidget({ dealId, projectId }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          dealId,
          history: messages.slice(-20),
        }),
      });
      const data = await res.json();
      if (data.response) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data.error || "Sorry, something went wrong." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg hover:bg-orange-600 transition-colors"
        aria-label="Open chat"
      >
        {isOpen ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        )}
      </button>

      {/* Slide-out panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[500px] w-[400px] flex-col rounded-2xl bg-surface shadow-card-lg border border-t-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-t-border px-4 py-3 bg-surface-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">PB Assistant</h3>
              {projectId && <p className="text-xs text-muted">{projectId}</p>}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-muted text-center mt-8">
                {dealId ? `Ask me anything about this project.` : `Ask me about any project or process.`}
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-orange-500 text-white"
                    : "bg-surface-2 text-foreground"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-2 rounded-xl px-3 py-2 text-sm text-muted animate-pulse">Thinking...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-t-border p-3">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 rounded-lg border border-t-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

**Step 2: Add ChatWidget to DashboardShell**

In `src/components/DashboardShell.tsx`, import and render the ChatWidget at the bottom of the component (after the main content, before the closing fragment/div). Pass `dealId` if available from props or URL context.

```tsx
import ChatWidget from "./ChatWidget";

// Inside the DashboardShell return, after main content:
<ChatWidget />
```

**Step 3: Commit**

```bash
git add src/components/ChatWidget.tsx src/components/DashboardShell.tsx
git commit -m "feat: add ChatWidget slide-out panel to DashboardShell"
```

---

## Task 11: Review Action Buttons Component

**Files:**
- Create: `src/components/ReviewActions.tsx`

**Step 1: Write the ReviewActions component**

Create `src/components/ReviewActions.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { SkillName } from "@/lib/checks/types";

interface ReviewActionsProps {
  dealId: string;
  projectId?: string;
  userRole: string;
}

interface ReviewResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  findings: Array<{ check: string; severity: string; message: string }>;
  durationMs: number;
}

const SKILL_CONFIG: Array<{ skill: SkillName; label: string; roles: string[] }> = [
  { skill: "design-review", label: "Design Review", roles: ["ADMIN", "OWNER", "MANAGER", "DESIGNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"] },
  { skill: "engineering-review", label: "Engineering Review", roles: ["ADMIN", "OWNER", "MANAGER", "TECH_OPS", "OPERATIONS_MANAGER", "PROJECT_MANAGER"] },
  { skill: "sales-advisor", label: "Sales Check", roles: ["ADMIN", "OWNER", "MANAGER", "SALES"] },
];

export default function ReviewActions({ dealId, projectId, userRole }: ReviewActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReviewResult>>({});

  const visibleSkills = SKILL_CONFIG.filter((s) => s.roles.includes(userRole));

  async function runReview(skill: SkillName) {
    setLoading(skill);
    try {
      const res = await fetch("/api/reviews/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, skill }),
      });
      const data = await res.json();
      setResults((prev) => ({ ...prev, [skill]: data }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [skill]: { passed: false, errorCount: 1, warningCount: 0, findings: [{ check: "network-error", severity: "error", message: "Failed to run review" }], durationMs: 0 },
      }));
    } finally {
      setLoading(null);
    }
  }

  if (visibleSkills.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {visibleSkills.map(({ skill, label }) => {
          const result = results[skill];
          return (
            <button
              key={skill}
              onClick={() => runReview(skill)}
              disabled={loading === skill}
              className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                result?.passed === false
                  ? "bg-red-500/10 text-red-600 border border-red-500/30 hover:bg-red-500/20"
                  : result?.passed === true
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-surface-2 text-foreground border border-t-border hover:bg-surface"
              } disabled:opacity-50`}
            >
              {loading === skill ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : result ? (
                result.passed ? "✓" : `✗ ${result.errorCount}`
              ) : null}
              {label}
            </button>
          );
        })}
      </div>

      {/* Show findings for any result with issues */}
      {Object.entries(results).map(([skill, result]) =>
        result.findings.length > 0 ? (
          <div key={skill} className="rounded-lg border border-t-border bg-surface-2 p-3 space-y-1">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">
              {SKILL_CONFIG.find((s) => s.skill === skill)?.label} — {result.findings.length} finding{result.findings.length !== 1 ? "s" : ""} ({result.durationMs}ms)
            </p>
            {result.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={f.severity === "error" ? "text-red-500" : f.severity === "warning" ? "text-amber-500" : "text-blue-500"}>
                  {f.severity === "error" ? "●" : f.severity === "warning" ? "▲" : "ℹ"}
                </span>
                <span className="text-foreground">{f.message}</span>
              </div>
            ))}
            {projectId && (
              <a href={`/dashboards/reviews/${projectId}`} className="text-xs text-orange-500 hover:underline mt-1 inline-block">
                View full review history →
              </a>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ReviewActions.tsx
git commit -m "feat: add ReviewActions component with role-gated action buttons"
```

---

## Task 12: Review History Dashboard Page

**Files:**
- Create: `src/app/dashboards/reviews/[dealId]/page.tsx`

**Step 1: Write the review history page**

Create `src/app/dashboards/reviews/[dealId]/page.tsx`:

```tsx
import DashboardShell from "@/components/DashboardShell";
import { prisma } from "@/lib/db";

interface Props {
  params: Promise<{ dealId: string }>;
}

export default async function ReviewHistoryPage({ params }: Props) {
  const { dealId } = await params;

  const reviews = await prisma.projectReview.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const projectId = reviews[0]?.projectId || dealId;

  return (
    <DashboardShell title={`Reviews — ${projectId}`} accentColor="orange">
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          {["design-review", "engineering-review", "sales-advisor"].map((skill) => {
            const latest = reviews.find((r) => r.skill === skill);
            return (
              <div key={skill} className="rounded-xl border border-t-border bg-surface p-4">
                <p className="text-xs font-medium text-muted uppercase tracking-wide">{skill.replace("-", " ")}</p>
                {latest ? (
                  <>
                    <p className={`text-2xl font-bold mt-1 ${latest.passed ? "text-emerald-500" : "text-red-500"}`}>
                      {latest.passed ? "Passed" : `${latest.errorCount} errors`}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {latest.trigger} · {new Date(latest.createdAt).toLocaleDateString()}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted mt-1">No reviews yet</p>
                )}
              </div>
            );
          })}
        </div>

        {/* History */}
        <div className="rounded-xl border border-t-border bg-surface">
          <div className="border-b border-t-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Review History</h3>
          </div>
          <div className="divide-y divide-t-border">
            {reviews.map((review) => (
              <div key={review.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${review.passed ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className="text-sm font-medium text-foreground">{review.skill.replace("-", " ")}</span>
                    <span className="text-xs text-muted">{review.trigger}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {review.triggeredBy} · {new Date(review.createdAt).toLocaleString()} · {review.durationMs}ms
                  </div>
                </div>
                {(review.findings as Array<{ severity: string; message: string }>).length > 0 && (
                  <div className="mt-2 space-y-1 pl-4">
                    {(review.findings as Array<{ severity: string; message: string }>).map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className={f.severity === "error" ? "text-red-500" : f.severity === "warning" ? "text-amber-500" : "text-blue-500"}>
                          {f.severity === "error" ? "●" : f.severity === "warning" ? "▲" : "ℹ"}
                        </span>
                        <span className="text-foreground">{f.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {reviews.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                No reviews have been run for this deal yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
```

**Step 2: Add route to role permissions**

In `src/lib/role-permissions.ts`, add `/dashboards/reviews` and `/api/reviews` to all roles that have dashboard access (MANAGER and above). For now, add to ADMIN_ONLY_ROUTES initially, then broaden after testing:

Add to `ADMIN_ONLY_ROUTES`:
```ts
"/dashboards/reviews",
"/api/reviews",
"/api/chat",
```

**Step 3: Commit**

```bash
git add src/app/dashboards/reviews/ src/lib/role-permissions.ts
git commit -m "feat: add review history dashboard page"
```

---

## Task 13: Integration Test — Full Pipeline

**Files:**
- Create: `src/__tests__/api/reviews-run.test.ts`

**Step 1: Write integration test**

Create `src/__tests__/api/reviews-run.test.ts` that mocks HubSpot + Prisma and tests the full flow: POST → run checks → save to DB → return results.

This test validates the API route handler end-to-end with mocked dependencies. Test both success (deal with all properties) and failure (deal with missing fields) scenarios, plus auth rejection for wrong role.

**Step 2: Run all tests**

Run: `npx jest --roots='<rootDir>/src' src/__tests__/lib/checks/ src/__tests__/api/reviews-run.test.ts -v`
Expected: All tests pass.

**Step 3: Build check**

Run: `npm run build`
Expected: Clean build, no type errors.

**Step 4: Commit**

```bash
git add src/__tests__/api/reviews-run.test.ts
git commit -m "test: add integration test for reviews/run API"
```

---

## Task 14: Update Role Permissions + Route Access

**Files:**
- Modify: `src/lib/role-permissions.ts`

**Step 1: Move review routes from ADMIN_ONLY to appropriate roles**

After testing confirms everything works, update `ROLE_PERMISSIONS` to add `/api/reviews`, `/api/chat`, and `/dashboards/reviews` to the `allowedRoutes` arrays for: MANAGER, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS, DESIGNER, PERMITTING, SALES.

Remove from `ADMIN_ONLY_ROUTES`.

**Step 2: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat: open review and chat routes to all operational roles"
```

---

## Task 15: Final Verification + PR

**Step 1: Run full test suite**

Run: `npx jest --roots='<rootDir>/src' -v`
Expected: All tests pass (pre-existing failures excluded).

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build.

**Step 3: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 4: Commit any remaining changes and create PR**

Use the `commit-push-pr` skill to push and create a PR against main.
