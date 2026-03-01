# Role-Based Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build three Claude Code skills (design-reviewer, engineering-reviewer, sales-advisor) that automate PB's sales-through-engineering workflows as task-driven execution engines within HubSpot automation.

**Architecture:** Each skill is a Claude Code skill (YAML frontmatter + markdown body) that reads HubSpot tasks, does the work, and completes tasks via the app's API. Skills invoke existing skills (product-lookup, planset-bom, find-design-plans) and use existing API routes (AHJ, Utility, deals) for data. New infrastructure: HubSpot Tasks API route + PandaDoc API integration.

**Tech Stack:** Next.js API routes, HubSpot SDK (`@hubspot/api-client`), PandaDoc REST API, existing skill framework (YAML frontmatter + markdown SKILL.md files)

**Design doc:** `docs/plans/2026-03-01-role-skills-design.md`

---

## Phase 0: Infrastructure (HubSpot Tasks API)

All three skills need to read and complete HubSpot tasks. This must be built first.

### Task 0.1: Discover HubSpot Task Schema

**Files:**
- Read: `src/lib/hubspot.ts` (existing client pattern)
- Read: `src/lib/hubspot-custom-objects.ts` (association pattern)

**Step 1: Query HubSpot for task properties**

Use the HubSpot MCP tools to discover the task object schema:
```
Search HubSpot CRM objects: objectType = "tasks"
Get properties: objectType = "tasks"
```

Document:
- Task property names (subject, status, priority, notes, associations)
- How tasks are associated with deals
- Task status values (COMPLETED, NOT_STARTED, IN_PROGRESS, etc.)
- Task type field (if tasks are categorized)

**Step 2: Find real tasks for a known deal**

Pick a deal in "Ready for Design" stage and query its associated tasks:
```
Search CRM objects: objectType = "tasks", filter by deal association
```

Document the exact task names/subjects that HubSpot workflows create. This answers open question #1 from the design doc.

**Step 3: Commit discovery notes**

Save findings to `docs/plans/2026-03-01-hubspot-task-schema.md` and commit.

```bash
git add docs/plans/2026-03-01-hubspot-task-schema.md
git commit -m "docs: document HubSpot task schema for role-based skills"
```

---

### Task 0.2: Add HubSpot Tasks Methods to Client

**Files:**
- Modify: `src/lib/hubspot.ts` (add task methods)

**Step 1: Write the failing test**

```typescript
// src/__tests__/lib/hubspot-tasks.test.ts
import { fetchTasksForDeal, completeTask, addTaskNote } from "@/lib/hubspot";

describe("HubSpot Tasks", () => {
  it("fetchTasksForDeal returns tasks associated with a deal", async () => {
    // Will need a real deal ID from step 0.1
    const tasks = await fetchTasksForDeal("DEAL_ID");
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks[0]).toHaveProperty("subject");
    expect(tasks[0]).toHaveProperty("status");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/hubspot-tasks.test.ts -v`
Expected: FAIL — `fetchTasksForDeal` not exported

**Step 3: Implement task methods in hubspot.ts**

Add to `src/lib/hubspot.ts`:

