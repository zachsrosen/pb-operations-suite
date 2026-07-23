# HubSpot Email Triage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable way to answer, for every HubSpot notification email, "is the underlying issue already resolved?" — a read-only state script plus a triage skill that classifies, judges, and (on approval) trashes the resolved ones.

**Architecture:** One read-only repo script (`scripts/hubspot-email-triage-state.ts`) does all bulk reads — HubSpot deals by PROJ number plus a single live PE read — and emits one JSON row per deal. One personal skill (`~/.claude/skills/hubspot-email-triage/`) fetches and classifies emails, compares each against that state, reports, and cleans up after explicit approval.

**Tech Stack:** TypeScript, `tsx` (run via `npx tsx`), `@hubspot/api-client`, the repo's `src/lib/pe-api.ts` and `src/lib/hubspot.ts`, Jest for tests, Gmail MCP tools on the skill side.

**Spec:** `docs/superpowers/specs/2026-07-21-hubspot-email-triage-design.md`

---

## Property-name resolution (done — pin these, do not re-derive)

The spec deferred exact property names to build time. They are now resolved. Use exactly these:

| Spec concept | Real HubSpot property | Source |
|---|---|---|
| Deal stage | `dealstage` (label via `DEAL_STAGE_MAP`, `src/lib/hubspot.ts:283`) | hubspot.ts |
| Permitting status | `permitting_status` | hubspot.ts `DEAL_PROPERTIES` |
| Interconnection status | `interconnection_status` | hubspot.ts |
| Design status | `design_status` | hubspot.ts |
| DA status | `layout_status` (rejection value literal `"Design Rejected"`; rework `"Pending Sales Changes"` / `"Pending Ops Changes"`, `src/lib/da-rework-flags.ts:26-28`) | da-rework-flags.ts |
| Revision counters | `da_revision_counter`, `as_built_revision_counter`, `permit_revision_counter`, `interconnection_revision_counter`, `total_revision_count` | hubspot.ts |
| Reason fields | `rtb_blocked_reason`, `on_hold_selection`, `on_hold_reason`, `sales_change_order_notes`, `inspection_failure_reason` | hubspot.ts `DEAL_PROPERTIES` ~:770-773 |
| Permit issued date | `permit_completion_date` | hubspot.ts ~:1107 |
| PTO granted date | `pto_completion_date` | hubspot.ts ~:1140 |
| **PE payment RECEIVED** | `pe_m1_paid_date`, `pe_m2_paid_date` — the actual receipt signal. NOT `financials.paymentAtIC/paymentAtPC`, which are amounts *owed* and are present regardless of payment | `src/app/api/accounting/pe-analytics/route.ts:82-83`, `scripts/_pe-stuck-closeout.ts:34` |
| **Utility photo / PTO status** | `pto_status` — Xcel photo states are VALUES inside it: `"Xcel Photos Ready to Submit"`, `"Xcel Photos Submitted"`, `"XCEL Photos Rejected"`, `"Xcel Photos Ready to Resubmit"`, `"Xcel Photos Resubmitted"`, `"Xcel Photos Approved"` (`src/app/dashboards/deals/deals-types.ts:361-366`) | deals-types.ts |
| DA sent / approved dates | `design_approval_sent_date` / `layout_approval_date` | hubspot.ts:1093-1094 |
| M1/M2 dates | `pe_m1_status`, `pe_m1_submission_date`, `pe_m1_approval_date`, `pe_m1_rejection_date`, `pe_m2_status`, `pe_m2_approval_date` (NOT all in `DEAL_PROPERTIES` — request explicitly) | scripts/check_pe_m1.ts:18-19 |
| PE join key | `pe_project_id` | hubspot.ts:719 |

**CORRECTED 2026-07-22.** An earlier revision of this plan claimed loose-ends and cancellation-reason
deal properties did not exist, based on a repo grep that only found a Zuper job-status string. That
was wrong — Zach flagged it, and the live HubSpot property list confirms all of them. **The repo's
`DEAL_PROPERTIES` array is a subset of the CRM; never infer a property's absence from code.** Verify
against HubSpot MCP `search_properties` on `DEAL`.

