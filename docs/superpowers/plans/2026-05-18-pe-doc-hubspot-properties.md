# PE Document Status HubSpot Properties — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 30 HubSpot deal properties for PE document statuses/notes with two-way sync between `PeDocumentReview` DB table and HubSpot.

**Architecture:** One-time script creates 15 enum + 15 textarea properties in a "Participate Energy Documents" group on HubSpot deals. `syncPeDocStatusesToHubSpot()` pushes DB statuses to HubSpot after each scraper sync. A webhook handler receives manual HubSpot edits back to DB with echo suppression to prevent circular writes.

**Tech Stack:** TypeScript, HubSpot CRM API v3, Prisma (PeDocumentReview), Next.js API routes, HubSpot webhook signature validation.

**Spec:** `docs/superpowers/specs/2026-05-18-pe-doc-hubspot-properties-design.md`

---

## Chunk 1: Mapping Constants + Notes Extraction

### Task 1: Create `src/lib/pe-hubspot-sync.ts` — Mapping Constants

**Files:**
- Create: `src/lib/pe-hubspot-sync.ts`
- Test: `src/__tests__/pe-hubspot-sync.test.ts`

- [ ] **Step 1: Write the test file for mapping constants and `extractHubSpotNotes`**

```typescript
// src/__tests__/pe-hubspot-sync.test.ts
import {
  PE_DOC_HUBSPOT_MAP,
  PE_STATUS_TO_HUBSPOT,
  HUBSPOT_TO_PE_STATUS,
  extractHubSpotNotes,
  docNameToStatusProp,
  statusPropToDocName,
} from "@/lib/pe-hubspot-sync";

describe("PE HubSpot sync mapping constants", () => {
  test("PE_DOC_HUBSPOT_MAP has exactly 15 entries", () => {
    expect(PE_DOC_HUBSPOT_MAP).toHaveLength(15);
  });

  test("every entry has all 4 fields populated", () => {
    for (const entry of PE_DOC_HUBSPOT_MAP) {
      expect(entry.docName).toBeTruthy();
      expect(entry.statusProp).toMatch(/^pe_doc_/);
      expect(entry.notesProp).toMatch(/_notes$/);
      expect(entry.label).toMatch(/^PE: /);
    }
  });

  test("statusProp names are unique", () => {
    const props = PE_DOC_HUBSPOT_MAP.map((e) => e.statusProp);
    expect(new Set(props).size).toBe(15);
  });

  test("notesProp = statusProp + '_notes'", () => {
    for (const entry of PE_DOC_HUBSPOT_MAP) {
      expect(entry.notesProp).toBe(`${entry.statusProp}_notes`);
    }
  });

  test("PE_STATUS_TO_HUBSPOT covers all 6 PeDocStatus values", () => {
    const expected = ["NOT_UPLOADED", "UPLOADED", "UNDER_REVIEW", "ACTION_REQUIRED", "REJECTED", "APPROVED"];
    for (const status of expected) {
      expect(PE_STATUS_TO_HUBSPOT).toHaveProperty(status);
    }
    expect(Object.keys(PE_STATUS_TO_HUBSPOT)).toHaveLength(6);
  });

  test("HUBSPOT_TO_PE_STATUS is inverse of PE_STATUS_TO_HUBSPOT", () => {
    for (const [peStatus, hsValue] of Object.entries(PE_STATUS_TO_HUBSPOT)) {
      expect(HUBSPOT_TO_PE_STATUS[hsValue]).toBe(peStatus);
    }
  });

  test("docNameToStatusProp maps canonical name to HubSpot property", () => {
    expect(docNameToStatusProp("Design Plan")).toBe("pe_doc_design_plan");
    expect(docNameToStatusProp("Permission to Operate (PTO)")).toBe("pe_doc_permission_to_operate");
  });

  test("statusPropToDocName maps HubSpot property to canonical name", () => {
    expect(statusPropToDocName("pe_doc_design_plan")).toBe("Design Plan");
    expect(statusPropToDocName("pe_doc_permission_to_operate")).toBe("Permission to Operate (PTO)");
  });

  test("docNameToStatusProp returns undefined for unknown name", () => {
    expect(docNameToStatusProp("Unknown Doc")).toBeUndefined();
  });

  test("statusPropToDocName handles notes props by stripping _notes suffix", () => {
    expect(statusPropToDocName("pe_doc_design_plan_notes")).toBe("Design Plan");
  });
});

describe("extractHubSpotNotes", () => {
  test("extracts Approver segment from pipe-delimited notes", () => {
    const raw = "Synced from PE portal scraper (PROJ-8708) | Submitted: 2026-04-16 | Approver: The design plan must be stamped by a PE | Responded: 2026-05-15";
    expect(extractHubSpotNotes(raw)).toBe("The design plan must be stamped by a PE");
  });

  test("extracts Partner segment when present", () => {
    const raw = "Synced from PE portal scraper (PROJ-1234) | Partner: Please resubmit with updated specs";
    expect(extractHubSpotNotes(raw)).toBe("Please resubmit with updated specs");
  });

  test("combines Approver and Partner when both present", () => {
    const raw = "Synced from PE portal scraper (PROJ-1234) | Partner: Updated file attached | Approver: Looks good now";
    const result = extractHubSpotNotes(raw);
    expect(result).toContain("Updated file attached");
    expect(result).toContain("Looks good now");
  });

  test("returns empty string when no Approver or Partner segments", () => {
    const raw = "Synced from PE portal scraper (PROJ-1234) | Submitted: 2026-04-16";
    expect(extractHubSpotNotes(raw)).toBe("");
  });

  test("returns empty string for null/undefined input", () => {
    expect(extractHubSpotNotes(null as unknown as string)).toBe("");
    expect(extractHubSpotNotes("")).toBe("");
  });

  test("returns raw string as-is if not pipe-delimited (manual HubSpot note)", () => {
    const raw = "Manual note from HubSpot user";
    expect(extractHubSpotNotes(raw)).toBe("Manual note from HubSpot user");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage`
