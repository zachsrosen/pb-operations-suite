# Daily Focus Emails Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send personalized daily emails to P&I and Design leads showing their actionable queue items, plus manager rollup emails.

**Architecture:** A Vercel cron job at `/api/cron/daily-focus` queries HubSpot for deals matching "ready to submit" and "ready to resubmit" statuses, grouped by assigned lead. Data-driven query definitions in `config.ts` drive all queries, labels, colors, and rollup columns — adding a new status bucket means editing one array. Individual HTML emails go to each lead; two rollup emails (P&I + Design) go to the manager.

**Tech Stack:** Next.js API route, HubSpot `searchWithRetry`, `getStageMaps()` for stage names, `getHubSpotDealUrl()` for deal links, `sendEmailMessage()` for email delivery (Google Workspace → Resend failover), raw inline-CSS HTML (no React Email — matches existing cron email pattern in `audit/alerts.ts`).

---

## File Structure

```
src/
├── lib/daily-focus/
│   ├── config.ts        # Lead rosters, query definitions, excluded stages, color tokens
│   ├── format.ts        # Display name maps, deal name trimming, stage resolution
│   ├── queries.ts       # Generic HubSpot query executor consuming config definitions
│   ├── html.ts          # HTML email rendering (rows, sections, individual, rollup)
│   └── send.ts          # Orchestrator: query → format → html → send
├── app/api/cron/daily-focus/
│   └── route.ts         # GET handler with CRON_SECRET auth, dryRun/type params
└── __tests__/lib/
    ├── daily-focus-config.test.ts  # Config validation (no duplicate statuses, all leads have email)
    ├── daily-focus-format.test.ts  # Display name mapping, deal name trimming
    └── daily-focus-html.test.ts    # HTML builder output assertions
```

**Modified files:**
- `vercel.json` — add cron entry + maxDuration override

---

## Chunk 1: Data Layer (Config + Format + Queries)

### Task 1: Config Module

**Files:**
- Create: `src/lib/daily-focus/config.ts`
- Test: `src/__tests__/lib/daily-focus-config.test.ts`

- [ ] **Step 1: Write the config test**

```typescript
// src/__tests__/lib/daily-focus-config.test.ts
import {
  PI_LEADS,
  DESIGN_LEADS,
  PI_QUERY_DEFS,
  DESIGN_QUERY_DEFS,
  EXCLUDED_STAGES,
  MANAGER_EMAIL,
} from "@/lib/daily-focus/config";

describe("daily-focus config", () => {
  test("every PI lead has a valid email and at least one role", () => {
    for (const lead of PI_LEADS) {
      expect(lead.email).toMatch(/@photonbrothers\.com$/);
      expect(lead.roles.length).toBeGreaterThan(0);
    }
  });

  test("every Design lead has a valid email", () => {
    for (const lead of DESIGN_LEADS) {
      expect(lead.email).toMatch(/@photonbrothers\.com$/);
    }
  });

  test("no duplicate status values within a single query def", () => {
    for (const def of [...PI_QUERY_DEFS, ...DESIGN_QUERY_DEFS]) {
      const all = [...def.readyStatuses, ...(def.resubmitStatuses ?? [])];
      const unique = new Set(all);
      expect(unique.size).toBe(all.length);
    }
  });

  test("EXCLUDED_STAGES is non-empty", () => {
    expect(EXCLUDED_STAGES.length).toBeGreaterThan(0);
  });

  test("manager email is set", () => {
    expect(MANAGER_EMAIL).toMatch(/@photonbrothers\.com$/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

Run: `npm test -- --testPathPattern daily-focus-config --no-coverage`
Expected: FAIL — cannot find module `@/lib/daily-focus/config`

- [ ] **Step 3: Write config.ts**

```typescript
// src/lib/daily-focus/config.ts

// ── Types ──────────────────────────────────────────────────────────────

export type PIRole = "permit_tech" | "interconnections_tech";

export interface PILead {
  name: string;
  firstName: string;
  email: string;
  hubspotOwnerId: string;
  roles: PIRole[];
}

export interface DesignLead {
  name: string;
  firstName: string;
  email: string;
  hubspotOwnerId: string;
}

/**
 * Data-driven query definition. Each entry produces one HubSpot search.
 * The orchestrator iterates these per lead, skipping entries whose
 * `roleFilter` doesn't match the lead's roles (PI only).
 */
export interface QueryDef {
  /** Section key — used as stable identifier in rollup columns and HTML anchors */
  key: string;
  /** Section display label shown in the email */
  label: string;
  /** "ready" items appear first, "resubmit" items appear second within a section */
  subsections: "split" | "flat";
  /** HubSpot property to filter on */
  statusProperty: string;
  /** HubSpot property that identifies the assigned lead */
  roleProperty: string;
  /** Statuses for the "Ready to Submit" subsection */
  readyStatuses: string[];
  /** Statuses for the "Resubmissions Needed" subsection (empty = flat section) */
  resubmitStatuses?: string[];
  /** Section header color tokens */
  headerColor: { bg: string; border: string; text: string };
}

export interface SectionColorTokens {
  bg: string;
  border: string;
  text: string;
}

// ── Excluded Stages (terminal — skip from all queries) ─────────────────

export const EXCLUDED_STAGES = [
  "68229433",   // Cancelled (Project)
  "52474745",   // Cancelled (D&R)
  "56217769",   // Cancelled (Service)
  "20440343",   // Project Complete
  "68245827",   // Complete (D&R)
  "76979603",   // Completed (Service)
  "20440344",   // On Hold (Project)
  "72700977",   // On-hold (D&R)
  "1299090217", // New (Service) — no P&I/design work yet
];

// ── Included Pipelines ─────────────────────────────────────────────────

export const INCLUDED_PIPELINES = [
  "6900017",    // Project
  "21997330",   // D&R
  "23928924",   // Service
  "765928545",  // Roofing
];

/** Pipeline ID → suffix appended to stage name in emails */
export const PIPELINE_SUFFIXES: Record<string, string> = {
  "6900017": "",
  "21997330": " (D&R)",
  "23928924": " (Service)",
  "765928545": " (Roofing)",
};

// ── Manager ────────────────────────────────────────────────────────────

export const MANAGER_EMAIL = "zach@photonbrothers.com";

// ── P&I Lead Roster ────────────────────────────────────────────────────

export const PI_LEADS: PILead[] = [
  {
    name: "Peter Zaun",
    firstName: "Peter",
    email: "peter.zaun@photonbrothers.com",
    hubspotOwnerId: "78035785",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Kristofer Stuhff",
    firstName: "Kristofer",
    email: "kristofer.stuhff@photonbrothers.com",
    hubspotOwnerId: "82539445",
    roles: ["permit_tech"],
  },
  {
    name: "Katlyyn Arnoldi",
    firstName: "Kat",
    email: "kat@photonbrothers.com",
    hubspotOwnerId: "212300376",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Layla Counts",
    firstName: "Layla",
    email: "layla@photonbrothers.com",
    hubspotOwnerId: "216565308",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Alexis Severson",
    firstName: "Alexis",
    email: "alexis@photonbrothers.com",
    hubspotOwnerId: "212300959",
    roles: ["permit_tech", "interconnections_tech"],
  },
  {
    name: "Kaitlyn Martinez",
    firstName: "Kaitlyn",
    email: "kaitlyn@photonbrothers.com",
    hubspotOwnerId: "212298628",
    roles: ["permit_tech", "interconnections_tech"],
  },
];