The real names (trailing underscores included):

| Concept | Property | Type |
|---|---|---|
| Loose ends flag | `loose_ends_remaining_` | enum `Yes` / `No` |
| Loose end notes | `loose_end_notes_` | string |
| Cancellation reason | `cancellation_reason` | string |
| Cancellation category | `cancellation_reason_category` | enum (18 options: `financing_credit`, `customer_changed_mind`, `technical_roof_structural`, …) |
| Cancellation date | `cancellation_date` | date |
| Permit rejection cause | `cause_of_permit_rejection_` | enum (`New AHJ Requirement`, `Design Quality Issue`, `Miscellaneous`, `Unknown`) |
| Interconnection rejection cause | `cause_of_interconnection_rejection_` | enum (`New Utility Requirement`, `Design Quality Issue`, `Utility Error`, `Miscellaneous`, `Unknown`) |
| DA rejection reason | `design_approval_rejection_reason` | string |
| PTO rejection reason | `pto_rejection_reason` | string |
| As-built revision reason | `inspection_rejection_reason` | string (label is "As-Built Revision Reason") |

All are in `TRIAGE_PROPERTIES` and verified populating on live deals.

**One explicit deferral:** the spec's contract says `hubspot_owner` (resolved *name*). Resolving names
requires the owner-map machinery in `hubspot.ts` (`fetchAllOwnersMinimal()` + property-option
scraping, ~:1421-1592) — disproportionate for a triage row. The row stores `ownerId` only; reports
identify the owner via the HubSpot deal link. Record this deferral in the skill.

## File structure

| File | Responsibility |
|---|---|
| `scripts/hubspot-email-triage-state.ts` (create) | Read-only bulk state fetch. Exports `fetchTriageState(projNumbers: string[]): Promise<TriageState>`; CLI guard for ad-hoc runs. |
| `src/__tests__/hubspot-email-triage-state.test.ts` (create) | Unit tests with mocked `@/lib/hubspot` + `@/lib/pe-api`. |
| `tsconfig.scripts.json` (create) | Scoped TS config so the new script is actually type-checked — the root config excludes `scripts/`. |
| `~/.claude/skills/hubspot-email-triage/SKILL.md` (create) | Classification table, blocker mapping, safety rules, output convention. |

No existing files are modified.

---

## Chunk 1: The state script

### Task 1: Types and the PROJ→deal fetch

**Files:**
- Create: `scripts/hubspot-email-triage-state.ts`
- Test: `src/__tests__/hubspot-email-triage-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { fetchTriageState } from "../../scripts/hubspot-email-triage-state";

// DEAL_STAGE_MAP must be in the mock — toRow indexes it, and a bare
// jest.fn()-only factory leaves it undefined, throwing on every row build.
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: jest.fn(),
  DEAL_STAGE_MAP: { "68229430": "Close Out" },
}));
jest.mock("@/lib/pe-api", () => ({ listAllProjects: jest.fn() }));

import { searchWithRetry } from "@/lib/hubspot";
import { listAllProjects } from "@/lib/pe-api";

const mockSearch = searchWithRetry as jest.Mock;
const mockListAll = listAllProjects as jest.Mock;

describe("fetchTriageState — deal resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAll.mockResolvedValue([]);
  });

  it("maps a found deal to a row keyed by PROJ number", async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          id: "123",
          properties: {
            dealname: "PROJ-9584 | Bitz, Lauren | 8771 Culebra Ct",
            dealstage: "68229430",
            permitting_status: "Permit Issued",
            pto_status: "Xcel Photos Approved",
            pe_project_id: "CO2602-BITZ1",
          },
        },
      ],
    });

    const state = await fetchTriageState(["PROJ-9584"]);

    expect(state.rows["PROJ-9584"]).toMatchObject({
      projNumber: "PROJ-9584",
      dealId: "123",
      dealStage: "Close Out", // label, not the raw "68229430" ID
      permittingStatus: "Permit Issued",
      ptoStatus: "Xcel Photos Approved",
      peProjectId: "CO2602-BITZ1",
    });
    expect(state.rows["PROJ-9584"].hubspotUrl).toContain("/123");
    expect(state.notFound).toEqual([]);
  });

  it("puts unmatched PROJ numbers in notFound, never in rows", async () => {
    mockSearch.mockResolvedValue({ results: [] });
    const state = await fetchTriageState(["PROJ-0001"]);
    expect(state.rows["PROJ-0001"]).toBeUndefined();
    expect(state.notFound).toEqual(["PROJ-0001"]);
  });

  it("rejects a fuzzy search hit whose dealname is a different PROJ number", async () => {
    mockSearch.mockResolvedValue({
      results: [{ id: "9", properties: { dealname: "PROJ-95840 | Other" } }],
    });
    const state = await fetchTriageState(["PROJ-9584"]);
    expect(state.notFound).toEqual(["PROJ-9584"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/hubspot-email-triage-state.test.ts -t "deal resolution"`