Expected: FAIL — module `@/lib/pe-hubspot-sync` does not exist yet.

- [ ] **Step 3: Write `src/lib/pe-hubspot-sync.ts` — constants and `extractHubSpotNotes`**

```typescript
// src/lib/pe-hubspot-sync.ts
/**
 * PE Document Status ↔ HubSpot Deal Property sync.
 *
 * Maps between PeDocumentReview canonical doc names and HubSpot
 * deal properties. Used by:
 *   - syncPeDocStatusesToHubSpot() — DB → HubSpot push after scraper sync
 *   - Webhook handler — HubSpot → DB for manual edits
 *   - scripts/create-pe-doc-properties.ts — property creation
 */

import { PeDocStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mapping types
// ---------------------------------------------------------------------------

export interface PeDocPropertyMapping {
  docName: string;
  statusProp: string;
  notesProp: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Canonical mapping: docName ↔ HubSpot property name ↔ label
// ---------------------------------------------------------------------------

export const PE_DOC_HUBSPOT_MAP: PeDocPropertyMapping[] = [
  { docName: "Customer Agreement (PPA/ESA)", statusProp: "pe_doc_customer_agreement", notesProp: "pe_doc_customer_agreement_notes", label: "PE: Customer Agreement (PPA/ESA)" },
  { docName: "Installation Order", statusProp: "pe_doc_installation_order", notesProp: "pe_doc_installation_order_notes", label: "PE: Installation Order" },
  { docName: "State Disclosures", statusProp: "pe_doc_state_disclosures", notesProp: "pe_doc_state_disclosures_notes", label: "PE: State Disclosures" },
  { docName: "Utility Bill", statusProp: "pe_doc_utility_bill", notesProp: "pe_doc_utility_bill_notes", label: "PE: Utility Bill" },
  { docName: "Signed Proposal", statusProp: "pe_doc_signed_proposal", notesProp: "pe_doc_signed_proposal_notes", label: "PE: Signed Proposal" },
  { docName: "Design Plan", statusProp: "pe_doc_design_plan", notesProp: "pe_doc_design_plan_notes", label: "PE: Design Plan" },
  { docName: "Photos per Policy", statusProp: "pe_doc_photos_per_policy", notesProp: "pe_doc_photos_per_policy_notes", label: "PE: Photos per Policy" },
  { docName: "Signed Final Permit", statusProp: "pe_doc_signed_final_permit", notesProp: "pe_doc_signed_final_permit_notes", label: "PE: Signed Final Permit" },
  { docName: "Access to Monitoring", statusProp: "pe_doc_access_to_monitoring", notesProp: "pe_doc_access_to_monitoring_notes", label: "PE: Access to Monitoring" },
  { docName: "Certificate of Acceptance", statusProp: "pe_doc_certificate_of_acceptance", notesProp: "pe_doc_certificate_of_acceptance_notes", label: "PE: Certificate of Acceptance" },
  { docName: "Attestation of Customer Payment", statusProp: "pe_doc_attestation_customer_payment", notesProp: "pe_doc_attestation_customer_payment_notes", label: "PE: Attestation of Customer Payment" },
  { docName: "Conditional Progress Lien Waiver", statusProp: "pe_doc_conditional_lien_waiver", notesProp: "pe_doc_conditional_lien_waiver_notes", label: "PE: Conditional Progress Lien Waiver" },
  { docName: "Signed Interconnection Agreement", statusProp: "pe_doc_signed_interconnection", notesProp: "pe_doc_signed_interconnection_notes", label: "PE: Signed Interconnection Agreement" },
  { docName: "Conditional Waiver — Final Payment", statusProp: "pe_doc_conditional_waiver_final", notesProp: "pe_doc_conditional_waiver_final_notes", label: "PE: Conditional Waiver — Final Payment" },
  { docName: "Permission to Operate (PTO)", statusProp: "pe_doc_permission_to_operate", notesProp: "pe_doc_permission_to_operate_notes", label: "PE: Permission to Operate (PTO)" },
];

// ---------------------------------------------------------------------------
// Lookup helpers (built from PE_DOC_HUBSPOT_MAP)
// ---------------------------------------------------------------------------

const _docNameToEntry = new Map<string, PeDocPropertyMapping>();
const _statusPropToEntry = new Map<string, PeDocPropertyMapping>();

for (const entry of PE_DOC_HUBSPOT_MAP) {
  _docNameToEntry.set(entry.docName, entry);
  _statusPropToEntry.set(entry.statusProp, entry);
}

export function docNameToStatusProp(docName: string): string | undefined {
  return _docNameToEntry.get(docName)?.statusProp;
}

export function statusPropToDocName(prop: string): string | undefined {
  const cleaned = prop.endsWith("_notes") ? prop.replace(/_notes$/, "") : prop;
  return _statusPropToEntry.get(cleaned)?.docName;
}

// ---------------------------------------------------------------------------
// Status value mapping: PeDocStatus ↔ HubSpot enum value
// ---------------------------------------------------------------------------

export const PE_STATUS_TO_HUBSPOT: Record<PeDocStatus, string> = {
  [PeDocStatus.NOT_UPLOADED]: "not_uploaded",
  [PeDocStatus.UPLOADED]: "uploaded",
  [PeDocStatus.UNDER_REVIEW]: "under_review",
  [PeDocStatus.ACTION_REQUIRED]: "action_required",
  [PeDocStatus.REJECTED]: "rejected",
  [PeDocStatus.APPROVED]: "approved",
};

export const HUBSPOT_TO_PE_STATUS: Record<string, PeDocStatus> = {
  not_uploaded: PeDocStatus.NOT_UPLOADED,
  uploaded: PeDocStatus.UPLOADED,
  under_review: PeDocStatus.UNDER_REVIEW,
  action_required: PeDocStatus.ACTION_REQUIRED,
  rejected: PeDocStatus.REJECTED,
  approved: PeDocStatus.APPROVED,
};

// ---------------------------------------------------------------------------
// Notes extraction
// ---------------------------------------------------------------------------

export function extractHubSpotNotes(rawNotes: string): string {
  if (!rawNotes) return "";

  // If not pipe-delimited, it's a manual note — return as-is
  if (!rawNotes.includes(" | ")) return rawNotes;

  const segments = rawNotes.split(" | ");
  const relevant: string[] = [];

  for (const seg of segments) {
    if (seg.startsWith("Approver: ")) {
      relevant.push(seg.replace("Approver: ", "").trim());
    } else if (seg.startsWith("Partner: ")) {
      relevant.push(seg.replace("Partner: ", "").trim());
    }
  }

  return relevant.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-hubspot-sync.ts src/__tests__/pe-hubspot-sync.test.ts
git commit -m "feat(pe): add PE doc ↔ HubSpot property mapping constants and notes extraction"
```