```typescript
// --- HubSpot Tasks API ---

export interface HubSpotTask {
  id: string;
  subject: string;
  status: string; // NOT_STARTED | IN_PROGRESS | COMPLETED | WAITING | DEFERRED
  priority: string;
  body: string; // task notes/description
  taskType: string;
  associatedDealId?: string;
}

/**
 * Fetch all open tasks associated with a deal.
 * Uses: GET /crm/v3/objects/tasks with deal association filter
 */
export async function fetchTasksForDeal(
  dealId: string,
  statusFilter: string[] = ["NOT_STARTED", "IN_PROGRESS"]
): Promise<HubSpotTask[]> {
  const response = await hubspotClient.crm.objects.searchApi.doSearch("tasks", {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "associations.deal",
            operator: "EQ",
            value: dealId,
          },
          {
            propertyName: "hs_task_status",
            operator: "IN",
            values: statusFilter,
          },
        ],
      },
    ],
    properties: [
      "hs_task_subject",
      "hs_task_status",
      "hs_task_priority",
      "hs_task_body",
      "hs_task_type",
    ],
    limit: 100,
  });

  return response.results.map((task) => ({
    id: task.id,
    subject: task.properties.hs_task_subject ?? "",
    status: task.properties.hs_task_status ?? "NOT_STARTED",
    priority: task.properties.hs_task_priority ?? "NONE",
    body: task.properties.hs_task_body ?? "",
    taskType: task.properties.hs_task_type ?? "",
    associatedDealId: dealId,
  }));
}

/**
 * Complete a HubSpot task and optionally add notes.
 */
export async function completeTask(
  taskId: string,
  notes?: string
): Promise<void> {
  const properties: Record<string, string> = {
    hs_task_status: "COMPLETED",
  };
  if (notes) {
    properties.hs_task_body = notes;
  }
  await hubspotClient.crm.objects.basicApi.update("tasks", taskId, {
    properties,
  });
}

/**
 * Add notes to a task without changing its status.
 */
export async function addTaskNote(
  taskId: string,
  notes: string
): Promise<void> {
  // Fetch current body, append new notes
  const task = await hubspotClient.crm.objects.basicApi.getById("tasks", taskId, [
    "hs_task_body",
  ]);
  const currentBody = task.properties.hs_task_body ?? "";
  const timestamp = new Date().toISOString();
  const updatedBody = currentBody
    ? `${currentBody}\n\n---\n[${timestamp}] ${notes}`
    : `[${timestamp}] ${notes}`;

  await hubspotClient.crm.objects.basicApi.update("tasks", taskId, {
    properties: { hs_task_body: updatedBody },
  });
}
```

> **Note:** The exact property names (`hs_task_subject`, `hs_task_status`, etc.) and the association filter syntax need to be verified against the schema discovered in Task 0.1. The HubSpot SDK may use `crm.objects.searchApi` or a dedicated tasks namespace — check what's available on the client.

**Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/hubspot-tasks.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/hubspot.ts src/__tests__/lib/hubspot-tasks.test.ts
git commit -m "feat: add HubSpot Tasks API methods (fetch, complete, add notes)"
```

---

### Task 0.3: Create HubSpot Tasks API Route

**Files:**
- Create: `src/app/api/tasks/route.ts`

**Step 1: Write the route**

```typescript
// src/app/api/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchTasksForDeal, completeTask, addTaskNote } from "@/lib/hubspot";

export const runtime = "nodejs";