Expected: FAIL — cannot find module `../../scripts/hubspot-email-triage-state`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/hubspot-email-triage-state.ts`:

```ts
#!/usr/bin/env npx tsx
/**
 * Read-only state fetch backing the `hubspot-email-triage` skill.
 * Given PROJ numbers parsed from HubSpot notification emails, returns each deal's
 * live state (plus one shared PE read) so the skill can decide whether the issue
 * each email describes is already resolved.
 *
 * Run: npx tsx scripts/hubspot-email-triage-state.ts PROJ-9584 PROJ-7353
 *      echo '["PROJ-9584"]' | npx tsx scripts/hubspot-email-triage-state.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

import { searchWithRetry, DEAL_STAGE_MAP } from "@/lib/hubspot";
import { listAllProjects, type PeProjectListItem } from "@/lib/pe-api";

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "21710069";

/** Properties the triage checks read. Pinned in the plan's resolution table. */
const TRIAGE_PROPERTIES = [
  "dealname",
  "dealstage",
  "hubspot_owner_id",
  "permitting_status",
  "interconnection_status",
  "design_status",
  "layout_status",
  "pto_status",
  "da_revision_counter",
  "as_built_revision_counter",
  "permit_revision_counter",
  "interconnection_revision_counter",
  "total_revision_count",
  "rtb_blocked_reason",
  "on_hold_selection",
  "on_hold_reason",
  "sales_change_order_notes",
  "inspection_failure_reason",
  "permit_completion_date",
  "pto_completion_date",
  "design_approval_sent_date",
  "layout_approval_date",
  "pe_m1_status",
  "pe_m1_submission_date",
  "pe_m1_approval_date",
  "pe_m1_rejection_date",
  "pe_m2_status",
  "pe_m2_approval_date",
  // Payment RECEIVED signals — PE financials only carry amounts owed.
  "pe_m1_paid_date",
  "pe_m2_paid_date",
  "pe_project_id",
];

export interface PeDocState {
  status: string | null;
  latestVersionDate: string | null;
}

export interface PeBlock {
  docs: Record<string, PeDocState>;
  /** Milestone status/dates come from the HubSpot deal, not the PE list payload. */
  milestones: {
    m1Status: string | null;
    m1ApprovalDate: string | null;
    m2Status: string | null;
    m2ApprovalDate: string | null;
  };
  payments: {
    /** Amounts OWED (from PE financials) — never a receipt signal. */
    amountAtIC: number | null;
    amountAtPC: number | null;
    /** Receipt signals (from the HubSpot deal). Non-null = paid. */
    m1PaidDate: string | null;
    m2PaidDate: string | null;
  };
  portalUrl: string | null;
}