---

## Chunk 2: HubSpot Property Creation Script

### Task 2: Create `scripts/create-pe-doc-properties.ts`

**Files:**
- Create: `scripts/create-pe-doc-properties.ts`
- Reference: `scripts/_create-shit-show-properties.ts` (pattern to follow)
- Reference: `src/lib/pe-hubspot-sync.ts` (imports `PE_DOC_HUBSPOT_MAP`)

- [ ] **Step 1: Write the creation script**

```typescript
#!/usr/bin/env tsx
/**
 * One-shot: create 30 HubSpot Deal properties for PE document tracking.
 * Creates a "Participate Energy Documents" property group, then 15 enum
 * status properties and 15 textarea notes properties. Idempotent — 409
 * (already exists) is treated as success.
 *
 * Usage:
 *   npx tsx scripts/create-pe-doc-properties.ts
 *   (requires HUBSPOT_ACCESS_TOKEN in env or .env.local)
 */

// Import the mapping from the sync module.
// Note: tsx resolves @/ aliases from tsconfig.json.
import { PE_DOC_HUBSPOT_MAP } from "../src/lib/pe-hubspot-sync";

const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

const API_BASE = "https://api.hubapi.com/crm/v3/properties/deals";

const STATUS_OPTIONS = [
  { label: "Not Uploaded", value: "not_uploaded", displayOrder: 0, hidden: false },
  { label: "Uploaded", value: "uploaded", displayOrder: 1, hidden: false },
  { label: "Under Review", value: "under_review", displayOrder: 2, hidden: false },
  { label: "Action Required", value: "action_required", displayOrder: 3, hidden: false },
  { label: "Rejected", value: "rejected", displayOrder: 4, hidden: false },
  { label: "Approved", value: "approved", displayOrder: 5, hidden: false },
];

async function ensurePropertyGroup(): Promise<void> {
  const res = await fetch("https://api.hubapi.com/crm/v3/properties/deals/groups", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "pe_documents",
      label: "Participate Energy Documents",
      displayOrder: -1,
    }),
  });

  if (res.ok) {
    console.log("✓ Created property group 'pe_documents'");
    return;
  }

  const errText = await res.text();
  if (res.status === 409 || /already.*exists/i.test(errText)) {
    console.log("= Property group 'pe_documents' already exists (skipped)");
    return;
  }
  throw new Error(`Failed to create property group: ${res.status} ${errText.slice(0, 300)}`);
}

async function createProperty(
  name: string,
  label: string,
  type: "enumeration" | "string",
  fieldType: "select" | "textarea",
  description: string,
  options?: typeof STATUS_OPTIONS,
): Promise<void> {
  const body: Record<string, unknown> = {
    name,
    label,
    type,
    fieldType,
    description,
    groupName: "pe_documents",
    formField: false,
  };
  if (options) body.options = options;

  const res = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    console.log(`  ✓ Created ${name}`);
    return;
  }

  const errText = await res.text();
  if (res.status === 409 || /already.*exists|conflict/i.test(errText)) {
    console.log(`  = ${name} already exists (skipped)`);
    return;
  }
  throw new Error(`Failed to create ${name}: ${res.status} ${errText.slice(0, 300)}`);
}

async function main() {
  console.log("Creating PE document property group...\n");
  await ensurePropertyGroup();

  console.log("\nCreating 15 status properties...");
  for (const entry of PE_DOC_HUBSPOT_MAP) {
    await createProperty(
      entry.statusProp,
      entry.label,
      "enumeration",
      "select",
      `PE document status for ${entry.docName}`,
      STATUS_OPTIONS,
    );
  }

  console.log("\nCreating 15 notes properties...");
  for (const entry of PE_DOC_HUBSPOT_MAP) {
    const notesLabel = entry.label + " Notes";
    await createProperty(
      entry.notesProp,
      notesLabel,
      "string",
      "textarea",
      `PE reviewer/partner notes for ${entry.docName}`,
    );
  }

  console.log(`\nDone — 30 properties ensured in 'pe_documents' group.`);
  console.log("Next: deploy code changes, then trigger a PE scraper sync to backfill.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify script compiles without errors**

Run: `npx tsx --eval "import('../scripts/create-pe-doc-properties.ts')" 2>&1 | head -5`

This will fail at runtime (no token) but verifies the TypeScript compiles and the import from `pe-hubspot-sync` resolves. Expected: error about `HUBSPOT_ACCESS_TOKEN missing`, NOT a compile error.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-pe-doc-properties.ts
git commit -m "feat(pe): add HubSpot property creation script for PE doc statuses"
```