/**
 * GET /api/tasks?dealId=<id>
 * Returns open tasks for a deal.
 *
 * Optional: ?status=NOT_STARTED,IN_PROGRESS (comma-separated filter)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = request.nextUrl;
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return NextResponse.json(
      { error: "dealId query parameter is required" },
      { status: 400 }
    );
  }

  const statusFilter = searchParams.get("status")?.split(",") ?? undefined;

  try {
    const tasks = await fetchTasksForDeal(dealId, statusFilter);
    return NextResponse.json({
      dealId,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks
 * Complete a task or add notes.
 *
 * Body: { taskId: string, action: "complete" | "add_note", notes?: string }
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { taskId, action, notes } = body;

    if (!taskId || !action) {
      return NextResponse.json(
        { error: "taskId and action are required" },
        { status: 400 }
      );
    }

    if (action === "complete") {
      await completeTask(taskId, notes);
      return NextResponse.json({ success: true, taskId, action: "completed" });
    }

    if (action === "add_note") {
      if (!notes) {
        return NextResponse.json(
          { error: "notes required for add_note action" },
          { status: 400 }
        );
      }
      await addTaskNote(taskId, notes);
      return NextResponse.json({ success: true, taskId, action: "note_added" });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Step 2: Test manually via dev server**

Start dev server, then:
```
GET /api/tasks?dealId=<real-deal-id>
```
Verify it returns tasks with subject, status, priority.

**Step 3: Commit**

```bash
git add src/app/api/tasks/route.ts
git commit -m "feat: add HubSpot Tasks API route (GET tasks by deal, PATCH to complete/note)"
```

---

## Phase 1: design-reviewer Skill (Highest Priority)

### Task 1.1: Create Skill Scaffold

**Files:**
- Create: `.claude/skills/design-reviewer/SKILL.md`

**Step 1: Write the SKILL.md**

```yaml
---
name: design-reviewer
description: Use when the user asks to "review this design", "check the planset for PROJ-XXXX", "run a design review", "generate a DA", "send design approval", "send a revision request", "what needs to change in this design", "re-review this planset", "check the updated plans", or any task involving verifying a vendor planset against AHJ codes, utility requirements, sold equipment, or generating a design approval document.
version: 0.1.0
---
```

The skill body should contain the full workflow. See Step 2.

**Step 2: Write the skill body**

The SKILL.md body encodes the designer's workflow as a Claude-readable procedure. Structure:

```markdown
# Design Reviewer Skill

Automate PB's internal design review: compliance checks, equipment matching,
layout review, revision management, and design approval document generation.

## Context

- PB outsources planset creation to a vendor
- The internal designer REVIEWS vendor work — does not create designs
- This skill automates the review checklist and manages the revision cycle
- Revisions are sent to the vendor via their portal
- Design approval documents are generated via PandaDoc

## Prerequisites

Before starting a design review, gather:
1. **Deal ID** — the HubSpot deal (PROJ-XXXX number or deal ID)
2. **Planset** — the vendor's planset PDF (use find-design-plans skill to locate)

## Workflow

### Step 0: Gather Context

1. Fetch deal properties:
   ```
   GET /api/projects/<dealId>
   ```
   Extract: module_brand, module_model, module_count, module_wattage,
   inverter_brand, inverter_model, inverter_qty, battery_brand, battery_model,
   battery_count, battery_expansion_count, system_size, ev_count,
   design_status, layout_status

2. Fetch AHJ requirements:
   ```
   GET /api/ahj?dealId=<dealId>
   ```
   Extract: NEC edition, IBC, IFC, wind speed, snow load, fire offsets,
   setback requirements, stamping requirements

3. Fetch utility requirements:
   ```
   GET /api/utility?dealId=<dealId>
   ```
   Extract: ac_disconnect_required, is_production_meter_required,
   backup_switch_allowed, interconnection type, design rules

4. Fetch open HubSpot tasks for this deal:
   ```
   GET /api/tasks?dealId=<dealId>
   ```

5. Locate and read the planset (invoke find-design-plans skill, then planset-bom skill)

### Step 1: Compliance Check

Compare the planset against AHJ and utility requirements:

**AHJ Compliance:**
- [ ] Setback distances meet AHJ minimums (fire, ridge, eave, valley)
- [ ] Fire offset pathways comply with IFC requirements
- [ ] Wind speed rating of racking meets AHJ design_wind_speed
- [ ] Snow load rating of racking meets AHJ design_snow_load (invoke product-lookup for racking load ratings)
- [ ] Rapid shutdown compliant with NEC 690.12 (edition from AHJ)
- [ ] Stamping requirements noted (wet stamp, digital, state PE license)

**Utility Compliance:**
- [ ] AC disconnect present if required by utility
- [ ] Production meter present if required by utility
- [ ] Backup switch configuration matches utility rules
- [ ] Interconnection type matches utility requirements

Output: Compliance report with PASS/FAIL per item and code references.
Complete the compliance review task if all items pass.

### Step 2: Equipment Match

Compare what was SOLD (HubSpot deal) vs what was DESIGNED (planset BOM):

| Check | Sold (HubSpot) | Designed (Planset) | Match? |
|-------|----------------|-------------------|--------|
| Module brand/model | deal.module_brand + module_model | BOM module | ✓/✗ |
| Module count | deal.module_count | BOM qty | ✓/✗ |
| Inverter | deal.inverter_brand + model | BOM inverter | ✓/✗ |
| Battery | deal.battery_brand + model | BOM battery | ✓/✗ |
| Battery count | deal.battery_count | BOM qty | ✓/✗ |
| Expansion kit | deal.battery_expansion_count | BOM expansion | ✓/✗ |
| EV charger | deal.ev_count | BOM EV | ✓/✗ |

For each equipment item, invoke product-lookup to verify:
- Module frame fits racking clamp range
- Rail supports module weight and span
- Inverter supports string configuration
- Battery count matches expansion kit requirements

Output: Equipment match report. Complete equipment review task.

### Step 3: Layout Review Assist

Read planset PV-0 (cover/site plan) and PV-1 (roof plan):
- Check array orientations — flag north-facing arrays
- Check roof pitch — flag extreme pitches (>45° or <5°)
- Verify arrays clear of setback zones (using AHJ distances from Step 1)
- Check for split arrays across multiple roof planes
- Verify module count per string matches inverter input specs
- Note any visible shading obstructions

Output: Layout review notes with automated flags + areas needing human judgment.
This step is SEMI-AUTOMATED — flag concerns, designer makes the final call.

### Step 4: Revision Management

If ANY items failed in Steps 1-3:

1. Aggregate all failures into a structured revision request:
   ```
   REVISION REQUEST — PROJ-XXXX — [Date]

   MUST FIX:
   1. [Issue] — [What's wrong] — [What's needed, with code/spec reference]
   2. ...

   RECOMMENDED:
   1. [Issue] — [Suggestion]
   ```

2. Invoke product-lookup for correct specs and part numbers
3. Invoke engineering-reviewer for structural/electrical input on technical issues
4. Format for vendor portal submission
5. Complete "revision request sent" task

**On re-review** (after vendor submits updated planset):
1. Re-run Steps 1-3 on the new planset
2. Compare against previous revision request — verify each item addressed
3. Generate delta report (fixed / still outstanding / new issues)
4. Determine if customer-visible changes require a new DA document

### Step 5: Design Approval Flow

When all review steps pass (no must-fix items):

1. Extract final BOM (planset-bom skill — should already be done from Step 1)
2. Gather equipment photos (SolarView or AI-generated images)
3. Extract layout image from planset
4. Create DA document via PandaDoc:
   ```
   POST /api/pandadoc/create-da
   Body: {
     dealId: "<dealId>",
     equipment: [BOM items with specs],
     layoutImage: "<image URL or base64>",
     equipmentPhotos: [photo URLs],
     systemSize: "<kW>",
     moduleCount: <count>
   }
   ```
5. Send DA to customer for signature
6. Complete "DA sent" task

After customer response:
- Approved → complete "DA approved" task
- Changes requested → go to Step 4 (revision management)

## Task Matching

Map HubSpot task subjects to skill handlers:

| Task Subject Pattern | Handler |
|---------------------|---------|
| *compliance review* | Step 1: Compliance Check |
| *equipment review* / *equipment match* | Step 2: Equipment Match |
| *layout review* | Step 3: Layout Review Assist |
| *revision* / *send revision* | Step 4: Revision Management |
| *design approval* / *DA* / *send DA* | Step 5: Design Approval Flow |

> **Note:** Exact task subject patterns will be confirmed during Task 0.1 (HubSpot task schema discovery). Update this table with the real task names.

## Integration Points

- **find-design-plans** — locate planset PDF in Google Drive
- **planset-bom** — extract BOM from planset
- **product-lookup** — equipment specs, compatibility, qty rules
- **engineering-reviewer** — technical input for revision requests
- **API routes used:**
  - `GET /api/projects/<dealId>` — deal properties
  - `GET /api/ahj?dealId=<dealId>` — AHJ requirements
  - `GET /api/utility?dealId=<dealId>` — utility requirements
  - `GET /api/tasks?dealId=<dealId>` — open HubSpot tasks
  - `PATCH /api/tasks` — complete tasks / add notes
  - `POST /api/pandadoc/create-da` — create DA document (Phase 1b)
```

**Step 3: Commit**

```bash
git add .claude/skills/design-reviewer/SKILL.md
git commit -m "feat: add design-reviewer skill scaffold with full workflow"
```

---

### Task 1.2: Test Design Reviewer on a Real Deal

**Files:**
- Read: `.claude/skills/design-reviewer/SKILL.md` (the skill you just created)

**Step 1: Pick a test deal**

Choose a deal currently in "Ready for Design" or "In Progress" design status that has:
- A planset in Google Drive
- AHJ and Utility records associated
- Equipment fields populated on the deal
- Open tasks

**Step 2: Run through the skill manually**

Invoke the design-reviewer skill against the test deal. Walk through each step:
- Step 0: Gather context (deal, AHJ, utility, tasks, planset)
- Step 1: Compliance check
- Step 2: Equipment match
- Step 3: Layout review

Document what works, what breaks, what task names actually look like.

**Step 3: Update SKILL.md with findings**

Fix any incorrect API paths, property names, task subject patterns, or workflow steps based on the real-world test.

**Step 4: Commit**

```bash
git add .claude/skills/design-reviewer/SKILL.md
git commit -m "fix: update design-reviewer skill based on live testing"
```

---

## Phase 1b: PandaDoc Integration (Design Approval Documents)

### Task 1b.1: Discover PandaDoc API

**Step 1: Research PandaDoc API**

Use web search to find:
- PandaDoc API authentication (API key vs OAuth)
- Document creation from template endpoint
- How to populate template fields
- How to add images (layout, equipment photos)
- How to send for signature
- Webhook for signature completion (if available)

**Step 2: Get PandaDoc credentials and template info**

Ask user for:
- PandaDoc API key (add to `.env` as `PANDADOC_API_KEY`)
- DA template ID
- Template field names that need to be populated

**Step 3: Document the integration**

Save to `docs/plans/2026-03-01-pandadoc-integration.md`.

```bash
git add docs/plans/2026-03-01-pandadoc-integration.md
git commit -m "docs: document PandaDoc API integration for DA documents"
```

---

### Task 1b.2: Create PandaDoc Client Library

**Files:**
- Create: `src/lib/pandadoc.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/lib/pandadoc.test.ts
import { createDADocument, sendDocument } from "@/lib/pandadoc";

describe("PandaDoc Client", () => {
  it("createDADocument creates a document from template", async () => {
    // Mock test — real API key needed for integration test
    expect(typeof createDADocument).toBe("function");
  });
});
```

**Step 2: Implement the client**

```typescript
// src/lib/pandadoc.ts

const PANDADOC_API_KEY = process.env.PANDADOC_API_KEY!;
const PANDADOC_BASE_URL = "https://api.pandadoc.com/public/v1";

interface DADocumentInput {
  dealId: string;
  customerName: string;
  customerEmail: string;
  equipment: Array<{
    name: string;
    model: string;
    quantity: number;
    specs?: string;
  }>;
  systemSizeKw: number;
  moduleCount: number;
  layoutImageUrl?: string;
  equipmentPhotoUrls?: string[];
}

/**
 * Create a Design Approval document from the PandaDoc template.
 */