export interface TriageRow {
  projNumber: string;
  dealId: string;
  dealName: string;
  dealStage: string | null;
  ownerId: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  designStatus: string | null;
  layoutStatus: string | null;
  ptoStatus: string | null;
  revisionCounters: Record<string, string | null>;
  reasons: Record<string, string | null>;
  dates: Record<string, string | null>;
  milestoneStatus: { m1: string | null; m2: string | null };
  peProjectId: string | null;
  pe: PeBlock | null;
  hubspotUrl: string;
}

export interface TriageState {
  rows: Record<string, TriageRow>;
  notFound: string[];
  /** Run-wide: one failed listAllProjects() means no deal has PE data. */
  peUnavailable: boolean;
  peError?: string;
}

function prop(
  properties: Record<string, string | null | undefined>,
  key: string
): string | null {
  const v = properties[key];
  return v === undefined || v === "" ? null : (v as string | null);
}

/** PROJ-9584 must not match PROJ-95840. */
function dealNameMatches(dealName: string, proj: string): boolean {
  const digits = proj.replace(/^PROJ-/i, "");
  return new RegExp(`(^|[^0-9])PROJ-${digits}([^0-9]|$)`, "i").test(dealName);
}

async function resolveDeal(proj: string) {
  const res = await searchWithRetry({
    query: proj,
    limit: 20,
    properties: TRIAGE_PROPERTIES,
  } as Parameters<typeof searchWithRetry>[0]);
  const results = (res?.results ?? []) as Array<{
    id: string;
    properties: Record<string, string | null>;
  }>;
  return results.find((r) => dealNameMatches(r.properties?.dealname ?? "", proj)) ?? null;
}