---

## Chunk 3: DB → HubSpot Sync Function

### Task 3: Add `syncPeDocStatusesToHubSpot()` to `pe-hubspot-sync.ts`

**Files:**
- Modify: `src/lib/pe-hubspot-sync.ts` (append sync function)
- Test: `src/__tests__/pe-hubspot-sync.test.ts` (add integration-style test)

- [ ] **Step 1: Write test for `syncPeDocStatusesToHubSpot`**

Add to the bottom of `src/__tests__/pe-hubspot-sync.test.ts`:

```typescript
// These tests mock prisma + fetch to test the sync logic without real APIs.
// They verify the correct HubSpot batch payload shape.

import { syncPeDocStatusesToHubSpot } from "@/lib/pe-hubspot-sync";

// Mock prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    peDocumentReview: {
      findMany: jest.fn(),
    },
  },
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("syncPeDocStatusesToHubSpot", () => {
  const { prisma } = require("@/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  test("builds correct batch payload from DB rows", async () => {
    prisma.peDocumentReview.findMany.mockResolvedValue([
      { dealId: "123", docName: "Design Plan", status: "APPROVED", notes: "Synced from PE portal scraper (PROJ-1234) | Approver: Looks good" },
      { dealId: "123", docName: "Utility Bill", status: "NOT_UPLOADED", notes: null },
    ]);

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await syncPeDocStatusesToHubSpot(["123"]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.hubapi.com/crm/v3/objects/deals/batch/update");

    const body = JSON.parse(opts.body);
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0].id).toBe("123");
    expect(body.inputs[0].properties.pe_doc_design_plan).toBe("approved");
    expect(body.inputs[0].properties.pe_doc_design_plan_notes).toBe("Looks good");
    expect(body.inputs[0].properties.pe_doc_utility_bill).toBe("not_uploaded");
    expect(body.inputs[0].properties.pe_doc_utility_bill_notes).toBe("");
  });

  test("skips when no deal IDs provided", async () => {
    await syncPeDocStatusesToHubSpot([]);
    expect(prisma.peDocumentReview.findMany).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("skips when HUBSPOT_ACCESS_TOKEN is missing", async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    prisma.peDocumentReview.findMany.mockResolvedValue([
      { dealId: "123", docName: "Design Plan", status: "APPROVED", notes: null },
    ]);

    await syncPeDocStatusesToHubSpot(["123"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("logs but does not throw on HubSpot API failure", async () => {
    prisma.peDocumentReview.findMany.mockResolvedValue([
      { dealId: "456", docName: "Design Plan", status: "APPROVED", notes: null },
    ]);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();

    // Should not throw
    await syncPeDocStatusesToHubSpot(["456"]);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage -t "syncPeDocStatusesToHubSpot"`