export async function createDADocument(
  templateId: string,
  input: DADocumentInput
): Promise<{ documentId: string; status: string }> {
  const response = await fetch(`${PANDADOC_BASE_URL}/documents`, {
    method: "POST",
    headers: {
      "Authorization": `API-Key ${PANDADOC_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Design Approval — ${input.customerName}`,
      template_uuid: templateId,
      recipients: [
        {
          email: input.customerEmail,
          first_name: input.customerName.split(" ")[0],
          last_name: input.customerName.split(" ").slice(1).join(" "),
          role: "Customer",
        },
      ],
      tokens: [
        { name: "customer_name", value: input.customerName },
        { name: "system_size_kw", value: String(input.systemSizeKw) },
        { name: "module_count", value: String(input.moduleCount) },
        // Add more tokens as needed based on template fields
      ],
      // Fields, images, and pricing tables populated based on template structure
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PandaDoc create failed: ${response.status} ${error}`);
  }

  const data = await response.json();
  return { documentId: data.id, status: data.status };
}

/**
 * Send a PandaDoc document for signature.
 */
export async function sendDocument(
  documentId: string,
  message?: string
): Promise<void> {
  const response = await fetch(
    `${PANDADOC_BASE_URL}/documents/${documentId}/send`,
    {
      method: "POST",
      headers: {
        "Authorization": `API-Key ${PANDADOC_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: message ?? "Please review and approve your solar system design.",
        silent: false,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PandaDoc send failed: ${response.status} ${error}`);
  }
}
```

> **Note:** Token names and template structure are placeholders. Update after Task 1b.1 discovers the actual template fields.

**Step 3: Commit**

```bash
git add src/lib/pandadoc.ts src/__tests__/lib/pandadoc.test.ts
git commit -m "feat: add PandaDoc client library for DA document creation"
```

---

### Task 1b.3: Create PandaDoc API Route

**Files:**
- Create: `src/app/api/pandadoc/create-da/route.ts`

**Step 1: Write the route**

```typescript
// src/app/api/pandadoc/create-da/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createDADocument, sendDocument } from "@/lib/pandadoc";

export const runtime = "nodejs";
export const maxDuration = 30;

const DA_TEMPLATE_ID = process.env.PANDADOC_DA_TEMPLATE_ID!;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const { dealId, customerName, customerEmail, equipment, systemSizeKw, moduleCount, layoutImageUrl, equipmentPhotoUrls, send } = body;

    if (!dealId || !customerName || !customerEmail) {
      return NextResponse.json(
        { error: "dealId, customerName, and customerEmail are required" },
        { status: 400 }
      );
    }

    const doc = await createDADocument(DA_TEMPLATE_ID, {
      dealId,
      customerName,
      customerEmail,
      equipment: equipment ?? [],
      systemSizeKw: systemSizeKw ?? 0,
      moduleCount: moduleCount ?? 0,
      layoutImageUrl,
      equipmentPhotoUrls,
    });

    if (send) {
      await sendDocument(doc.documentId);
    }

    return NextResponse.json({
      success: true,
      documentId: doc.documentId,
      status: doc.status,
      sent: !!send,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/pandadoc/create-da/route.ts
git commit -m "feat: add PandaDoc DA creation API route"
```

---

## Phase 2: engineering-reviewer Skill

### Task 2.1: Create Engineering Reference Data

**Files:**
- Create: `.claude/skills/product-lookup/references/nec-tables.md`

**Step 1: Create NEC reference tables**

The engineering-reviewer needs NEC ampacity tables, voltage drop formulas, and grounding requirements. Create a reference file that product-lookup can serve:

```markdown
# NEC Reference Tables — Residential Solar

## NEC 310.16 — Ampacity Table (75°C Column, Copper)
| AWG | Ampacity |
|-----|----------|
| 14  | 20A      |
| 12  | 25A      |
| 10  | 35A      |
| 8   | 50A      |
| 6   | 65A      |
| 4   | 85A      |
| 3   | 100A     |
| 2   | 115A     |

## NEC 690.8 — PV Circuit Conductor Sizing
- Conductor ampacity ≥ 1.56 × Isc (module short-circuit current)
- For strings: Isc × number of parallel strings × 1.25 (continuous) × 1.25 (conditions)

## Voltage Drop Calculation
- VD = (2 × L × I × R) / 1000
- Target: ≤ 2% for branch circuits, ≤ 3% for feeders
- R values per AWG at 75°C (copper): ...

## NEC 690.12 — Rapid Shutdown
- Conductors > 1 ft from array must be de-energized within 30 seconds
- Array-level: ≤ 80V within 30 seconds, ≤ 1V within 30 seconds (NEC 2020+)

## Grounding
- Equipment grounding conductor (EGC): NEC 250.122
- Grounding electrode conductor (GEC): NEC 250.66
```

> **Note:** These are starter tables. Expand based on what the engineering-reviewer actually needs during testing.

**Step 2: Update product-lookup SKILL.md index**

Add `nec-tables.md` to the manufacturer reference index in the product-lookup skill.

**Step 3: Commit**

```bash
git add .claude/skills/product-lookup/references/nec-tables.md
git add .claude/skills/product-lookup/SKILL.md
git commit -m "feat: add NEC reference tables for engineering-reviewer"
```

---

### Task 2.2: Create Engineering Reviewer Skill Scaffold

**Files:**
- Create: `.claude/skills/engineering-reviewer/SKILL.md`

**Step 1: Write the SKILL.md**

```yaml
---
name: engineering-reviewer
description: Use when the user asks to "run an engineering review", "check the electrical design for PROJ-XXXX", "review the SLD", "prep for PE stamp", "structural review", "prep permit package", "what's missing for permits", or any task involving pre-PE-stamp electrical/structural validation and permit package preparation.
version: 0.1.0
---
```

Skill body follows the same pattern as design-reviewer but focused on:
- Step 0: Gather context (deal, AHJ, planset SLD)
- Step 1: Electrical validation (wire sizing, breaker, voltage drop, rapid shutdown, string sizing, grounding)
- Step 2: Structural validation (wind/snow loads vs racking ratings, attachment spacing, clamp compatibility)
- Step 3: Code compliance package (NEC edition, IBC, IFC, stamping requirements — compiled for PE)
- Step 4: Permit package prep (document checklist against AHJ requirements)

Each step reads open HubSpot tasks, does the work, completes the relevant task with findings as notes.

API routes used:
- `GET /api/projects/<dealId>` — deal properties
- `GET /api/ahj?dealId=<dealId>` — AHJ codes and structural requirements
- `GET /api/utility?dealId=<dealId>` — utility rules
- `GET /api/tasks?dealId=<dealId>` — open tasks
- `PATCH /api/tasks` — complete tasks with notes

Skills invoked: planset-bom, product-lookup (including nec-tables.md), find-design-plans

**Step 2: Commit**

```bash
git add .claude/skills/engineering-reviewer/SKILL.md
git commit -m "feat: add engineering-reviewer skill scaffold"
```

---

### Task 2.3: Test Engineering Reviewer on a Real Deal

Same pattern as Task 1.2 — pick a deal that's past design review, run through the skill, document findings, update SKILL.md.

```bash
git commit -m "fix: update engineering-reviewer skill based on live testing"
```

---

## Phase 3: sales-advisor Skill

### Task 3.1: Create Sales Advisor Skill Scaffold

**Files:**
- Create: `.claude/skills/sales-advisor/SKILL.md`

**Step 1: Write the SKILL.md**

```yaml
---
name: sales-advisor
description: Use when the user asks to "qualify this deal", "check this lead", "prep for handoff", "what's missing for ops", "review this sale", "validate this system", "handoff checklist", or any task involving sales deal qualification, equipment validation, or sales-to-ops handoff preparation.
version: 0.1.0
---
```

Skill body:
- Step 0: Gather context (deal properties, AHJ, utility)
- Step 1: Qualify lead (jurisdiction feasibility, utility feasibility, red flags)
- Step 2: Validate sold system (equipment compatibility via product-lookup, utility requirements)
- Step 3: Handoff checklist (missing fields, Zoho customer, Drive folder, OpenSolar link, contract)
- Step 4: Pricing review (stretch — sold price vs catalog cost, incentive eligibility)

API routes used:
- `GET /api/projects/<dealId>` or `GET /api/deals?dealId=<dealId>` — deal properties
- `GET /api/ahj?dealId=<dealId>` — AHJ data
- `GET /api/utility?dealId=<dealId>` — utility data
- `GET /api/tasks?dealId=<dealId>` — open tasks
- `PATCH /api/tasks` — complete tasks
- `GET /api/bom/zoho-customers?search=<name>` — Zoho customer check

Skills invoked: product-lookup

**Step 2: Commit**

```bash
git add .claude/skills/sales-advisor/SKILL.md
git commit -m "feat: add sales-advisor skill scaffold"
```

---

### Task 3.2: Test Sales Advisor on a Real Deal

Same pattern — pick a deal in the sales pipeline, run through qualification + handoff checklist, document findings, update SKILL.md.

```bash
git commit -m "fix: update sales-advisor skill based on live testing"
```

---

## Phase 4: Update Skills Reference

### Task 4.1: Update README and HTML Reference

**Files:**
- Modify: `.claude/skills/README.md`
- Modify: `.claude/skills/skills-reference.html`

Add the three new skills to both documents with their triggers, workflows, and integration points. Update the dependency map and pipeline flow diagram.

```bash
git add .claude/skills/README.md .claude/skills/skills-reference.html
git commit -m "docs: add role-based skills to skills reference"
```

---

## Implementation Order Summary

| Phase | Tasks | Dependencies | Est. Complexity |
|-------|-------|-------------|-----------------|
| **0: Infrastructure** | 0.1–0.3 (HubSpot Tasks API) | None | Medium |
| **1: design-reviewer** | 1.1–1.2 (skill + test) | Phase 0 | Medium |
| **1b: PandaDoc** | 1b.1–1b.3 (client + route) | API key + template from user | Medium |
| **2: engineering-reviewer** | 2.1–2.3 (NEC refs + skill + test) | Phase 0 | Medium |
| **3: sales-advisor** | 3.1–3.2 (skill + test) | Phase 0 | Low |
| **4: Reference docs** | 4.1 (README + HTML update) | Phases 1-3 | Low |

**Critical path:** Phase 0 → Phase 1 → Phase 1b (PandaDoc can parallel with Phase 2)

## Open Items to Resolve During Implementation

1. ~~HubSpot task names~~ — resolved in Task 0.1 discovery
2. ~~Vendor communication~~ — portal (confirmed)
3. **PandaDoc API key + DA template** — needed for Phase 1b
4. **Equipment photo source** — SolarView integration or AI generation approach TBD
5. **PE firm communication** — how code compliance package gets to PE (email? portal?)