// ── Design Lead Roster ─────────────────────────────────────────────────

export const DESIGN_LEADS: DesignLead[] = [
  {
    name: "Jacob Campbell",
    firstName: "Jacob",
    email: "jacob.campbell@photonbrothers.com",
    hubspotOwnerId: "85273950",
  },
  {
    name: "Zach Rosen",
    firstName: "Zach",
    email: "zach@photonbrothers.com",
    hubspotOwnerId: "2068088473",
  },
  {
    name: "Daniel Kelly",
    firstName: "Dan",
    email: "dan@photonbrothers.com",
    hubspotOwnerId: "216569623",
  },
];

// ── P&I Query Definitions ──────────────────────────────────────────────
//
// Each definition drives one section in the P&I email.
// `roleProperty` determines which leads see this section.
// `readyStatuses` and `resubmitStatuses` become separate subsections.
//
// Adding a new status bucket = add one entry here. Nothing else changes.

export const PI_QUERY_DEFS: QueryDef[] = [
  {
    key: "permits",
    label: "Permits",
    subsections: "split",
    statusProperty: "permitting_status",
    roleProperty: "permit_tech",
    readyStatuses: [
      "Ready For Permitting",
      "Customer Signature Acquired",
      "Pending SolarApp",
      "Awaiting Utility Approval",
    ],
    resubmitStatuses: [
      "Returned from Design",
      "As-Built Ready To Resubmit",
    ],
    headerColor: { bg: "#eff6ff", border: "#2563eb", text: "#2563eb" },
  },
  {
    key: "interconnection",
    label: "Interconnection",
    subsections: "split",
    statusProperty: "interconnection_status",
    roleProperty: "interconnections_tech",
    readyStatuses: [
      "Ready for Interconnection",
      "Signature Acquired By Customer",
    ],
    resubmitStatuses: [
      "Revision Returned From Design",
    ],
    headerColor: { bg: "#f0fdf4", border: "#16a34a", text: "#16a34a" },
  },
  {
    key: "pto",
    label: "PTO",
    subsections: "split",
    statusProperty: "pto_status",
    roleProperty: "interconnections_tech",
    readyStatuses: [
      "Inspection Passed - Ready for Utility",
      "Xcel Photos Ready to Submit",
    ],
    resubmitStatuses: [
      "Inspection Rejected By Utility",
      "Ops Related PTO Rejection",
      "XCEL Photos Rejected",
      "Xcel Photos Ready to Resubmit",
    ],
    headerColor: { bg: "#fefce8", border: "#ca8a04", text: "#ca8a04" },
  },
];

// ── Design Query Definitions ───────────────────────────────────────────

export const DESIGN_QUERY_DEFS: QueryDef[] = [
  {
    key: "da-ready",
    label: "DA Ready to Send",
    subsections: "flat",
    statusProperty: "layout_status",
    roleProperty: "design",
    readyStatuses: [
      "Draft Created",
      "Ready",                        // raw HS value → display "Review In Progress"
      "Revision Returned From Design", // → display "DA Revision Ready To Send"
    ],
    headerColor: { bg: "#eff6ff", border: "#1d4ed8", text: "#1d4ed8" },
  },
  {
    key: "design-review",
    label: "Design Ready to Review",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "Initial Review",
      "Ready for Review",
      "DA Approved",
      "Revision Initial Review",
      "Revision Final Review",
    ],
    headerColor: { bg: "#f0fdf4", border: "#15803d", text: "#15803d" },
  },
  {
    key: "revisions-needed",
    label: "Revisions Needed",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "Revision Needed - DA Rejected",
      "Revision Needed - Rejected by AHJ",
      "Revision Needed - Rejected by Utility",
      "Revision Needed - Rejected",
    ],
    headerColor: { bg: "#fef2f2", border: "#b91c1c", text: "#b91c1c" },
  },
  {
    key: "revisions-in-progress",
    label: "Revisions In Progress",
    subsections: "flat",
    statusProperty: "design_status",
    roleProperty: "design",
    readyStatuses: [
      "DA Revision In Progress",
      "Permit Revision In Progress",
      "Utility Revision In Progress",
      "As-Built Revision In Progress",
      "In Revision",
      "Revision In Engineering",
    ],
    headerColor: { bg: "#fffbeb", border: "#b45309", text: "#b45309" },
  },
];
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- --testPathPattern daily-focus-config --no-coverage`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```
git add src/lib/daily-focus/config.ts src/__tests__/lib/daily-focus-config.test.ts
git commit -m "feat(daily-focus): add data-driven config module with lead rosters and query definitions"
```

---

### Task 2: Format Module

**Files:**
- Create: `src/lib/daily-focus/format.ts`
- Test: `src/__tests__/lib/daily-focus-format.test.ts`
- Reference: `src/lib/pi-statuses.ts` (display name maps — reuse functions directly)
- Reference: `src/lib/deals-pipeline.ts` (`getStageMaps`, `PIPELINE_IDS`)
- Reference: `src/lib/external-links.ts` (`getHubSpotDealUrl`)

- [ ] **Step 1: Write the format test**

```typescript
// src/__tests__/lib/daily-focus-format.test.ts
import {
  trimDealName,
  getStatusDisplayName,
  sortDealRows,
} from "@/lib/daily-focus/format";

describe("trimDealName", () => {
  test("strips address from standard project deal", () => {
    expect(trimDealName("PROJ-9502 | McCammon, ROY | 4743 Mosca Pl, CO 81019"))
      .toBe("PROJ-9502 | McCammon, ROY");
  });

  test("keeps 3 segments for D&R deals", () => {
    expect(trimDealName("D&R | PROJ-5736 | Goltz, James | 123 Main St, CO"))
      .toBe("D&R | PROJ-5736 | Goltz, James");
  });

  test("keeps 3 segments for SVC deals", () => {
    expect(trimDealName("SVC | PROJ-8964 | McElheron | 456 Oak Ave"))
      .toBe("SVC | PROJ-8964 | McElheron");
  });

  test("returns full name when fewer segments", () => {
    expect(trimDealName("PROJ-1234 | Smith")).toBe("PROJ-1234 | Smith");
  });
});

describe("getStatusDisplayName", () => {
  test("maps permit display names", () => {
    expect(getStatusDisplayName("Returned from Design", "permitting_status"))
      .toBe("Revision Ready To Resubmit");
  });

  test("maps IC display names", () => {
    expect(getStatusDisplayName("Signature Acquired By Customer", "interconnection_status"))
      .toBe("Ready To Submit");
  });

  test("maps PTO display names", () => {
    expect(getStatusDisplayName("Inspection Passed - Ready for Utility", "pto_status"))
      .toBe("Inspection Passed - Ready for PTO Submission");
  });

  test("maps DA layout_status 'Ready'", () => {
    expect(getStatusDisplayName("Ready", "layout_status"))
      .toBe("Review In Progress");
  });

  test("maps design_status 'DA Approved'", () => {
    expect(getStatusDisplayName("DA Approved", "design_status"))
      .toBe("Final Design Review");
  });

  test("passes through unmapped statuses", () => {
    expect(getStatusDisplayName("Some New Status", "permitting_status"))
      .toBe("Some New Status");
  });
});