Expected: FAIL — `syncPeDocStatusesToHubSpot` is not exported yet.

- [ ] **Step 3: Implement `syncPeDocStatusesToHubSpot` in `pe-hubspot-sync.ts`**

Append to `src/lib/pe-hubspot-sync.ts` (note: `prisma` is already imported at the top of the file from Task 1):

```typescript
// ---------------------------------------------------------------------------
// DB → HubSpot push
// ---------------------------------------------------------------------------

export async function syncPeDocStatusesToHubSpot(dealIds: string[]): Promise<void> {
  if (dealIds.length === 0) return;

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.warn("[pe-hubspot-sync] HUBSPOT_ACCESS_TOKEN not set, skipping HubSpot push");
    return;
  }

  const uniqueDealIds = [...new Set(dealIds)];

  // Fetch all doc reviews for these deals
  const rows = await prisma.peDocumentReview.findMany({
    where: { dealId: { in: uniqueDealIds } },
    select: { dealId: true, docName: true, status: true, notes: true },
  });

  // Group by deal
  const byDeal = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byDeal.get(row.dealId) ?? [];
    existing.push(row);
    byDeal.set(row.dealId, existing);
  }

  // Build batch update payload — one entry per deal with all 30 properties
  const inputs: Array<{ id: string; properties: Record<string, string> }> = [];

  for (const [dealId, docs] of byDeal) {
    const properties: Record<string, string> = {};

    for (const doc of docs) {
      const entry = _docNameToEntry.get(doc.docName);
      if (!entry) continue; // skip non-canonical docs (e.g. CSV summary)

      properties[entry.statusProp] = PE_STATUS_TO_HUBSPOT[doc.status] ?? "not_uploaded";
      properties[entry.notesProp] = extractHubSpotNotes(doc.notes ?? "");
    }

    if (Object.keys(properties).length > 0) {
      inputs.push({ id: dealId, properties });
    }
  }

  if (inputs.length === 0) return;

  // Batch update — max 50 deals per call (conservative for 30 props/deal)
  const BATCH_SIZE = 50;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/deals/batch/update",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: batch }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        console.warn(
          `[pe-hubspot-sync] Batch update failed (${res.status}): ${errText.slice(0, 300)}`,
        );
      }
    } catch (err) {
      console.warn(
        `[pe-hubspot-sync] Batch update error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-hubspot-sync.ts src/__tests__/pe-hubspot-sync.test.ts