function toRow(
  proj: string,
  deal: { id: string; properties: Record<string, string | null> }
): TriageRow {
  const p = deal.properties ?? {};
  return {
    projNumber: proj,
    dealId: deal.id,
    dealName: prop(p, "dealname") ?? "",
    // Human-readable label; falls back to the raw stage ID if unmapped.
    dealStage:
      DEAL_STAGE_MAP[prop(p, "dealstage") ?? ""] ?? prop(p, "dealstage"),
    ownerId: prop(p, "hubspot_owner_id"),
    permittingStatus: prop(p, "permitting_status"),
    interconnectionStatus: prop(p, "interconnection_status"),
    designStatus: prop(p, "design_status"),
    layoutStatus: prop(p, "layout_status"),
    ptoStatus: prop(p, "pto_status"),
    revisionCounters: {
      da: prop(p, "da_revision_counter"),
      asBuilt: prop(p, "as_built_revision_counter"),
      permit: prop(p, "permit_revision_counter"),
      interconnection: prop(p, "interconnection_revision_counter"),
      total: prop(p, "total_revision_count"),
    },
    reasons: {
      rtbBlocked: prop(p, "rtb_blocked_reason"),
      onHoldSelection: prop(p, "on_hold_selection"),
      onHoldNotes: prop(p, "on_hold_reason"),
      salesChangeOrder: prop(p, "sales_change_order_notes"),
      inspectionFailure: prop(p, "inspection_failure_reason"),
    },
    dates: {
      permitIssued: prop(p, "permit_completion_date"),
      ptoGranted: prop(p, "pto_completion_date"),
      daSent: prop(p, "design_approval_sent_date"),
      daApproved: prop(p, "layout_approval_date"),
      m1Submission: prop(p, "pe_m1_submission_date"),
      m1Approval: prop(p, "pe_m1_approval_date"),
      m1Rejection: prop(p, "pe_m1_rejection_date"),
      m2Approval: prop(p, "pe_m2_approval_date"),
      m1Paid: prop(p, "pe_m1_paid_date"),
      m2Paid: prop(p, "pe_m2_paid_date"),
    },
    milestoneStatus: {
      m1: prop(p, "pe_m1_status"),
      m2: prop(p, "pe_m2_status"),
    },
    peProjectId: prop(p, "pe_project_id"),
    pe: null,
    hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${deal.id}`,
  };
}

export async function fetchTriageState(projNumbers: string[]): Promise<TriageState> {
  const unique = Array.from(new Set(projNumbers.map((p) => p.toUpperCase())));
  const rows: Record<string, TriageRow> = {};
  const notFound: string[] = [];

  for (const proj of unique) {
    const deal = await resolveDeal(proj);
    if (!deal) {
      notFound.push(proj);
      continue;
    }
    rows[proj] = toRow(proj, deal);
  }

  return { rows, notFound, peUnavailable: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/hubspot-email-triage-state.test.ts -t "deal resolution"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hubspot-email-triage-state.ts src/__tests__/hubspot-email-triage-state.test.ts
git commit -m "feat(triage): deal-state fetch for hubspot email triage"
```

### Task 2: The PE block (single read, run-wide unavailability)

**Files:**
- Modify: `scripts/hubspot-email-triage-state.ts`
- Test: `src/__tests__/hubspot-email-triage-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
describe("fetchTriageState — PE block", () => {
  beforeEach(() => jest.clearAllMocks());

  const dealWithPe = {
    results: [
      {
        id: "123",
        properties: {
          dealname: "PROJ-9584 | Bitz, Lauren",
          pe_project_id: "CO2602-BITZ1",
          pe_m1_status: "M1 Submitted",
          pe_m1_approval_date: "2026-07-19",
          pe_m1_paid_date: "2026-07-20",
          pe_m2_status: "M2 Not Started",
        },
      },
    ],
  };

  it("attaches PE docs, milestones, payments and portal URL to the matching deal", async () => {
    mockSearch.mockResolvedValue(dealWithPe);
    mockListAll.mockResolvedValue([
      {
        id: "raceway-uuid-1",
        projectId: "CO2602-BITZ1",
        financials: { paymentAtIC: 13580.41, paymentAtPC: 6790.2 },
        documents: {
          customerAgreement: {
            present: true,
            version: 2,
            status: "RESPONSE_NEEDED",
            versions: [
              { version: 1, uploadedAt: "2026-07-01T00:00:00Z", uploadedBy: "a@b.com" },
              { version: 2, uploadedAt: "2026-07-18T00:00:00Z", uploadedBy: "a@b.com" },
            ],
          },
          photos: { present: false, version: 0, status: null },
        },
      },
    ] as unknown as PeProjectListItem[]);

    const state = await fetchTriageState(["PROJ-9584"]);
    const pe = state.rows["PROJ-9584"].pe!;

    expect(pe.docs.customerAgreement).toEqual({
      status: "RESPONSE_NEEDED",
      latestVersionDate: "2026-07-18T00:00:00Z",
    });
    expect(pe.docs.photos).toEqual({ status: null, latestVersionDate: null });
    expect(pe.portalUrl).toBe("https://raceway.participate.energy/projects/raceway-uuid-1");
    expect(state.peUnavailable).toBe(false);
  });

  it("merges HubSpot milestone status/dates into the PE block", async () => {
    mockSearch.mockResolvedValue(dealWithPe);
    mockListAll.mockResolvedValue([
      { id: "u1", projectId: "CO2602-BITZ1", documents: {}, financials: {} },
    ] as unknown as PeProjectListItem[]);

    const pe = (await fetchTriageState(["PROJ-9584"])).rows["PROJ-9584"].pe!;

    expect(pe.milestones).toEqual({
      m1Status: "M1 Submitted",
      m1ApprovalDate: "2026-07-19",
      m2Status: "M2 Not Started",
      m2ApprovalDate: null,
    });
  });

  it("separates amounts owed from payment-received dates", async () => {
    mockSearch.mockResolvedValue(dealWithPe);
    mockListAll.mockResolvedValue([
      {
        id: "u1",
        projectId: "CO2602-BITZ1",
        documents: {},
        financials: { paymentAtIC: 13580.41, paymentAtPC: 6790.2 },
      },
    ] as unknown as PeProjectListItem[]);

    const pe = (await fetchTriageState(["PROJ-9584"])).rows["PROJ-9584"].pe!;

    // Amounts owed come from PE; receipt comes from HubSpot. M1 paid, M2 not.
    expect(pe.payments).toEqual({
      amountAtIC: 13580.41,
      amountAtPC: 6790.2,
      m1PaidDate: "2026-07-20",
      m2PaidDate: null,
    });
  });

  it("calls listAllProjects exactly once regardless of deal count", async () => {
    mockSearch.mockResolvedValue(dealWithPe);
    mockListAll.mockResolvedValue([]);
    await fetchTriageState(["PROJ-9584", "PROJ-7353", "PROJ-9620"]);
    expect(mockListAll).toHaveBeenCalledTimes(1);
  });

  it("sets peUnavailable run-wide when the PE read fails, leaving deal rows intact", async () => {
    mockSearch.mockResolvedValue(dealWithPe);
    mockListAll.mockRejectedValue(new Error("PE quota exhausted"));

    const state = await fetchTriageState(["PROJ-9584"]);

    expect(state.peUnavailable).toBe(true);
    expect(state.peError).toContain("quota");
    expect(state.rows["PROJ-9584"].pe).toBeNull();
    expect(state.rows["PROJ-9584"].permittingStatus).toBeDefined();
  });

  it("leaves pe null for deals with no pe_project_id", async () => {
    mockSearch.mockResolvedValue({
      results: [{ id: "5", properties: { dealname: "PROJ-1111 | X", pe_project_id: "" } }],
    });
    mockListAll.mockResolvedValue([]);
    const state = await fetchTriageState(["PROJ-1111"]);
    expect(state.rows["PROJ-1111"].pe).toBeNull();
    expect(state.peUnavailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/hubspot-email-triage-state.test.ts -t "PE block"`
Expected: FAIL — `pe` is `null` where a block is expected; `listAllProjects` never called.

- [ ] **Step 3: Write minimal implementation**

Add above `fetchTriageState`:

```ts
/**
 * Merges the PE-side project (docs, amounts) with the HubSpot-side row
 * (milestone status/dates, payment receipt dates). Both halves are required —
 * neither system alone answers "is this milestone paid/approved?".
 */
function buildPeBlock(project: PeProjectListItem, row: TriageRow): PeBlock {
  const docs: Record<string, PeDocState> = {};
  const documents = (project.documents ?? {}) as Record<
    string,
    { status?: string | null; versions?: Array<{ uploadedAt: string }> }
  >;
  for (const [key, info] of Object.entries(documents)) {
    const versions = info?.versions ?? [];
    const latest = versions.length
      ? versions
          .map((v) => v.uploadedAt)
          .filter(Boolean)
          .sort()
          .slice(-1)[0]
      : null;
    docs[key] = { status: info?.status ?? null, latestVersionDate: latest ?? null };
  }
  return {
    docs,
    milestones: {
      m1Status: row.milestoneStatus.m1,
      m1ApprovalDate: row.dates.m1Approval ?? null,
      m2Status: row.milestoneStatus.m2,
      m2ApprovalDate: row.dates.m2Approval ?? null,
    },
    payments: {
      amountAtIC: project.financials?.paymentAtIC ?? null,
      amountAtPC: project.financials?.paymentAtPC ?? null,
      m1PaidDate: row.dates.m1Paid ?? null,
      m2PaidDate: row.dates.m2Paid ?? null,
    },
    portalUrl: project.id
      ? `https://raceway.participate.energy/projects/${project.id}`
      : null,
  };
}
```

Then replace the `return` in `fetchTriageState` with:

```ts
  const needsPe = Object.values(rows).some((r) => r.peProjectId);
  if (!needsPe) return { rows, notFound, peUnavailable: false };

  // ONE PE read for the whole run — see spec "single PE read" rule.
  let peProjects: PeProjectListItem[];
  try {
    peProjects = await listAllProjects();
  } catch (e) {
    return {
      rows,
      notFound,
      peUnavailable: true,
      peError: e instanceof Error ? e.message : String(e),
    };
  }

  const byProjectId = new Map(peProjects.map((p) => [p.projectId, p]));
  for (const row of Object.values(rows)) {
    if (!row.peProjectId) continue;
    const project = byProjectId.get(row.peProjectId);
    if (!project) continue;
    row.pe = buildPeBlock(project, row);
  }

  return { rows, notFound, peUnavailable: false };