describe("sortDealRows", () => {
  test("sorts by PROJ number ascending", () => {
    const rows = [
      { dealname: "PROJ-200 | B" },
      { dealname: "PROJ-50 | A" },
      { dealname: "PROJ-1000 | C" },
    ];
    const sorted = sortDealRows(rows as any);
    expect(sorted.map(r => r.dealname)).toEqual([
      "PROJ-50 | A",
      "PROJ-200 | B",
      "PROJ-1000 | C",
    ]);
  });

  test("non-PROJ deals sort alphabetically after PROJ deals", () => {
    const rows = [
      { dealname: "Zebra Corp" },
      { dealname: "PROJ-100 | Smith" },
      { dealname: "Alpha LLC" },
    ];
    const sorted = sortDealRows(rows as any);
    expect(sorted.map(r => r.dealname)).toEqual([
      "PROJ-100 | Smith",
      "Alpha LLC",
      "Zebra Corp",
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- --testPathPattern daily-focus-format --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write format.ts**

```typescript
// src/lib/daily-focus/format.ts
import {
  getPermitStatusDisplayName,
  getICStatusDisplayName,
  getPTOStatusDisplayName,
} from "@/lib/pi-statuses";
import { getStageMaps, PIPELINE_IDS } from "@/lib/deals-pipeline";
import { getHubSpotDealUrl } from "@/lib/external-links";
import { PIPELINE_SUFFIXES } from "./config";

// ── Deal name trimming ─────────────────────────────────────────────────

const PREFIX_PATTERNS = ["D&R", "SVC", "RESI"];

/**
 * Strip the address segment from a deal name.
 * Standard deals keep first 2 pipe-segments: "PROJ-9502 | McCammon, ROY"
 * Prefixed deals (D&R, SVC) keep first 3: "D&R | PROJ-5736 | Goltz, James"
 */
export function trimDealName(dealname: string): string {
  const segments = dealname.split(" | ");
  if (segments.length <= 2) return dealname;

  const hasPipelinePrefix = PREFIX_PATTERNS.some(
    (p) => segments[0].trim().toUpperCase() === p
  );
  const keepCount = hasPipelinePrefix ? 3 : 2;
  return segments.slice(0, keepCount).join(" | ");
}

// ── Status display names ───────────────────────────────────────────────

const LAYOUT_STATUS_DISPLAY: Record<string, string> = {
  Ready: "Review In Progress",
  "Revision Returned From Design": "DA Revision Ready To Send",
};

const DESIGN_STATUS_DISPLAY: Record<string, string> = {
  "Initial Review": "Initial Design Review",
  "Ready for Review": "Final Review/Stamping",
  "DA Approved": "Final Design Review",
  "Revision Final Review": "Revision Final Review/Stamping",
  "Revision Needed - Rejected": "Revision Needed - As-Built",
  "In Revision": "Revision In Progress",
};

/**
 * Get display-friendly status name for any status property.
 * Reuses pi-statuses.ts functions for permit/IC/PTO.
 * Adds layout_status and design_status maps for design emails.
 */
export function getStatusDisplayName(
  rawStatus: string,
  statusProperty: string
): string {
  switch (statusProperty) {
    case "permitting_status":
      return getPermitStatusDisplayName(rawStatus);
    case "interconnection_status":
      return getICStatusDisplayName(rawStatus);
    case "pto_status":
      return getPTOStatusDisplayName(rawStatus);
    case "layout_status":
      return LAYOUT_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    case "design_status":
      return DESIGN_STATUS_DISPLAY[rawStatus] ?? rawStatus;
    default:
      return rawStatus;
  }
}

// ── Stage resolution ───────────────────────────────────────────────────

/**
 * Build a flat stageId → display label map from getStageMaps().
 * Appends pipeline suffix: " (D&R)", " (Service)", " (Roofing)".
 * Project pipeline has no suffix.
 */
export async function buildStageDisplayMap(): Promise<Record<string, string>> {
  const stageMaps = await getStageMaps();
  const flat: Record<string, string> = {};

  for (const [pipelineKey, stages] of Object.entries(stageMaps)) {
    // Find the pipeline ID for this key
    const pipelineId = PIPELINE_IDS[pipelineKey];
    const suffix = pipelineId ? (PIPELINE_SUFFIXES[pipelineId] ?? "") : "";

    for (const [stageId, stageName] of Object.entries(stages)) {
      flat[stageId] = stageName + suffix;
    }
  }

  return flat;
}

// ── Deal URL (re-export for convenience) ───────────────────────────────

export { getHubSpotDealUrl } from "@/lib/external-links";

// ── Sort ───────────────────────────────────────────────────────────────

const PROJ_RE = /PROJ-(\d+)/;

/**
 * Sort deals: PROJ-numbered deals first by number ascending,
 * then non-PROJ deals alphabetically.
 */
export function sortDealRows<T extends { dealname: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aMatch = PROJ_RE.exec(a.dealname);
    const bMatch = PROJ_RE.exec(b.dealname);

    if (aMatch && bMatch) {
      return Number(aMatch[1]) - Number(bMatch[1]);
    }
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return a.dealname.localeCompare(b.dealname);
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- --testPathPattern daily-focus-format --no-coverage`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```
git add src/lib/daily-focus/format.ts src/__tests__/lib/daily-focus-format.test.ts
git commit -m "feat(daily-focus): add format module with display names, deal trimming, stage resolution"
```

---

### Task 3: Queries Module

**Files:**
- Create: `src/lib/daily-focus/queries.ts`
- Reference: `src/lib/hubspot.ts` (`searchWithRetry`, `hubspotClient`)

- [ ] **Step 1: Write queries.ts**

This module is the generic HubSpot query executor. It consumes `QueryDef` objects
and returns typed results. No unit test — this wraps HubSpot API calls that
require integration testing. Validated by dry-run instead.

```typescript
// src/lib/daily-focus/queries.ts
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import type { QueryDef } from "./config";
import { EXCLUDED_STAGES, INCLUDED_PIPELINES } from "./config";

// ── Types ──────────────────────────────────────────────────────────────

export interface DealRow {
  dealId: string;
  dealname: string;
  dealstage: string;
  pipeline: string;
  statusValue: string;    // raw HubSpot status value
  statusProperty: string; // which property this came from
  subsection: "ready" | "resubmit";
}

export interface SectionResult {
  key: string;
  label: string;
  headerColor: { bg: string; border: string; text: string };
  ready: DealRow[];
  resubmit: DealRow[];
  total: number;
  error?: string;
}

// ── Query execution ────────────────────────────────────────────────────

/** Properties fetched for every deal */
const QUERY_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "dealstage",
  "pipeline",
  "permitting_status",
  "interconnection_status",
  "pto_status",
  "design_status",
  "layout_status",
];

/**
 * Run a single HubSpot search for one QueryDef + one lead.
 * Returns deals matching any of the def's statuses, excluding terminal stages.
 *
 * HubSpot search filter logic:
 * - Filters within a filterGroup are AND'd
 * - Separate filterGroups are OR'd
 *
 * We need: (owner = X) AND (status IN [...]) AND (stage NOT_IN [...]) AND (pipeline IN [...])
 * All conditions are AND, so they go in one filterGroup.
 *
 * NOTE on IN/NOT_IN: The HubSpot SDK Filter type uses `values` (string[]) for
 * IN/NOT_IN operators and `value` (string) for EQ/NEQ. Verify the actual SDK
 * version in package.json matches this expectation. If the SDK uses a different
 * field name, adjust accordingly.
 */
async function runQuery(
  def: QueryDef,
  ownerId: string,
  statuses: string[],
  subsectionLabel: "ready" | "resubmit"
): Promise<{ rows: DealRow[]; error?: string }> {
  if (statuses.length === 0) return { rows: [] };

  try {
    const rows: DealRow[] = [];
    let after: string | undefined;

    // Paginate — HubSpot max 200 per request
    do {
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: def.roleProperty,
                operator: FilterOperatorEnum.Eq,
                value: ownerId,
              },
              {
                propertyName: def.statusProperty,
                operator: FilterOperatorEnum.In,
                values: statuses,
              },
              {
                propertyName: "dealstage",
                operator: FilterOperatorEnum.NotIn,
                values: EXCLUDED_STAGES,
              },
              {
                propertyName: "pipeline",
                operator: FilterOperatorEnum.In,
                values: INCLUDED_PIPELINES,
              },
            ],
          },
        ],
        properties: QUERY_PROPERTIES,
        limit: 200,
        ...(after ? { after } : {}),
      });

      for (const deal of response.results ?? []) {
        rows.push({
          dealId: deal.properties.hs_object_id ?? deal.id,
          dealname: deal.properties.dealname ?? "",
          dealstage: deal.properties.dealstage ?? "",
          pipeline: deal.properties.pipeline ?? "",
          statusValue: deal.properties[def.statusProperty] ?? "",
          statusProperty: def.statusProperty,
          subsection: subsectionLabel,
        });
      }

      after = response.paging?.next?.after;
    } while (after);

    return { rows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[daily-focus] Query failed: ${def.key} for owner ${ownerId}: ${msg}`);
    return { rows: [], error: msg };
  }
}

/**
 * Execute all queries for a single QueryDef + lead.
 * Runs "ready" and "resubmit" status groups as separate searches,
 * then combines into one SectionResult.
 */
export async function querySection(
  def: QueryDef,
  ownerId: string
): Promise<SectionResult> {
  const [readyResult, resubResult] = await Promise.all([
    runQuery(def, ownerId, def.readyStatuses, "ready"),
    runQuery(def, ownerId, def.resubmitStatuses ?? [], "resubmit"),
  ]);

  const error = readyResult.error || resubResult.error
    ? [readyResult.error, resubResult.error].filter(Boolean).join("; ")
    : undefined;

  return {
    key: def.key,
    label: def.label,
    headerColor: def.headerColor,
    ready: readyResult.rows,
    resubmit: resubResult.rows,
    total: readyResult.rows.length + resubResult.rows.length,
    error,
  };
}

/**
 * Execute all query definitions for a single lead.
 * For PI leads: skips defs whose roleProperty doesn't match the lead's roles.
 */
export async function queryAllSections(
  defs: QueryDef[],
  ownerId: string,
  leadRoles?: string[]
): Promise<SectionResult[]> {
  const results: SectionResult[] = [];

  // Sequential to respect HubSpot rate limits (searchWithRetry handles 429s
  // but sequential reduces the chance of hitting them)
  for (const def of defs) {
    // Skip if lead doesn't have the required role (PI leads only)
    if (leadRoles && !leadRoles.includes(def.roleProperty)) {
      continue;
    }
    results.push(await querySection(def, ownerId));
  }

  return results;
}
```

- [ ] **Step 2: Commit**

```
git add src/lib/daily-focus/queries.ts
git commit -m "feat(daily-focus): add generic HubSpot query executor with pagination and rate-limit awareness"
```

---

## Chunk 2: Presentation Layer (HTML + Send + Route)

### Task 4: HTML Builder

**Files:**
- Create: `src/lib/daily-focus/html.ts`
- Test: `src/__tests__/lib/daily-focus-html.test.ts`

- [ ] **Step 1: Write the HTML test**

```typescript
// src/__tests__/lib/daily-focus-html.test.ts
import {
  renderStatusPill,
  renderSectionHeader,
  renderDealRow,
  renderEmailWrapper,
} from "@/lib/daily-focus/html";

describe("renderStatusPill", () => {
  test("renders permit ready status with green pill", () => {
    const html = renderStatusPill("Ready For Permitting", "permitting_status");
    expect(html).toContain("Ready For Permitting");
    expect(html).toContain("background:#dcfce7");
  });

  test("renders resubmit status with amber pill", () => {
    const html = renderStatusPill("Returned from Design", "permitting_status", "pi", "resubmit");
    expect(html).toContain("Revision Ready To Resubmit"); // display name
    expect(html).toContain("background:#fef3c7");
  });

  test("renders design revision needed with red pill", () => {
    const html = renderStatusPill("Revision Needed - DA Rejected", "design_status", "design");
    expect(html).toContain("Revision Needed - DA Rejected");
    expect(html).toContain("background:#fee2e2");
  });
});

describe("renderSectionHeader", () => {
  test("renders header bar with correct colors", () => {
    const html = renderSectionHeader("Permits", 5, {
      bg: "#eff6ff",
      border: "#2563eb",
      text: "#2563eb",
    });
    expect(html).toContain("PERMITS");
    expect(html).toContain("(5)");
    expect(html).toContain("background:#eff6ff");
    expect(html).toContain("border-left:3px solid #2563eb");
  });
});

describe("renderDealRow", () => {
  test("renders deal name as hyperlink", () => {
    const html = renderDealRow({
      dealId: "12345",
      dealname: "PROJ-100 | Smith, John | 123 Main St",
      stageName: "Design & Engineering",
      statusDisplay: "Ready For Permitting",
      statusPillHtml: "<span>pill</span>",
      isAlternate: false,
    });
    expect(html).toContain("PROJ-100 | Smith, John");
    expect(html).not.toContain("123 Main St");
    expect(html).toContain("/record/0-3/12345");
    expect(html).toContain("Design &amp; Engineering");
  });
});

describe("renderEmailWrapper", () => {
  test("wraps body in standard email HTML", () => {
    const html = renderEmailWrapper("Test Content");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Content");
    expect(html).toContain("max-width:640px");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- --testPathPattern daily-focus-html --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write html.ts**

```typescript
// src/lib/daily-focus/html.ts
import { getHubSpotDealUrl } from "@/lib/external-links";
import { trimDealName, getStatusDisplayName, sortDealRows } from "./format";
import type { SectionResult, DealRow } from "./queries";

// ── Pill color classification ──────────────────────────────────────────

type PillColor = { bg: string; text: string };

/** P&I pill colors by subsection */
const PI_PILL_COLORS: Record<string, PillColor> = {
  ready: { bg: "#dcfce7", text: "#166534" },
  resubmit: { bg: "#fef3c7", text: "#92400e" },
};

/**
 * Design pill colors — keyed by raw status prefix or exact match.
 * Falls back to a default if no match.
 */
function getDesignPillColor(rawStatus: string, statusProperty: string): PillColor {
  if (statusProperty === "layout_status") {
    if (rawStatus === "Ready") return { bg: "#dbeafe", text: "#1d4ed8" };
    if (rawStatus === "Draft Created") return { bg: "#f3f4f6", text: "#6b7280" };
    if (rawStatus === "Revision Returned From Design") return { bg: "#ede9fe", text: "#6d28d9" };
    return { bg: "#f3f4f6", text: "#6b7280" };
  }
  // design_status
  if (rawStatus.startsWith("Revision Needed")) return { bg: "#fee2e2", text: "#b91c1c" };
  if (rawStatus.includes("Revision In Progress") || rawStatus === "In Revision" || rawStatus === "Revision In Engineering")
    return { bg: "#fef9c3", text: "#854d0e" };
  if (rawStatus === "Initial Review" || rawStatus === "Revision Initial Review")
    return { bg: "#ffedd5", text: "#c2410c" };
  if (rawStatus === "DA Approved") return { bg: "#dcfce7", text: "#15803d" };
  if (rawStatus === "Ready for Review" || rawStatus === "Revision Final Review")
    return { bg: "#ccfbf1", text: "#0f766e" };
  return { bg: "#f3f4f6", text: "#6b7280" };
}

function getPillColor(row: DealRow, emailType: "pi" | "design"): PillColor {
  if (emailType === "pi") {
    return PI_PILL_COLORS[row.subsection] ?? PI_PILL_COLORS.ready;
  }
  return getDesignPillColor(row.statusValue, row.statusProperty);
}

// ── Render primitives ──────────────────────────────────────────────────

const PILL_BASE = "padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700;display:inline-block;";

export function renderStatusPill(
  rawStatus: string,
  statusProperty: string,
  emailType: "pi" | "design" = "pi",
  subsection: "ready" | "resubmit" = "ready"
): string {
  const display = getStatusDisplayName(rawStatus, statusProperty);
  const dummyRow: DealRow = {
    dealId: "",
    dealname: "",
    dealstage: "",
    pipeline: "",
    statusValue: rawStatus,
    statusProperty,
    subsection,
  };
  const color = getPillColor(dummyRow, emailType);
  return `<span style="${PILL_BASE}background:${color.bg};color:${color.text};">${display}</span>`;
}

/** Escape HTML entities in user-facing text */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSectionHeader(
  label: string,
  count: number,
  color: { bg: string; border: string; text: string },
  sublabel?: string
): string {
  const headerStyle = `padding:5px 10px;margin:16px 0 4px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;background:${color.bg};border-left:3px solid ${color.border};color:${color.text};`;
  const sub = sublabel ? ` — ${sublabel}` : "";
  return `<div style="${headerStyle}">${escapeHtml(label.toUpperCase())}${sub} (${count})</div>`;
}

export function renderDealRow(opts: {
  dealId: string;
  dealname: string;
  stageName: string;
  statusDisplay: string;
  statusPillHtml: string;
  isAlternate: boolean;
  crossSectionTag?: string;
}): string {
  const bg = opts.isAlternate ? "#f9fafb" : "#ffffff";
  const rowStyle = `padding:5px 8px;border-bottom:1px solid #f0f0f0;background:${bg};`;
  const nameStyle = "font-size:12px;font-weight:700;color:#1e40af;text-decoration:none;";
  const stageStyle = "font-size:11px;color:#9ca3af;";
  const tagHtml = opts.crossSectionTag ?? "";
  const url = getHubSpotDealUrl(opts.dealId);
  const displayName = trimDealName(opts.dealname);

  return `<div style="${rowStyle}"><a href="${url}" style="${nameStyle}">${escapeHtml(displayName)}</a> ${tagHtml}<span style="${stageStyle}">${escapeHtml(opts.stageName)}</span> · ${opts.statusPillHtml}</div>`;
}

export function renderCrossSectionTag(text: string): string {
  return `<span style="font-size:10px;color:#5b21b6;background:#ede9fe;padding:1px 6px;border-radius:8px;margin-left:3px;font-weight:600;">${escapeHtml(text)}</span> `;
}

export function renderEmailWrapper(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:16px;">
<div style="background:#ffffff;border-radius:8px;padding:20px;border:1px solid #e4e4e7;">
${bodyHtml}
</div>
<div style="text-align:center;padding:12px 0;font-size:10px;color:#a1a1aa;">
PB Tech Ops Suite · Daily Focus Email
</div>
</div>
</body>
</html>`;
}

// ── Build section HTML ─────────────────────────────────────────────────

/**
 * Build HTML for one section (e.g., "Permits") including header and rows.
 * For "split" subsections: renders "Ready to Submit" and "Resubmissions Needed"
 * as separate sub-headers within the section.
 */
export function buildSectionHtml(
  section: SectionResult,
  stageMap: Record<string, string>,
  emailType: "pi" | "design",
  crossSectionDealIds?: Map<string, string>
): string {
  if (section.total === 0) return "";

  const parts: string[] = [];

  const renderRows = (rows: DealRow[], subsectionLabel: string | null) => {
    const sorted = sortDealRows(rows);
    if (sorted.length === 0) return;

    if (subsectionLabel) {
      parts.push(`<div style="padding:3px 10px;font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;margin-top:8px;">${subsectionLabel} (${sorted.length})</div>`);
    }

    sorted.forEach((row, i) => {
      const stageName = stageMap[row.dealstage] ?? row.dealstage;
      const displayStatus = getStatusDisplayName(row.statusValue, row.statusProperty);
      const color = getPillColor(row, emailType);
      const pillHtml = `<span style="${PILL_BASE}background:${color.bg};color:${color.text};">${escapeHtml(displayStatus)}</span>`;
      const tag = crossSectionDealIds?.has(row.dealId)
        ? renderCrossSectionTag(crossSectionDealIds.get(row.dealId)!)
        : undefined;

      parts.push(
        renderDealRow({
          dealId: row.dealId,
          dealname: row.dealname,
          stageName,
          statusDisplay: displayStatus,
          statusPillHtml: pillHtml,
          isAlternate: i % 2 === 1,
          crossSectionTag: tag,
        })
      );
    });
  };

  // Section header (total count)
  parts.push(renderSectionHeader(section.label, section.total, section.headerColor));

  if (section.ready.length > 0 && section.resubmit.length > 0) {
    // Split subsections
    renderRows(section.ready, "Ready to Submit");
    renderRows(section.resubmit, "Resubmissions Needed");
  } else {
    // Flat — one set of rows, no subsection label
    renderRows([...section.ready, ...section.resubmit], null);
  }

  return parts.join("\n");
}

// ── Individual email ───────────────────────────────────────────────────

export function buildIndividualEmail(
  firstName: string,
  sections: SectionResult[],
  stageMap: Record<string, string>,
  emailType: "pi" | "design"
): string {
  const grandTotal = sections.reduce((sum, s) => sum + s.total, 0);
  if (grandTotal === 0) return "";

  // Cross-section tags: find deals appearing in multiple sections
  const crossMap = buildCrossSectionMap(sections);

  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 12px;font-size:14px;">Good morning ${escapeHtml(firstName)},</p>`);
  parts.push(`<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Here's what's ready for action today:</p>`);

  for (const section of sections) {
    const sectionHtml = buildSectionHtml(section, stageMap, emailType, crossMap.get(section.key));
    if (sectionHtml) parts.push(sectionHtml);
  }

  parts.push(`<hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0;">`);
  parts.push(`<p style="margin:0;font-size:12px;font-weight:700;color:#3f3f46;">Total action items: ${grandTotal}</p>`);

  return renderEmailWrapper(parts.join("\n"));
}

// ── Rollup email ───────────────────────────────────────────────────────

interface LeadSummary {
  name: string;
  sections: SectionResult[];
  grandTotal: number;
}

export function buildRollupEmail(
  leads: LeadSummary[],
  allDefs: { key: string; label: string }[],
  stageMap: Record<string, string>,
  emailType: "pi" | "design"
): string {
  const sortedLeads = [...leads].sort((a, b) => b.grandTotal - a.grandTotal);
  const teamTotal = sortedLeads.reduce((s, l) => s + l.grandTotal, 0);

  const parts: string[] = [];

  // ── Summary table ──
  parts.push(`<p style="margin:0 0 12px;font-size:14px;font-weight:700;">TEAM SUMMARY</p>`);
  const headerRow = allDefs.map((d) => `<th style="padding:6px 8px;text-align:right;font-size:11px;">${escapeHtml(d.label)}</th>`).join("");
  parts.push(`<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">`);
  parts.push(`<tr style="background:#1e293b;color:#fff;"><th style="padding:6px 8px;text-align:left;font-size:11px;">Name</th>${headerRow}<th style="padding:6px 8px;text-align:right;font-size:11px;">Total</th></tr>`);

  for (const lead of sortedLeads) {
    const cells = allDefs
      .map((d) => {
        const sec = lead.sections.find((s) => s.key === d.key);
        const val = sec?.total ?? 0;
        return `<td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0;">${val || "\u2014"}</td>`;
      })
      .join("");
    parts.push(`<tr><td style="padding:4px 8px;font-weight:600;border-bottom:1px solid #f0f0f0;">${escapeHtml(lead.name)}</td>${cells}<td style="padding:4px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0;">${lead.grandTotal}</td></tr>`);
  }

  // Team total row
  const totalCells = allDefs
    .map((d) => {
      const colTotal = sortedLeads.reduce((s, l) => {
        const sec = l.sections.find((s2) => s2.key === d.key);
        return s + (sec?.total ?? 0);
      }, 0);
      return `<td style="padding:4px 8px;text-align:right;font-weight:700;border-top:2px solid #1e293b;">${colTotal}</td>`;
    })
    .join("");
  parts.push(`<tr style="background:#f8fafc;"><td style="padding:4px 8px;font-weight:700;border-top:2px solid #1e293b;">TEAM TOTAL</td>${totalCells}<td style="padding:4px 8px;text-align:right;font-weight:700;border-top:2px solid #1e293b;">${teamTotal}</td></tr>`);
  parts.push(`</table>`);

  // ── Detail by lead ──
  parts.push(`<p style="margin:20px 0 12px;font-size:14px;font-weight:700;">FULL DETAIL BY LEAD</p>`);

  for (const lead of sortedLeads) {
    if (lead.grandTotal === 0) continue;
    parts.push(`<div style="margin:16px 0 4px;padding:6px 10px;background:#f8fafc;border-radius:4px;font-size:13px;font-weight:700;">${escapeHtml(lead.name)} <span style="font-weight:400;color:#6b7280;">(${lead.grandTotal} items)</span></div>`);

    const crossMap = buildCrossSectionMap(lead.sections);
    for (const section of lead.sections) {
      const sectionHtml = buildSectionHtml(section, stageMap, emailType, crossMap.get(section.key));
      if (sectionHtml) parts.push(sectionHtml);
    }
  }

  return renderEmailWrapper(parts.join("\n"));
}

// ── Cross-section tag builder ──────────────────────────────────────────

/**
 * Build a map of dealId → tag text for deals that appear in multiple sections.
 * Returns: Map<sectionKey, Map<dealId, tagText>>
 *
 * Example: if deal 12345 appears in both "permits" and "interconnection" sections,
 * the permits map entry gets "↓ IC" and the interconnection entry gets "↑ Permits".
 */
function buildCrossSectionMap(
  sections: SectionResult[]
): Map<string, Map<string, string>> {
  // dealId → list of section keys it appears in
  const dealSections = new Map<string, string[]>();

  for (const section of sections) {
    for (const row of [...section.ready, ...section.resubmit]) {
      const existing = dealSections.get(row.dealId) ?? [];
      if (!existing.includes(section.key)) {
        existing.push(section.key);
        dealSections.set(row.dealId, existing);
      }
    }
  }

  // Build per-section tag maps
  const result = new Map<string, Map<string, string>>();
  const sectionLabels = new Map(sections.map((s) => [s.key, s.label]));

  for (const [dealId, sectionKeys] of dealSections) {
    if (sectionKeys.length < 2) continue;

    for (let i = 0; i < sectionKeys.length; i++) {
      const thisKey = sectionKeys[i];
      const otherLabels = sectionKeys
        .filter((k) => k !== thisKey)
        .map((k) => sectionLabels.get(k) ?? k);

      if (!result.has(thisKey)) result.set(thisKey, new Map());
      const direction = i === 0 ? "\u2193" : "\u2191";
      result.get(thisKey)!.set(dealId, `${direction} also in ${otherLabels.join(", ")}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- --testPathPattern daily-focus-html --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add src/lib/daily-focus/html.ts src/__tests__/lib/daily-focus-html.test.ts
git commit -m "feat(daily-focus): add HTML email builder with pills, sections, cross-tags, and rollup"
```

---

### Task 5: Send Orchestrator

**Files:**
- Create: `src/lib/daily-focus/send.ts`
- Reference: `src/lib/email.ts` (`sendEmailMessage`)
- Reference: `src/lib/audit/alerts.ts` (`sendCronHealthAlert`)

- [ ] **Step 1: Write send.ts**

```typescript
// src/lib/daily-focus/send.ts
import { sendEmailMessage } from "@/lib/email";
import {
  PI_LEADS,
  DESIGN_LEADS,
  PI_QUERY_DEFS,
  DESIGN_QUERY_DEFS,
  MANAGER_EMAIL,
  type QueryDef,
} from "./config";
import { queryAllSections, type SectionResult } from "./queries";
import { buildStageDisplayMap } from "./format";
import { buildIndividualEmail, buildRollupEmail } from "./html";

// ── Types ──────────────────────────────────────────────────────────────

export interface DailyFocusResult {
  type: "pi" | "design";
  emailsSent: number;
  rollupSent: boolean;
  totalItems: number;
  errors: string[];
  leadSummaries: { name: string; total: number }[];
}

interface SendOptions {
  /** When true, all emails go to MANAGER_EMAIL only. Subject gets [DRY RUN] prefix. */
  dryRun: boolean;
}

// ── Date formatting ────────────────────────────────────────────────────

function formatDateForSubject(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  });
}

// ── Individual email send ──────────────────────────────────────────────

async function sendIndividualEmail(opts: {
  to: string;
  firstName: string;
  sections: SectionResult[];
  stageMap: Record<string, string>;
  emailType: "pi" | "design";
  dryRun: boolean;
}): Promise<{ sent: boolean; error?: string }> {
  const grandTotal = opts.sections.reduce((s, sec) => s + sec.total, 0);
  if (grandTotal === 0) return { sent: false };

  const html = buildIndividualEmail(
    opts.firstName,
    opts.sections,
    opts.stageMap,
    opts.emailType
  );
  if (!html) return { sent: false };

  const typeLabel = opts.emailType === "pi" ? "P&I" : "Design";
  const dateStr = formatDateForSubject();
  const subjectPrefix = opts.dryRun ? "[DRY RUN] " : "";
  const subject = `${subjectPrefix}${typeLabel} Daily Focus \u2014 ${dateStr}`;

  // In dry-run mode, prepend a banner showing intended recipient
  let finalHtml = html;
  if (opts.dryRun) {
    const banner = `<div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:12px;"><strong>DRY RUN</strong> \u2014 This would have been sent to: <strong>${opts.to}</strong></div>`;
    finalHtml = html.replace(
      `Here's what's ready for action today:</p>`,
      `Here's what's ready for action today:</p>\n${banner}`
    );
  }

  const actualTo = opts.dryRun ? MANAGER_EMAIL : opts.to;
  const bcc = opts.dryRun ? [] : [MANAGER_EMAIL];

  const result = await sendEmailMessage({
    to: actualTo,
    bcc,
    subject,
    html: finalHtml,
    text: `${typeLabel} Daily Focus \u2014 ${dateStr}. ${grandTotal} action items. View in email client for details.`,
    debugFallbackTitle: subject,
    debugFallbackBody: `${grandTotal} action items for ${opts.firstName}`,
  });

  return { sent: result.success, error: result.error };
}

// ── Rollup send ────────────────────────────────────────────────────────

async function sendRollupEmail(opts: {
  leads: { name: string; sections: SectionResult[]; grandTotal: number }[];
  defs: QueryDef[];
  stageMap: Record<string, string>;
  emailType: "pi" | "design";
  dryRun: boolean;
}): Promise<{ sent: boolean; error?: string }> {
  const typeLabel = opts.emailType === "pi" ? "P&I" : "Design";
  const dateStr = formatDateForSubject();
  const subjectPrefix = opts.dryRun ? "[DRY RUN] " : "";
  const subject = `${subjectPrefix}${typeLabel} Daily Rollup \u2014 ${dateStr}`;

  const teamTotal = opts.leads.reduce((s, l) => s + l.grandTotal, 0);

  // "All clear" only if every query succeeded AND total items are zero
  const allQueriesSucceeded = opts.leads.every((l) =>
    l.sections.every((s) => !s.error)
  );

  let html: string;
  if (teamTotal === 0 && allQueriesSucceeded) {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,sans-serif;padding:20px;">
      <p>All clear \u2014 no pending ${typeLabel} actions today.</p>
    </body></html>`;
  } else {
    html = buildRollupEmail(
      opts.leads,
      opts.defs.map((d) => ({ key: d.key, label: d.label })),
      opts.stageMap,
      opts.emailType
    );

    // Append error notes if any queries failed
    const failedSections = opts.leads.flatMap((l) =>
      l.sections.filter((s) => s.error).map((s) => `${l.name} / ${s.label}: ${s.error}`)
    );
    if (failedSections.length > 0) {
      const errorBlock = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:8px 12px;margin-top:16px;font-size:11px;color:#991b1b;"><strong>Query errors:</strong><ul style="margin:4px 0 0;">${failedSections.map((e) => `<li>${e}</li>`).join("")}</ul></div>`;
      html = html.replace("</div>\n</body>", `${errorBlock}</div>\n</body>`);
    }
  }

  const result = await sendEmailMessage({
    to: MANAGER_EMAIL,
    subject,
    html,
    text: `${typeLabel} Daily Rollup \u2014 ${dateStr}. ${teamTotal} total action items across team.`,
    debugFallbackTitle: subject,
    debugFallbackBody: `${teamTotal} total items`,
  });

  return { sent: result.success, error: result.error };
}

// ── Main orchestrators ─────────────────────────────────────────────────

export async function runPIDailyFocus(options: SendOptions): Promise<DailyFocusResult> {
  const errors: string[] = [];
  const stageMap = await buildStageDisplayMap();
  let emailsSent = 0;

  const leadSummaries: { name: string; sections: SectionResult[]; grandTotal: number }[] = [];

  // Query sequentially to respect HubSpot rate limits
  for (const lead of PI_LEADS) {
    try {
      const sections = await queryAllSections(PI_QUERY_DEFS, lead.hubspotOwnerId, lead.roles);
      const grandTotal = sections.reduce((s, sec) => s + sec.total, 0);
      leadSummaries.push({ name: lead.name, sections, grandTotal });

      const result = await sendIndividualEmail({
        to: lead.email,
        firstName: lead.firstName,
        sections,
        stageMap,
        emailType: "pi",
        dryRun: options.dryRun,
      });
      if (result.sent) emailsSent++;
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${lead.name}: ${msg}`);
      leadSummaries.push({ name: lead.name, sections: [], grandTotal: 0 });
    }
  }

  // Send rollup
  const rollup = await sendRollupEmail({
    leads: leadSummaries,
    defs: PI_QUERY_DEFS,
    stageMap,
    emailType: "pi",
    dryRun: options.dryRun,
  });
  if (rollup.error) errors.push(`Rollup: ${rollup.error}`);

  return {
    type: "pi",
    emailsSent,
    rollupSent: rollup.sent,
    totalItems: leadSummaries.reduce((s, l) => s + l.grandTotal, 0),
    errors,
    leadSummaries: leadSummaries.map((l) => ({ name: l.name, total: l.grandTotal })),
  };
}

export async function runDesignDailyFocus(options: SendOptions): Promise<DailyFocusResult> {
  const errors: string[] = [];
  const stageMap = await buildStageDisplayMap();
  let emailsSent = 0;

  const leadSummaries: { name: string; sections: SectionResult[]; grandTotal: number }[] = [];

  for (const lead of DESIGN_LEADS) {
    try {
      const sections = await queryAllSections(DESIGN_QUERY_DEFS, lead.hubspotOwnerId);
      const grandTotal = sections.reduce((s, sec) => s + sec.total, 0);
      leadSummaries.push({ name: lead.name, sections, grandTotal });

      const result = await sendIndividualEmail({
        to: lead.email,
        firstName: lead.firstName,
        sections,
        stageMap,
        emailType: "design",
        dryRun: options.dryRun,
      });
      if (result.sent) emailsSent++;
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${lead.name}: ${msg}`);
      leadSummaries.push({ name: lead.name, sections: [], grandTotal: 0 });
    }
  }

  const rollup = await sendRollupEmail({
    leads: leadSummaries,
    defs: DESIGN_QUERY_DEFS,
    stageMap,
    emailType: "design",
    dryRun: options.dryRun,
  });
  if (rollup.error) errors.push(`Rollup: ${rollup.error}`);

  return {
    type: "design",
    emailsSent,
    rollupSent: rollup.sent,
    totalItems: leadSummaries.reduce((s, l) => s + l.grandTotal, 0),
    errors,
    leadSummaries: leadSummaries.map((l) => ({ name: l.name, total: l.grandTotal })),
  };
}
```

- [ ] **Step 2: Commit**

```
git add src/lib/daily-focus/send.ts
git commit -m "feat(daily-focus): add send orchestrator with individual emails, rollups, dry-run support"
```

---

### Task 6: Route Handler + Vercel Config

**Files:**
- Create: `src/app/api/cron/daily-focus/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write route.ts**

```typescript
// src/app/api/cron/daily-focus/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendCronHealthAlert } from "@/lib/audit/alerts";
import { runPIDailyFocus, runDesignDailyFocus } from "@/lib/daily-focus/send";

/**
 * GET /api/cron/daily-focus
 *
 * Vercel cron job — sends daily focus emails to P&I and Design leads.
 * Schedule: weekdays at 13:00 UTC (7:00 AM Mountain Daylight Time).
 * Note: During MST (Nov-Mar), 13:00 UTC = 6:00 AM Mountain. Acceptable.
 *
 * Protected by CRON_SECRET.
 *
 * Query params:
 *   ?dryRun=true  - send all emails to manager only, with [DRY RUN] prefix
 *   ?type=pi      - run P&I emails only
 *   ?type=design  - run Design emails only
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const typeFilter = url.searchParams.get("type"); // "pi" | "design" | null

  try {
    const results = [];

    if (!typeFilter || typeFilter === "pi") {
      results.push(await runPIDailyFocus({ dryRun }));
    }
    if (!typeFilter || typeFilter === "design") {
      results.push(await runDesignDailyFocus({ dryRun }));
    }

    const allErrors = results.flatMap((r) => r.errors);
    const totalSent = results.reduce((s, r) => s + r.emailsSent, 0);
    const totalItems = results.reduce((s, r) => s + r.totalItems, 0);

    return NextResponse.json({
      dryRun,
      emailsSent: totalSent,
      rollupsSent: results.filter((r) => r.rollupSent).length,
      totalItems,
      results: results.map((r) => ({
        type: r.type,
        emailsSent: r.emailsSent,
        rollupSent: r.rollupSent,
        totalItems: r.totalItems,
        leads: r.leadSummaries,
      })),
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await sendCronHealthAlert("daily-focus", message);
    } catch {
      // Best-effort
    }
    return NextResponse.json({ sent: false, reason: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add cron entry and maxDuration to vercel.json**

Add to the `"crons"` array:
```json
{
  "path": "/api/cron/daily-focus",
  "schedule": "0 13 * * 1-5"
}
```

Add to the `"functions"` object:
```json
"src/app/api/cron/daily-focus/route.ts": {
  "maxDuration": 120
}
```

> **Why 120s:** This job runs ~44 HubSpot searches (6 P&I leads x ~4 queries + 3 design leads x 4 queries, plus pagination). `searchWithRetry` can back off 1-9s per 429. 60s is too tight; 120s provides safety margin. Vercel Pro cron invocations support up to 300s, but 120s is sufficient.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build, no type errors

- [ ] **Step 4: Commit**

```
git add src/app/api/cron/daily-focus/route.ts vercel.json
git commit -m "feat(daily-focus): add cron route handler with dryRun/type params and vercel config"
```

---

### Task 7: Run All Tests + Lint

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --testPathPattern daily-focus --no-coverage`
Expected: All tests pass (config, format, html)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors in daily-focus files

- [ ] **Step 3: Run project-wide type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Final commit if any fixes were needed**

```
git add -A
git commit -m "fix(daily-focus): address lint and type issues"
```

---

### Task 8: Dry Run Verification

- [ ] **Step 1: Start dev server and trigger dry run**

Start the dev server, then in another terminal:
```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/daily-focus?dryRun=true"
```

Expected: JSON response showing emails sent, item counts per lead. All emails should arrive at zach@photonbrothers.com with `[DRY RUN]` subject prefix and intended-recipient banner.

- [ ] **Step 2: Verify P&I email only**

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/daily-focus?dryRun=true&type=pi"
```

- [ ] **Step 3: Verify Design email only**

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/daily-focus?dryRun=true&type=design"
```

- [ ] **Step 4: Review emails in inbox**

Check that:
1. Deal names are trimmed (no addresses)
2. Deal names are clickable links to HubSpot
3. Stage names resolve correctly (including D&R/Service/Roofing suffixes)
4. Status pills show correct colors and display names
5. Cross-section tags appear for deals in multiple sections
6. Rollup summary table has correct totals
7. Rollup detail section matches individual emails
8. Empty sections are skipped

---

## Implementation Notes

### HubSpot `IN` filter field name
The HubSpot SDK's `IN` and `NOT_IN` operators may use `values` (array) instead of `value` (string). Check the actual type at `@hubspot/api-client/lib/codegen/crm/deals` -- the `Filter` type may have both `value?: string` and `values?: string[]`. If the SDK doesn't support `values` directly, use `value` with a semicolon-separated string, or restructure as multiple `EQ` filterGroups OR'd together. Verify with existing codebase usage of `IN` filters.

### Rate limits
The job runs ~44 HubSpot searches. With `searchWithRetry`'s exponential backoff on 429s, worst case is ~5 retries x 9s backoff x 44 queries = ~33 minutes. This won't happen in practice (rate limits reset quickly), but the 120s maxDuration is a balance between normal execution (~15-30s) and occasional rate limit storms. If this becomes a problem, consider caching results in `appCache` or splitting P&I and Design into separate cron entries.

### Adding/removing leads
Edit `PI_LEADS` or `DESIGN_LEADS` arrays in `config.ts`. No other changes needed.

### Adding a new status bucket
Add one entry to `PI_QUERY_DEFS` or `DESIGN_QUERY_DEFS` in `config.ts`. The queries, HTML, and rollup table automatically pick it up.

### Disabling the scheduled task versions
After verifying the cron route works in production, disable the `pi-daily-focus` and `design-daily-focus` scheduled tasks in Claude Code to avoid duplicate emails.