git commit -m "feat(pe): add syncPeDocStatusesToHubSpot for DB → HubSpot push"
```

---

## Chunk 4: Wire Sync Into Scraper + Webhook Handler + Middleware

### Task 4: Wire `syncPeDocStatusesToHubSpot` into `pe-scraper-sync.ts`

**Files:**
- Modify: `src/lib/pe-scraper-sync.ts` (2 changes: `syncPeDocStatuses` and `syncPeCsvStatuses`)

- [ ] **Step 1: Add import at top of `pe-scraper-sync.ts`**

After the existing imports (around line 24), add:

```typescript
import { syncPeDocStatusesToHubSpot } from "@/lib/pe-hubspot-sync";
```

- [ ] **Step 2: Add HubSpot push at end of `syncPeDocStatuses()`**

In `syncPeDocStatuses()`, after the batch upsert loop ends and before `return result;` (around line 858–860), insert:

```typescript
  // Push updated statuses to HubSpot deal properties (best-effort)
  const upsertedDealIds = [...new Set(ops.map((op) => op.dealId))];
  if (upsertedDealIds.length > 0) {
    try {
      await syncPeDocStatusesToHubSpot(upsertedDealIds);
    } catch (err) {
      console.warn(
        `[pe-scraper-sync] HubSpot push failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
```

- [ ] **Step 3: Add HubSpot push at end of `syncPeCsvStatuses()`**

In `syncPeCsvStatuses()`, after the batch upsert loop ends and before `return result;` (around line 1183–1185), insert:

```typescript
  // Push updated statuses to HubSpot deal properties (best-effort)
  const csvDealIds = [...new Set(ops.map((op) => op.dealId))];
  if (csvDealIds.length > 0) {
    try {
      await syncPeDocStatusesToHubSpot(csvDealIds);
    } catch (err) {
      console.warn(
        `[pe-csv-sync] HubSpot push failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to `pe-scraper-sync.ts` or `pe-hubspot-sync.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-scraper-sync.ts
git commit -m "feat(pe): wire HubSpot push into scraper sync and CSV sync"
```

### Task 5: Add webhook handler + middleware route

**Files:**
- Create: `src/app/api/webhooks/hubspot/pe-doc-status/route.ts`
- Modify: `src/middleware.ts` (add one line to `PUBLIC_API_ROUTES`)
- Modify: `src/lib/pe-hubspot-sync.ts` (add `upsertPeDocFromHubSpot` helper)

- [ ] **Step 1: Add `upsertPeDocFromHubSpot` to `pe-hubspot-sync.ts`**

Append to `src/lib/pe-hubspot-sync.ts`:

```typescript
// ---------------------------------------------------------------------------
// HubSpot → DB (webhook helper with echo suppression)
// ---------------------------------------------------------------------------

export async function upsertPeDocFromHubSpot(
  dealId: string,
  propertyName: string,
  value: string,
): Promise<{ action: "upserted" | "skipped-echo" | "skipped-unknown" }> {
  const isNotes = propertyName.endsWith("_notes");
  const docName = statusPropToDocName(propertyName);

  if (!docName) {
    return { action: "skipped-unknown" };
  }

  if (isNotes) {
    // Notes property — update notes column only
    await prisma.peDocumentReview.upsert({
      where: { dealId_docName: { dealId, docName } },
      create: {
        dealId,
        docName,
        status: PeDocStatus.NOT_UPLOADED,
        notes: value,
        reviewedBy: "hubspot-manual",
        reviewedAt: new Date(),
      },
      update: {
        notes: value,
        reviewedBy: "hubspot-manual",
        reviewedAt: new Date(),
      },
    });
    return { action: "upserted" };
  }

  // Status property — echo suppression check
  const peStatus = HUBSPOT_TO_PE_STATUS[value];
  if (!peStatus) {
    return { action: "skipped-unknown" };
  }

  const existing = await prisma.peDocumentReview.findUnique({
    where: { dealId_docName: { dealId, docName } },
    select: { status: true, reviewedBy: true },
  });

  if (
    existing &&
    existing.status === peStatus &&
    existing.reviewedBy !== "hubspot-manual"
  ) {
    return { action: "skipped-echo" };
  }

  await prisma.peDocumentReview.upsert({
    where: { dealId_docName: { dealId, docName } },
    create: {
      dealId,
      docName,
      status: peStatus,
      reviewedBy: "hubspot-manual",
      reviewedAt: new Date(),
    },
    update: {
      status: peStatus,
      reviewedBy: "hubspot-manual",
      reviewedAt: new Date(),
    },
  });

  return { action: "upserted" };
}
```

- [ ] **Step 1b: Write tests for `upsertPeDocFromHubSpot` (echo suppression)**

Add to `src/__tests__/pe-hubspot-sync.test.ts`:

```typescript
import { upsertPeDocFromHubSpot } from "@/lib/pe-hubspot-sync";

describe("upsertPeDocFromHubSpot", () => {
  const { prisma } = require("@/lib/db");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns skipped-unknown for unrecognized property name", async () => {
    const result = await upsertPeDocFromHubSpot("123", "some_random_prop", "approved");
    expect(result.action).toBe("skipped-unknown");
  });

  test("returns skipped-unknown for unrecognized status value", async () => {
    prisma.peDocumentReview.findUnique = jest.fn().mockResolvedValue(null);
    const result = await upsertPeDocFromHubSpot("123", "pe_doc_design_plan", "bogus_status");
    expect(result.action).toBe("skipped-unknown");
  });

  test("echo suppression: skips when DB status matches and reviewedBy is not hubspot-manual", async () => {
    prisma.peDocumentReview.findUnique = jest.fn().mockResolvedValue({
      status: "APPROVED",
      reviewedBy: "pe-scraper-sync",
    });

    const result = await upsertPeDocFromHubSpot("123", "pe_doc_design_plan", "approved");
    expect(result.action).toBe("skipped-echo");
    expect(prisma.peDocumentReview.upsert).not.toHaveBeenCalled();
  });

  test("echo suppression: does NOT skip when reviewedBy is hubspot-manual (user re-set same value)", async () => {
    prisma.peDocumentReview.findUnique = jest.fn().mockResolvedValue({
      status: "APPROVED",
      reviewedBy: "hubspot-manual",
    });
    prisma.peDocumentReview.upsert = jest.fn().mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot("123", "pe_doc_design_plan", "approved");
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalled();
  });

  test("echo suppression: does NOT skip when status differs", async () => {
    prisma.peDocumentReview.findUnique = jest.fn().mockResolvedValue({
      status: "NOT_UPLOADED",
      reviewedBy: "pe-scraper-sync",
    });
    prisma.peDocumentReview.upsert = jest.fn().mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot("123", "pe_doc_design_plan", "approved");
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalled();
  });

  test("upserts when no existing row (new deal)", async () => {
    prisma.peDocumentReview.findUnique = jest.fn().mockResolvedValue(null);
    prisma.peDocumentReview.upsert = jest.fn().mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot("999", "pe_doc_utility_bill", "uploaded");
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId_docName: { dealId: "999", docName: "Utility Bill" } },
      }),
    );
  });

  test("handles _notes property by updating notes column", async () => {
    prisma.peDocumentReview.upsert = jest.fn().mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot("123", "pe_doc_design_plan_notes", "Manual reviewer comment");
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          notes: "Manual reviewer comment",
          reviewedBy: "hubspot-manual",
        }),
      }),
    );
  });
});
```

- [ ] **Step 1c: Run echo suppression tests to verify they fail, then pass after Step 1**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage -t "upsertPeDocFromHubSpot"`
Expected: All echo suppression tests PASS (implementation was added in Step 1).

- [ ] **Step 2: Create webhook route handler**

Create `src/app/api/webhooks/hubspot/pe-doc-status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { upsertPeDocFromHubSpot } from "@/lib/pe-hubspot-sync";

export const maxDuration = 30;

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Validate HubSpot signature
  const signature = request.headers.get("x-hubspot-signature-v3") ?? "";
  const timestamp = request.headers.get("x-hubspot-request-timestamp") ?? "";

  const validation = validateHubSpotWebhook({
    rawBody,
    signature,
    timestamp,
    requestUrl: request.url,
    method: "POST",
  });

  if (!validation.valid) {
    console.warn(`[pe-doc-webhook] Auth failed: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Return 200 immediately, process in background
  waitUntil(processEvents(events));

  return NextResponse.json({ received: true });
}

async function processEvents(events: HubSpotWebhookEvent[]) {
  for (const event of events) {
    if (!event.propertyName?.startsWith("pe_doc_")) continue;

    const dealId = String(event.objectId);
    const { propertyName, propertyValue } = event;

    try {
      const result = await upsertPeDocFromHubSpot(
        dealId,
        propertyName!,
        propertyValue ?? "",
      );

      if (result.action === "skipped-echo") {
        // Expected during scraper sync — don't log
      } else if (result.action === "upserted") {
        console.log(`[pe-doc-webhook] Upserted ${propertyName} for deal ${dealId}`);
      }
    } catch (err) {
      console.error(
        `[pe-doc-webhook] Failed to process ${propertyName} for deal ${dealId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
```

- [ ] **Step 3: Add webhook route to `PUBLIC_API_ROUTES` in middleware**

In `src/middleware.ts`, add the following line to the `PUBLIC_API_ROUTES` array (after the other HubSpot webhook entries, around line 41):

```typescript
  "/api/webhooks/hubspot/pe-doc-status", // PE doc status webhook — HubSpot signature validated in route
```

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Run full test suite**

Run: `npx jest src/__tests__/pe-hubspot-sync.test.ts --no-coverage`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pe-hubspot-sync.ts src/app/api/webhooks/hubspot/pe-doc-status/route.ts src/middleware.ts
git commit -m "feat(pe): add HubSpot webhook handler for PE doc status changes with echo suppression"
```

---

## Chunk 5: Build Verification + Lint

### Task 6: Full build and lint check

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `npx next lint 2>&1 | tail -10`
Expected: No new errors introduced.

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -20`
Expected: All existing tests still pass. New PE sync tests pass.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean — no type errors.

- [ ] **Step 4: Final commit (if any lint/type fixes needed)**

```bash
git add -A
git commit -m "fix(pe): lint and type fixes for PE HubSpot sync"
```

---

## Rollout Notes (Post-Merge, Manual Steps)

These are not implementation tasks — they happen after the code is deployed:

1. **Run the property creation script:**
   ```bash
   npx tsx scripts/create-pe-doc-properties.ts
   ```

2. **Create HubSpot webhook subscription** via HubSpot developer portal:
   - Event type: `deal.propertyChange`
   - Target URL: `https://pbtechops.com/api/webhooks/hubspot/pe-doc-status`
   - Properties to monitor: all 30 `pe_doc_*` properties

3. **Trigger a PE scraper sync** to backfill existing deals:
   ```bash
   curl -X POST https://pbtechops.com/api/accounting/pe-docs/sync \
     -H "Cookie: <session>" \
     -H "Content-Type: application/json" \
     -d '{"url": "<GCS signed URL for latest_full_report.html>"}'
   ```

4. **Verify in HubSpot**: Open a PE deal → check that the "Participate Energy Documents" property group shows populated statuses.