```

No further edits are needed — `buildPeBlock(project, row)` reads the milestone and
payment fields straight off the row that `toRow` already populated.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/hubspot-email-triage-state.test.ts`
Expected: PASS (all 9 tests — 3 from Task 1, 6 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add scripts/hubspot-email-triage-state.ts src/__tests__/hubspot-email-triage-state.test.ts
git commit -m "feat(triage): single-read PE block with run-wide unavailability"
```

### Task 3: CLI entry point

**Files:**
- Modify: `scripts/hubspot-email-triage-state.ts`

- [ ] **Step 1: Add the CLI guard**

Append (the `require.main` guard keeps the module import-safe for Jest, matching
`scripts/backfill-shit-show-flags.ts`):

```ts
async function main() {
  const args = process.argv.slice(2).filter((a) => /^PROJ-\d+$/i.test(a));
  let projNumbers = args;

  if (!projNumbers.length && !process.stdin.isTTY) {
    const stdin = fs.readFileSync(0, "utf8").trim();
    if (stdin) {
      const parsed = JSON.parse(stdin);
      projNumbers = Array.isArray(parsed) ? parsed : [];
    }
  }

  if (!projNumbers.length) {
    console.error(
      "Usage: npx tsx scripts/hubspot-email-triage-state.ts PROJ-1234 [PROJ-5678 ...]\n" +
        '   or: echo \'["PROJ-1234"]\' | npx tsx scripts/hubspot-email-triage-state.ts'
    );
    process.exit(1);
  }

  const state = await fetchTriageState(projNumbers);
  console.log(JSON.stringify(state, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Verify the module is still import-safe**

Run: `npx jest src/__tests__/hubspot-email-triage-state.test.ts`
Expected: PASS — importing the module must not execute `main()`.

- [ ] **Step 3: Typecheck (requires a scoped config — the default one skips this file)**

`tsconfig.json` lists `"scripts"` in `exclude`, so a plain `npx tsc --noEmit` silently
type-checks NOTHING in this file. Jest doesn't catch type errors here either. Create
`tsconfig.scripts.json` at the repo root so the new script is actually checked:

```json
{
  "extends": "./tsconfig.json",
  "include": ["scripts/hubspot-email-triage-state.ts"],
  "exclude": []
}
```

Run: `npx tsc --noEmit -p tsconfig.scripts.json`
Expected: zero errors.

Verify the check is real before trusting it — temporarily change `const PORTAL_ID =` to
`const PORTAL_ID: number =`, re-run, and confirm it now REPORTS an error. Revert the
deliberate error before committing. A typecheck step that cannot fail is worse than none.

- [ ] **Step 4: Live smoke test**

Run: `npx tsx scripts/hubspot-email-triage-state.ts PROJ-9584`
Expected: JSON with a populated row — non-null `dealId`, `permittingStatus`, `ptoStatus`, and a `pe` block if the deal carries a `pe_project_id`. This is the step that proves the pinned property names are real; if any field is unexpectedly null across several known-good deals, the property name is wrong — fix it before proceeding.

- [ ] **Step 5: Commit**

```bash
git add scripts/hubspot-email-triage-state.ts tsconfig.scripts.json
git commit -m "feat(triage): CLI entry point + scoped typecheck config"
```

---

## Chunk 2: The triage skill

### Task 4: Write the skill

**Files:**
- Create: `~/.claude/skills/hubspot-email-triage/SKILL.md`

- [ ] **Step 1: Write the skill file**

Frontmatter `name: hubspot-email-triage`, and a `description` that triggers on: "go through my HubSpot emails", "which notifications are actioned", "triage my HubSpot inbox", "are these emails still open", "clean up HubSpot notifications".

Body sections, transcribed from the spec (`docs/superpowers/specs/2026-07-21-hubspot-email-triage-design.md`) — the skill is the spec made operational, so keep the wording of the rules intact:

1. **What this does** + the definition of actioned: *the underlying blocker is resolved, regardless of who resolved it.*
2. **The one non-negotiable principle:** never trust the email; check live state. Safe error direction is KEEP.
3. **How to run:** Gmail search `from:noreply@notifications.hubspot.com newer_than:14d` (widen on request), paginating via `pageToken` until exhausted (50/page max — a 200-email week needs 4+ pages; report the total processed). Parse PROJ from subject, falling back to the body's deal link. Then one call: `npx tsx scripts/hubspot-email-triage-state.ts <all PROJ numbers>` from the PB-Operations-Suite repo.
4. **The classification table** — copied verbatim from the spec, with the resolution checks rewritten against the real row fields (`row.permittingStatus`, `row.ptoStatus`, `row.pe.docs[...]`, etc.).
5. **Blocker-topic mapping** for mentions/comments — same, with `pto_status`'s Xcel values spelled out for the photo-rejection check.
6. **Safety rules** verbatim from the spec, including: unified preview, one approval, trash via `apply_sensitive_message_label` with `labelOption: TRASH`, never touch non-HubSpot senders, KEEP on any uncertainty.
7. **Gotchas** section recording what the build learned:
   - Xcel photo status is not its own property — it lives as values inside `pto_status`.
   - **`payments.amountAtIC/amountAtPC` are amounts OWED, not receipts.** They are populated whether or not PE has paid. The "PE Has Not Paid in 14 Days" check must read `payments.m1PaidDate` / `m2PaidDate` (from `pe_m1_paid_date` / `pe_m2_paid_date`). Reading the amounts would mark every unpaid project as paid.
   - There is no "loose ends" deal property (it is a Zuper job status) and no cancellation-reason property. Do not hunt for them.
   - Deal owner is stored as `ownerId` only; owner-name resolution is deliberately deferred. Identify owners via the HubSpot deal link.
   - PE list payloads may omit `versions[]`; when a PE-rejection email needs the versions-after-rejection check and `latestVersionDate` is null, call `getProjectDetails([...])` for those few projects only — never for the whole fleet (quota).
   - `pe-rejection-status-check.ts` is NOT invoked during triage (it would make a second `listAllProjects()` call).

- [ ] **Step 2: Verify skill discovery**

Run: `ls ~/.claude/skills/hubspot-email-triage/SKILL.md` and confirm the frontmatter parses (name + description present, description mentions the trigger phrases).

- [ ] **Step 3: Commit the repo-side reference**

The skill lives outside the repo, so commit only a pointer if one is warranted; otherwise no repo commit for this task.

### Task 5: Live validation run (report-only)

- [ ] **Step 1: Run the skill against the last 14 days, report-only**

Expected output: every email classified into a stream, an open set with reasons and links, an actioned set, and an Unknown section. **No trashing.**

- [ ] **Step 2: Validate subject-pattern coverage**

If the Unknown section contains recurring subjects, add table rows for them and re-run. This is the spec's "30-day subject validation" step. Record every new pattern in the skill's table.

- [ ] **Step 3: Spot-check accuracy before any cleanup**

Pick 5 emails classified "actioned" across different streams and verify against HubSpot/PE by hand. Any wrong call means the stream's check is wrong — fix before cleanup is ever offered.

- [ ] **Step 4: Report findings to Zach**

Summarize: counts per stream, the open backlog, accuracy of the spot-check, and any patterns added. Cleanup happens only after Zach approves a previewed set.
