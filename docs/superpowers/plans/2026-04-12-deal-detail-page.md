# Deal Detail Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only deal record page at `/dashboards/deals/[pipeline]/[dealId]` that replicates a HubSpot deal inside the suite UI, backed entirely by the Deal mirror (Prisma/Postgres).

**Architecture:** Hybrid server/client — server component fetches deal + pipeline config from Prisma, serializes to a `SerializedDeal` DTO, passes to a client `DealDetailView` component. Two-column layout: collapsible accordion sections (left) + pinned sidebar (right). Pipeline-specific sections driven by a data registry.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, TypeScript 5, Prisma 7, Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-12-deal-detail-page-design.md`

---

## File Structure

```
NEW FILES:
  src/components/deal-detail/types.ts              — SerializedDeal DTO, FieldDef, SectionConfig, TimelineStage interfaces
  src/components/deal-detail/serialize.ts           — serializeDeal() + buildTimelineStages() helpers
  src/components/deal-detail/section-registry.ts    — SECTION_REGISTRY config array + getStageColor()
  src/components/deal-detail/CollapsibleSection.tsx  — generic accordion component
  src/components/deal-detail/FieldGrid.tsx           — 2-column label/value grid
  src/components/deal-detail/DealHeader.tsx           — name, stage badge, pipeline, location, amount
  src/components/deal-detail/MilestoneTimeline.tsx    — horizontal stage progress
  src/components/deal-detail/StatusFlagsBar.tsx       — boolean flag chips
  src/components/deal-detail/DealSidebar.tsx          — pinned right sidebar container
  src/components/deal-detail/TeamCard.tsx              — team members sidebar card
  src/components/deal-detail/EquipmentCard.tsx         — equipment summary sidebar card
  src/components/deal-detail/ContactCard.tsx           — homeowner contact sidebar card
  src/components/deal-detail/ExternalLinksCard.tsx     — outbound links sidebar card
  src/components/deal-detail/QuickActionsCard.tsx      — V2 placeholder sidebar card
  src/app/dashboards/deals/[pipeline]/[dealId]/page.tsx       — server component
  src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx — client component (full layout)
  src/__tests__/deal-detail/serialize.test.ts         — serializeDeal + buildTimelineStages tests
  src/__tests__/deal-detail/section-registry.test.ts  — section registry tests
  src/__tests__/deal-detail/page.test.tsx              — page-level rendering tests

MODIFIED FILES:
  prisma/schema.prisma                           — add 24 new columns (service + roofing fields)
  src/lib/deal-property-map.ts                   — add 24 new property mappings
  src/app/dashboards/deals/DealDetailPanel.tsx   — add "Open full record" link
  src/components/DashboardShell.tsx              — verify /dashboards/deals in SUITE_MAP (likely already present)
```

---

## Chunk 1: Schema & Sync Additions (Service + Roofing Fields)

### Task 1: Add Service Pipeline Columns to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma` (Deal model, after existing fields)

- [ ] **Step 1: Add service columns to Deal model**

Open `prisma/schema.prisma`, find the `model Deal` block. After the last field in the `// Misc` section (`createDate`, around line 2227), before the `// Associations` comment, add:

```prisma
  // Service pipeline
  serviceType              String?
  serviceVisitStatus       String?
  serviceVisitCompleteDate DateTime?
  serviceAgreementId       String?
  serviceRevisitStatus     String?
  serviceIssueResolved     String?
  serviceNotes             String?
  serviceAccountNumber     String?
  serviceRateEquivalent    String?
  serviceDocumentsUrl      String?
  serviceDocumentsFolderId String?
```

- [ ] **Step 2: Add roofing/D&R columns to Deal model**

Immediately after the service columns, add:

```prisma
  // Roofing / D&R pipeline
  roofType              String?
  roofAge               String?
  currentRoofingMaterial String?
  desiredRoofingMaterial String?
  roofColorSelection    String?
  roofingProjectType    String?
  roofingNotes          String?
  roofrFormUrl          String?
  roofrId               String?
  roofrPropertyInfo     String?
  roofrPropertyType     String?
  roofSlope             String?
  roofrGclid            String?
```

- [ ] **Step 3: Generate Prisma client and create migration**

Run:
```bash
npx prisma generate
npx prisma migrate dev --name add-service-roofing-deal-fields
```

Expected: Migration created, Prisma client regenerated with new fields on `Deal` type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/
git commit -m "schema: add service + roofing pipeline fields to Deal model

24 new nullable columns for deal detail page support:
- 11 service fields (type, visit status, agreement, notes, etc.)
- 13 roofing/D&R fields (roof type, age, materials, Roofr integration)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add Property Mappings to deal-property-map.ts

**Files:**
- Modify: `src/lib/deal-property-map.ts` (inside `dealPropertyMap` object)

- [ ] **Step 1: Add service property mappings**

Open `src/lib/deal-property-map.ts`. Inside the `dealPropertyMap` object, after the `// Misc` section (around line 228), add:

```typescript
  // Service pipeline
  service_type: { column: "serviceType", type: "string" },
  service_visit_status: { column: "serviceVisitStatus", type: "string" },
  service_visit_complete_date: { column: "serviceVisitCompleteDate", type: "datetime" },
  service_agreement_id: { column: "serviceAgreementId", type: "string" },
  service_revisit_status: { column: "serviceRevisitStatus", type: "string" },
  service_issue_resolved: { column: "serviceIssueResolved", type: "string" },
  notes_for_service: { column: "serviceNotes", type: "string" },
  service_account_number: { column: "serviceAccountNumber", type: "string" },
  service_rate_equivalent: { column: "serviceRateEquivalent", type: "string" },
  service_documents: { column: "serviceDocumentsUrl", type: "string" },
  service_documents_folder_id: { column: "serviceDocumentsFolderId", type: "string" },
```

- [ ] **Step 2: Add roofing/D&R property mappings**

Immediately after the service mappings, add:

```typescript
  // Roofing / D&R pipeline
  roof_type: { column: "roofType", type: "string" },
  roof_age: { column: "roofAge", type: "string" },
  current_roofing_material: { column: "currentRoofingMaterial", type: "string" },
  desired_roofing_material: { column: "desiredRoofingMaterial", type: "string" },
  roof_color_selection: { column: "roofColorSelection", type: "string" },
  roofing_project_type: { column: "roofingProjectType", type: "string" },
  notes_for_roofing: { column: "roofingNotes", type: "string" },
  roofr_form_url: { column: "roofrFormUrl", type: "string" },
  roofr_id: { column: "roofrId", type: "string" },
  roofr_property_information: { column: "roofrPropertyInfo", type: "string" },
  roofr_property_type: { column: "roofrPropertyType", type: "string" },
  os_roof_slope: { column: "roofSlope", type: "string" },
  roofr_gclid: { column: "roofrGclid", type: "string" },
```

- [ ] **Step 3: Verify the property count increased**

Run:
```bash
grep -c 'column:' src/lib/deal-property-map.ts
```

Expected: Should be ~172 (was ~148 before adding 24 new mappings). Exact count may vary slightly — the key check is that it increased by 24.

- [ ] **Step 4: Run existing deal-reader tests to verify nothing broke**

Run:
```bash
npm test -- --testPathPattern=deal-reader --verbose
```

Expected: All existing tests pass. The new columns are nullable with no default, so existing mock fixtures don't need updating.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-property-map.ts
git commit -m "feat: add service + roofing property mappings to deal-sync

Maps 24 HubSpot properties to new Deal columns for pipeline-specific
detail page sections. All strings/dates, no transforms needed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Types, Serialization, and Section Registry

### Task 3: Create SerializedDeal DTO and Shared Types

**Files:**
- Create: `src/components/deal-detail/types.ts`
- Test: `src/__tests__/deal-detail/serialize.test.ts`

- [ ] **Step 1: Write the test for serializeDeal**

Create `src/__tests__/deal-detail/serialize.test.ts`:

```typescript
/**
 * Tests for serializeDeal() and buildTimelineStages().
 * Verifies Prisma Deal → SerializedDeal type conversion:
 *   Date → ISO string | null
 *   Decimal → number | null
 *   Json (departmentLeads) → parsed object
 */
jest.mock("@/lib/db", () => ({ prisma: null }));

import type { SerializedDeal, TimelineStage } from "@/components/deal-detail/types";
import { serializeDeal, buildTimelineStages } from "@/components/deal-detail/serialize";

const { Decimal } = require("@prisma/client/runtime/client");

const mockDeal = {
  id: "cuid_abc123",
  hubspotDealId: "99999",
  dealName: "Test Solar Project",
  pipeline: "PROJECT",
  stage: "Construction",
  stageId: "stage_123",
  amount: new Decimal("48200.50"),
  pbLocation: "DTC",
  address: "123 Main St",
  city: "Denver",
  state: "CO",
  zipCode: "80202",
  ahj: "Denver",
  utility: "Xcel Energy",
  closeDate: new Date("2026-03-15T00:00:00Z"),
  siteSurveyCompletionDate: new Date("2026-01-15T00:00:00Z"),
  designCompletionDate: new Date("2026-02-03T00:00:00Z"),
  permitIssueDate: new Date("2026-02-28T00:00:00Z"),
  icApprovalDate: new Date("2026-03-10T00:00:00Z"),
  rtbDate: new Date("2026-03-12T00:00:00Z"),
  constructionCompleteDate: null,
  inspectionPassDate: null,
  ptoCompletionDate: null,
  installScheduleDate: new Date("2026-04-08T00:00:00Z"),
  forecastedInstallDate: null,
  forecastedInspectionDate: null,
  forecastedPtoDate: null,
  systemSizeKwdc: new Decimal("12.4"),
  systemSizeKwac: new Decimal("11.2"),
  moduleBrand: "REC",
  moduleModel: "400AA",
  moduleCount: 31,
  moduleWattage: 400,
  moduleName: "REC 400AA Pure-R",
  inverterBrand: "Enphase",
  inverterModel: "IQ8+",
  inverterQty: 31,
  inverterSizeKwac: new Decimal("3.68"),
  inverterName: "Enphase IQ8+",
  batteryBrand: "Enphase",
  batteryModel: "5P",
  batteryCount: 2,
  batterySizeKwh: new Decimal("10.08"),
  batteryName: "Enphase 5P",
  batteryExpansionCount: 0,
  batteryExpansionName: null,
  batteryExpansionModel: null,
  evCount: 0,
  departmentLeads: { design: "Alice", permit_tech: "Bob", interconnections_tech: null, rtb_lead: "Carol" },
  dealOwnerName: "Mike R.",
  projectManager: "Sarah K.",
  operationsManager: "Chris T.",
  siteSurveyor: "Jake M.",
  hubspotOwnerId: "owner_1",
  customerName: "Tom Johnson",
  customerEmail: "tom@email.com",
  customerPhone: "(303) 555-1234",
  companyName: null,
  hubspotContactId: "contact_1",
  hubspotCompanyId: null,
  hubspotUrl: "https://app.hubspot.com/contacts/123/record/0-3/99999",
  driveUrl: "https://drive.google.com/folder/abc",
  designDocumentsUrl: null,
  designFolderUrl: null,
  allDocumentFolderUrl: null,
  openSolarUrl: null,
  openSolarId: null,
  zuperUid: "zuper_xyz",
  lastSyncedAt: new Date("2026-04-12T10:00:00Z"),
  isSiteSurveyScheduled: true,
  isSiteSurveyCompleted: true,
  isDaSent: true,
  isLayoutApproved: true,
  isDesignDrafted: true,
  isDesignCompleted: true,
  isPermitSubmitted: true,
  isPermitIssued: true,
  isIcSubmitted: true,
  isIcApproved: true,
  isInspectionPassed: false,
  hasInspectionFailed: false,
  firstTimeInspectionPass: false,
  hasInspectionFailedNotRejected: false,
  firstTimeInspectionPassNotRejected: false,
  designTurnaroundDays: new Decimal("5.2"),
  permitTurnaroundDays: new Decimal("23.0"),
  projectTurnaroundDays: null,
  // Make the rest of the fields nullable defaults
  siteSurveyScheduleDate: null,
  siteSurveyScheduledDate: null,
  dateReturnedFromDesigners: null,
  designStartDate: null,
  designDraftCompletionDate: null,
  designApprovalSentDate: null,
  layoutApprovalDate: null,
  permitSubmitDate: null,
  icSubmitDate: null,
  inspectionScheduleDate: null,
  inspectionFailDate: null,
  inspectionBookedDate: null,
  ptoStartDate: null,
  dateEnteredCurrentStage: null,
  createDate: null,
  hubspotUpdatedAt: null,
  readyForInspection: null,
  finalInspectionStatus: null,
  inspectionFailCount: null,
  inspectionFailureReason: null,
  installStatus: "In Progress",
  designStatus: "Complete",
  surveyStatus: "Completed",
  permittingStatus: "Issued",
  layoutStatus: "Approved",
  icStatus: "Approved",
  ptoStatus: null,
  isParticipateEnergy: false,
  participateEnergyStatus: null,
  n3ceEvStatus: null,
  n3ceBatteryStatus: null,
  sgipStatus: null,
  pbsrStatus: null,
  cpaStatus: null,
  tags: null,
  projectType: "Residential",
  projectNumber: "PB-2026-042",
  installCrew: "Alpha",
  installDifficulty: 3,
  expectedDaysForInstall: 2,
  daysForInstallers: 2,
  daysForElectricians: 1,
  expectedInstallerCount: 4,
  expectedElectricianCount: 2,
  installNotes: "Ground mount, needs trenching",
  discoReco: null,
  interiorAccess: null,
  siteSurveyDocuments: null,
  systemPerformanceReview: null,
  daRevisionCount: 1,
  asBuiltRevisionCount: 0,
  permitRevisionCount: 0,
  icRevisionCount: 0,
  totalRevisionCount: 1,
  siteSurveyTurnaroundDays: null,
  icTurnaroundDays: null,
  constructionTurnaroundDays: null,
  inspectionTurnaroundDays: null,
  daReadyToSentDays: null,
  daSentToApprovedDays: null,
  timeToSubmitPermitDays: null,
  timeToSubmitIcDays: null,
  daToRtbDays: null,
  rtbToConstructionDays: null,
  ccToPtoDays: null,
  timeToCcDays: null,
  timeToDaDays: null,
  timeToPtoDays: null,
  timeToRtbDays: null,
  rtbToCcDays: null,
  daToCcDays: null,
  daToPermitDays: null,
  // New service/roofing fields default to null
  serviceType: null,
  serviceVisitStatus: null,
  serviceVisitCompleteDate: null,
  serviceAgreementId: null,
  serviceRevisitStatus: null,
  serviceIssueResolved: null,
  serviceNotes: null,
  serviceAccountNumber: null,
  serviceRateEquivalent: null,
  serviceDocumentsUrl: null,
  serviceDocumentsFolderId: null,
  roofType: null,
  roofAge: null,
  currentRoofingMaterial: null,
  desiredRoofingMaterial: null,
  roofColorSelection: null,
  roofingProjectType: null,
  roofingNotes: null,
  roofrFormUrl: null,
  roofrId: null,
  roofrPropertyInfo: null,
  roofrPropertyType: null,
  roofSlope: null,
  roofrGclid: null,
  syncSource: "BATCH",
  rawProperties: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("serializeDeal", () => {
  it("converts Decimal fields to numbers", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.amount).toBe(48200.5);
    expect(result.systemSizeKwdc).toBe(12.4);
    expect(result.systemSizeKwac).toBe(11.2);
    expect(typeof result.amount).toBe("number");
  });

  it("converts Date fields to ISO strings", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.closeDate).toBe("2026-03-15T00:00:00.000Z");
    expect(result.siteSurveyCompletionDate).toBe("2026-01-15T00:00:00.000Z");
    expect(typeof result.closeDate).toBe("string");
  });

  it("converts null Dates to null", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.constructionCompleteDate).toBeNull();
    expect(result.inspectionPassDate).toBeNull();
  });

  it("converts null Decimals to null", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.projectTurnaroundDays).toBeNull();
  });

  it("pre-parses departmentLeads JSON", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.departmentLeads).toEqual({
      design: "Alice",
      permit_tech: "Bob",
      interconnections_tech: null,
      rtb_lead: "Carol",
    });
  });

  it("handles departmentLeads as string JSON", () => {
    const deal = { ...mockDeal, departmentLeads: '{"design":"Eve"}' };
    const result = serializeDeal(deal as any);
    expect(result.departmentLeads).toEqual({ design: "Eve" });
  });

  it("preserves string fields as-is", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.dealName).toBe("Test Solar Project");
    expect(result.pipeline).toBe("PROJECT");
    expect(result.stage).toBe("Construction");
    expect(result.customerName).toBe("Tom Johnson");
  });

  it("preserves boolean fields as-is", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.isSiteSurveyCompleted).toBe(true);
    expect(result.isInspectionPassed).toBe(false);
  });

  it("preserves integer fields as-is", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.moduleCount).toBe(31);
    expect(result.inspectionFailCount).toBeNull();
  });

  it("serializes lastSyncedAt for syncMeta", () => {
    const result = serializeDeal(mockDeal as any);
    expect(result.lastSyncedAt).toBe("2026-04-12T10:00:00.000Z");
  });
});

describe("buildTimelineStages", () => {
  const rawStageOrder = [
    "Site Survey", "Design & Engineering", "Permitting & Interconnection",
    "RTB - Blocked", "Ready To Build", "Construction",
    "Inspection", "Permission To Operate", "Close Out", "Project Complete",
  ];

  // --- PROJECT pipeline: abstract 9-node flow ---
  it("uses abstract 9-node flow for PROJECT (separate Permitting and IC)", () => {
    const serialized = serializeDeal(mockDeal as any);
    const result = buildTimelineStages("PROJECT", rawStageOrder, serialized);
    const labels = result.map(s => s.label);
    expect(labels).toEqual([
      "Survey", "Design", "Permitting", "IC", "RTB",
      "Construction", "Inspection", "PTO", "Complete",
    ]);
  });

  it("marks completed PROJECT stages with dates from milestone map", () => {
    const serialized = serializeDeal(mockDeal as any);
    const result = buildTimelineStages("PROJECT", rawStageOrder, serialized);
    const survey = result.find(s => s.label === "Survey");
    expect(survey?.completedDate).toBe("2026-01-15T00:00:00.000Z");
    const permitting = result.find(s => s.label === "Permitting");
    expect(permitting?.completedDate).toBe("2026-02-28T00:00:00.000Z");
    const ic = result.find(s => s.label === "IC");
    expect(ic?.completedDate).toBe("2026-03-10T00:00:00.000Z");
  });

  it("marks current PROJECT stage via deal.stage substring matching", () => {
    const serialized = serializeDeal(mockDeal as any);
    const result = buildTimelineStages("PROJECT", rawStageOrder, serialized);
    const construction = result.find(s => s.label === "Construction");
    expect(construction?.isCurrent).toBe(true);
    expect(construction?.completedDate).toBeNull();
  });

  it("marks future PROJECT stages without dates", () => {
    const serialized = serializeDeal(mockDeal as any);
    const result = buildTimelineStages("PROJECT", rawStageOrder, serialized);
    const inspection = result.find(s => s.label === "Inspection");
    expect(inspection?.isCurrent).toBe(false);
    expect(inspection?.completedDate).toBeNull();
  });

  // --- SALES pipeline: abbreviation ---
  it("abbreviates SALES when raw stage count > 10", () => {
    const longStages = Array.from({ length: 12 }, (_, i) => `Stage ${i + 1}`);
    const serialized = { ...serializeDeal(mockDeal as any), pipeline: "SALES", stage: "Stage 5" };
    const result = buildTimelineStages("SALES", longStages, serialized);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Stage 5");
    expect(result[0].isCurrent).toBe(true);
  });

  it("renders full SALES timeline when stage count <= 10", () => {
    const shortStages = ["Lead", "Qualified", "Proposal", "Won"];
    const serialized = { ...serializeDeal(mockDeal as any), pipeline: "SALES", stage: "Qualified" };
    const result = buildTimelineStages("SALES", shortStages, serialized);
    expect(result).toHaveLength(4);
    expect(result.map(s => s.label)).toEqual(shortStages);
  });

  // --- Other pipelines: raw stage order ---
  it("uses raw stageOrder for SERVICE pipeline", () => {
    const serviceStages = ["New", "In Progress", "Completed", "Closed Won"];
    const serialized = { ...serializeDeal(mockDeal as any), pipeline: "SERVICE", stage: "In Progress" };
    const result = buildTimelineStages("SERVICE", serviceStages, serialized);
    expect(result.map(s => s.label)).toEqual(serviceStages);
    expect(result.find(s => s.label === "In Progress")?.isCurrent).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- --testPathPattern=deal-detail/serialize --verbose
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create the types file**

Create `src/components/deal-detail/types.ts`:

```typescript
/**
 * Shared types for the deal detail page.
 *
 * SerializedDeal is the client-safe DTO — all Dates become ISO strings,
 * all Decimals become numbers, all Json is pre-parsed.
 * The client NEVER imports Prisma types directly.
 */

/** Department leads parsed from the Json column */
export interface DepartmentLeads {
  design?: string | null;
  permit_tech?: string | null;
  interconnections_tech?: string | null;
  rtb_lead?: string | null;
}

/**
 * Client-safe deal record. Built by serializeDeal() in the server component.
 *
 * Convention:
 *   DateTime? → string | null (ISO 8601)
 *   Decimal?  → number | null
 *   Json      → pre-parsed typed object
 *   String/Int/Boolean → as-is
 */
export interface SerializedDeal {
  // Identity
  id: string;
  hubspotDealId: string;
  dealName: string;
  pipeline: string;
  stage: string;
  stageId: string;
  amount: number | null;

  // Location
  pbLocation: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  ahj: string | null;
  utility: string | null;

  // Team
  hubspotOwnerId: string | null;
  dealOwnerName: string | null;
  projectManager: string | null;
  operationsManager: string | null;
  siteSurveyor: string | null;
  departmentLeads: DepartmentLeads;

  // Contact (association-derived)
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  companyName: string | null;
  hubspotContactId: string | null;
  hubspotCompanyId: string | null;

  // External links
  hubspotUrl: string | null;
  driveUrl: string | null;
  designDocumentsUrl: string | null;
  designFolderUrl: string | null;
  allDocumentFolderUrl: string | null;
  openSolarUrl: string | null;
  openSolarId: string | null;
  zuperUid: string | null;

  // Sync
  lastSyncedAt: string | null;

  // All remaining fields accessed dynamically by the section registry
  [key: string]: unknown;
}

/** A single field rendered in a CollapsibleSection grid */
export interface FieldDef {
  label: string;
  value: string | number | boolean | null;
  format?: "date" | "money" | "decimal" | "days" | "boolean" | "status";
}

/** Section registry entry — maps pipeline to UI sections */
export interface SectionConfig {
  key: string;
  title: string;
  defaultOpen: boolean;
  pipelines: string[] | "all";
  fields: (deal: SerializedDeal) => FieldDef[];
}

/** A stage in the milestone timeline */
export interface TimelineStage {
  key: string;
  label: string;
  completedDate: string | null;
  isCurrent: boolean;
}
```

- [ ] **Step 4: Create the serialize helper**

Create `src/components/deal-detail/serialize.ts`:

```typescript
/**
 * Server-side serialization: Prisma Deal → SerializedDeal DTO.
 * Handles Decimal → number, Date → ISO string, Json → parsed object.
 * Called in page.tsx before passing props to the client component.
 */

import type { Deal as PrismaDeal } from "@/generated/prisma/client";
import type { SerializedDeal, DepartmentLeads, TimelineStage } from "./types";

// --- Helpers ---

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

function parseDepartmentLeads(value: unknown): DepartmentLeads {
  if (!value) return {};
  if (typeof value === "object" && !(value instanceof Date)) {
    return value as DepartmentLeads;
  }
  try {
    return JSON.parse(String(value)) as DepartmentLeads;
  } catch {
    return {};
  }
}

// --- Date fields on the Deal model (exhaustive list) ---
const DATE_FIELDS = new Set([
  "closeDate", "siteSurveyScheduleDate", "siteSurveyScheduledDate",
  "siteSurveyCompletionDate", "dateReturnedFromDesigners", "designStartDate",
  "designDraftCompletionDate", "designCompletionDate", "designApprovalSentDate",
  "layoutApprovalDate", "permitSubmitDate", "permitIssueDate",
  "icSubmitDate", "icApprovalDate", "rtbDate", "installScheduleDate",
  "constructionCompleteDate", "inspectionScheduleDate", "inspectionPassDate",
  "inspectionFailDate", "inspectionBookedDate", "ptoStartDate", "ptoCompletionDate",
  "forecastedInstallDate", "forecastedInspectionDate", "forecastedPtoDate",
  "dateEnteredCurrentStage", "createDate", "hubspotUpdatedAt", "lastSyncedAt",
  "serviceVisitCompleteDate",
  "createdAt", "updatedAt",
]);

// --- Decimal fields on the Deal model (exhaustive list) ---
const DECIMAL_FIELDS = new Set([
  "amount", "systemSizeKwdc", "systemSizeKwac", "inverterSizeKwac", "batterySizeKwh",
  "siteSurveyTurnaroundDays", "designTurnaroundDays", "permitTurnaroundDays",
  "icTurnaroundDays", "constructionTurnaroundDays", "projectTurnaroundDays",
  "inspectionTurnaroundDays", "daReadyToSentDays", "daSentToApprovedDays",
  "timeToSubmitPermitDays", "timeToSubmitIcDays", "daToRtbDays",
  "rtbToConstructionDays", "ccToPtoDays", "timeToCcDays", "timeToDaDays",
  "timeToPtoDays", "timeToRtbDays", "rtbToCcDays", "daToCcDays", "daToPermitDays",
]);

// --- Fields to skip (Prisma relations, raw JSON blob) ---
const SKIP_FIELDS = new Set(["syncLogs", "rawProperties"]);

/**
 * Convert a Prisma Deal to a client-safe SerializedDeal.
 * All Dates → ISO strings, all Decimals → numbers, departmentLeads → parsed.
 */
export function serializeDeal(deal: PrismaDeal): SerializedDeal {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(deal)) {
    if (SKIP_FIELDS.has(key)) continue;

    if (key === "departmentLeads") {
      result[key] = parseDepartmentLeads(value);
    } else if (DATE_FIELDS.has(key)) {
      result[key] = dateToIso(value);
    } else if (DECIMAL_FIELDS.has(key)) {
      result[key] = decimalToNumber(value);
    } else {
      result[key] = value;
    }
  }

  return result as SerializedDeal;
}

// --- Project pipeline: abstract 9-node flow ---
// The spec requires separate Permitting and IC nodes, not the combined
// "Permitting & Interconnection" from HubSpot's raw stage list.
const PROJECT_ABSTRACT_STAGES: { label: string; dateField: string | null; stageMatch: string }[] = [
  { label: "Survey",      dateField: "siteSurveyCompletionDate", stageMatch: "survey" },
  { label: "Design",      dateField: "designCompletionDate",     stageMatch: "design" },
  { label: "Permitting",  dateField: "permitIssueDate",          stageMatch: "permitting" },
  { label: "IC",          dateField: "icApprovalDate",           stageMatch: "interconnection" },
  { label: "RTB",         dateField: "rtbDate",                  stageMatch: "ready to build" },
  { label: "Construction",dateField: "constructionCompleteDate", stageMatch: "construction" },
  { label: "Inspection",  dateField: "inspectionPassDate",       stageMatch: "inspection" },
  { label: "PTO",         dateField: "ptoCompletionDate",        stageMatch: "permission to operate" },
  { label: "Complete",    dateField: null,                       stageMatch: "complete" },
];

/**
 * Build the milestone timeline stages — pipeline-aware.
 *
 * - PROJECT: Uses abstract 9-node flow (separate Permitting + IC).
 *   Current stage matched by substring against deal.stage.
 * - SALES: If >10 raw stages, collapses to single current-stage indicator.
 * - Others (D&R, Service, Roofing): Uses raw DealPipelineConfig stage order.
 */
export function buildTimelineStages(
  pipeline: string,
  stageOrder: string[],
  deal: SerializedDeal,
): TimelineStage[] {
  // --- PROJECT: abstract 9-node flow ---
  if (pipeline === "PROJECT") {
    const dealStageLower = (deal.stage ?? "").toLowerCase();
    return PROJECT_ABSTRACT_STAGES.map((s) => ({
      key: s.label.toLowerCase().replace(/\s+/g, "-"),
      label: s.label,
      completedDate: s.dateField
        ? (deal[s.dateField] as string | null) ?? null
        : null,
      isCurrent: dealStageLower.includes(s.stageMatch),
    }));
  }

  // --- SALES: abbreviate if >10 stages ---
  if (pipeline === "SALES" && stageOrder.length > 10) {
    return [{
      key: deal.stage?.toLowerCase().replace(/\s+/g, "-") ?? "unknown",
      label: deal.stage ?? "Unknown",
      completedDate: null,
      isCurrent: true,
    }];
  }

  // --- Default: raw DealPipelineConfig stage order ---
  return stageOrder.map((stageName) => ({
    key: stageName.toLowerCase().replace(/\s+/g, "-"),
    label: stageName,
    completedDate: null, // non-project pipelines don't have milestone date mappings yet
    isCurrent: deal.stage === stageName,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npm test -- --testPathPattern=deal-detail/serialize --verbose
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/deal-detail/types.ts src/components/deal-detail/serialize.ts src/__tests__/deal-detail/serialize.test.ts
git commit -m "feat(deal-detail): add SerializedDeal DTO and serialization helpers

- SerializedDeal interface with typed fields + index signature escape hatch
- serializeDeal() converts Prisma Deal (Decimal/Date/Json) to client-safe DTO
- buildTimelineStages() maps DealPipelineConfig stage order to timeline props
- parseDepartmentLeads() extracted as shared helper
- Full test coverage for type conversions and timeline building

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Create Section Registry and Stage Color Helper

**Files:**
- Create: `src/components/deal-detail/section-registry.ts`
- Test: `src/__tests__/deal-detail/section-registry.test.ts`

- [ ] **Step 1: Write failing tests for section registry**

Create `src/__tests__/deal-detail/section-registry.test.ts`:

```typescript
jest.mock("@/lib/db", () => ({ prisma: null }));

import { getSectionsForPipeline, getStageColor } from "@/components/deal-detail/section-registry";
import { STAGE_COLORS } from "@/lib/constants";

describe("getSectionsForPipeline", () => {
  it("returns all 'all' sections plus project-specific for PROJECT", () => {
    const sections = getSectionsForPipeline("PROJECT");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("project-details");
    expect(keys).toContain("milestone-dates");
    expect(keys).toContain("status-details");
    expect(keys).toContain("qc-metrics");
    expect(keys).not.toContain("service-details");
    expect(keys).not.toContain("roofing-details");
  });

  it("includes service-details for SERVICE pipeline", () => {
    const sections = getSectionsForPipeline("SERVICE");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("service-details");
    expect(keys).toContain("project-details");
  });

  it("includes roofing-details for DNR pipeline", () => {
    const sections = getSectionsForPipeline("DNR");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("roofing-details");
  });

  it("includes roofing-details for ROOFING pipeline", () => {
    const sections = getSectionsForPipeline("ROOFING");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("roofing-details");
  });

  it("returns at least project-details for SALES pipeline", () => {
    const sections = getSectionsForPipeline("SALES");
    const keys = sections.map(s => s.key);
    expect(keys).toContain("project-details");
  });

  it("returns correct default open states", () => {
    const sections = getSectionsForPipeline("PROJECT");
    const projectDetails = sections.find(s => s.key === "project-details");
    const qcMetrics = sections.find(s => s.key === "qc-metrics");
    expect(projectDetails?.defaultOpen).toBe(true);
    expect(qcMetrics?.defaultOpen).toBe(false);
  });
});

describe("getStageColor", () => {
  it("returns known color for project pipeline stages", () => {
    const color = getStageColor("PROJECT", "Construction", []);
    expect(color).toBe(STAGE_COLORS["Construction"].hex);
  });

  it("returns fallback zinc for unknown project stage", () => {
    const color = getStageColor("PROJECT", "Unknown Stage", []);
    expect(color).toBe("#71717A");
  });

  it("returns position-based color for non-project pipeline", () => {
    const stageOrder = ["Step 1", "Step 2", "Step 3", "Closed Won", "Closed Lost"];
    const color1 = getStageColor("SERVICE", "Step 1", stageOrder);
    const color2 = getStageColor("SERVICE", "Step 3", stageOrder);
    // Early stages are cool (blue), later are warm (orange)
    expect(color1).toBeDefined();
    expect(color2).toBeDefined();
    expect(color1).not.toBe(color2);
  });

  it("returns green for terminal won stages", () => {
    const stageOrder = ["Active", "Closed Won", "Closed Lost"];
    const color = getStageColor("SERVICE", "Closed Won", stageOrder);
    expect(color).toBe("#22C55E"); // green-500
  });

  it("returns gray for terminal lost stages", () => {
    const stageOrder = ["Active", "Closed Won", "Closed Lost"];
    const color = getStageColor("SERVICE", "Closed Lost", stageOrder);
    expect(color).toBe("#71717A"); // zinc-500
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- --testPathPattern=deal-detail/section-registry --verbose
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement section-registry.ts**

Create `src/components/deal-detail/section-registry.ts`:

```typescript
/**
 * Section registry — data-driven config mapping pipelines to UI sections.
 * Each section defines which fields to render from a SerializedDeal.
 * Adding a new section = adding an entry here. No component changes needed.
 */

import type { SerializedDeal, FieldDef, SectionConfig } from "./types";
import { STAGE_COLORS } from "@/lib/constants";

// --- Helper: shorthand field builder ---

function f(label: string, key: string, format?: FieldDef["format"]): FieldDef & { _key: string } {
  return { label, value: null, format, _key: key } as any;
}

function resolveFields(
  defs: ReturnType<typeof f>[],
  deal: SerializedDeal,
): FieldDef[] {
  return defs.map(({ label, format, _key }) => ({
    label,
    value: (deal[_key] as FieldDef["value"]) ?? null,
    format,
  }));
}

// --- Section Registry ---

export const SECTION_REGISTRY: SectionConfig[] = [
  // 1. Project Details (all pipelines)
  {
    key: "project-details",
    title: "Project Details",
    defaultOpen: true,
    pipelines: "all",
    fields: (deal) =>
      resolveFields(
        [
          f("Address", "address"),
          f("City", "city"),
          f("State", "state"),
          f("Zip Code", "zipCode"),
          f("AHJ", "ahj"),
          f("Utility", "utility"),
          f("Location", "pbLocation"),
          f("Amount", "amount", "money"),
          f("Close Date", "closeDate", "date"),
          f("Project Type", "projectType"),
          f("Project Number", "projectNumber"),
          f("System Size (DC)", "systemSizeKwdc", "decimal"),
          f("System Size (AC)", "systemSizeKwac", "decimal"),
        ],
        deal,
      ),
  },

  // 2. Milestone Dates (all pipelines)
  {
    key: "milestone-dates",
    title: "Milestone Dates",
    defaultOpen: true,
    pipelines: "all",
    fields: (deal) =>
      resolveFields(
        [
          // Survey
          f("Survey Scheduled", "siteSurveyScheduleDate", "date"),
          f("Survey Scheduled Date", "siteSurveyScheduledDate", "date"),
          f("Survey Completed", "siteSurveyCompletionDate", "date"),
          // Design
          f("Returned From Designers", "dateReturnedFromDesigners", "date"),
          f("Design Start", "designStartDate", "date"),
          f("Design Draft Completed", "designDraftCompletionDate", "date"),
          f("Design Completed", "designCompletionDate", "date"),
          f("Design Approval Sent", "designApprovalSentDate", "date"),
          f("Layout Approved", "layoutApprovalDate", "date"),
          // Permitting
          f("Permit Submitted", "permitSubmitDate", "date"),
          f("Permit Issued", "permitIssueDate", "date"),
          // IC
          f("IC Submitted", "icSubmitDate", "date"),
          f("IC Approved", "icApprovalDate", "date"),
          // Construction
          f("RTB Date", "rtbDate", "date"),
          f("Install Scheduled", "installScheduleDate", "date"),
          f("Construction Complete", "constructionCompleteDate", "date"),
          // Inspection
          f("Inspection Scheduled", "inspectionScheduleDate", "date"),
          f("Inspection Booked", "inspectionBookedDate", "date"),
          f("Inspection Passed", "inspectionPassDate", "date"),
          f("Inspection Failed", "inspectionFailDate", "date"),
          f("Close Date", "closeDate", "date"),
          // PTO
          f("PTO Started", "ptoStartDate", "date"),
          f("PTO Completed", "ptoCompletionDate", "date"),
          // Forecasted
          f("Forecasted Install", "forecastedInstallDate", "date"),
          f("Forecasted Inspection", "forecastedInspectionDate", "date"),
          f("Forecasted PTO", "forecastedPtoDate", "date"),
          // Other
          f("Created", "createDate", "date"),
        ],
        deal,
      ),
  },

  // 3. Status Details (Project only)
  {
    key: "status-details",
    title: "Status Details",
    defaultOpen: true,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("Survey Status", "surveyStatus", "status"),
          f("Design Status", "designStatus", "status"),
          f("Layout Status", "layoutStatus", "status"),
          f("Permitting Status", "permittingStatus", "status"),
          f("IC Status", "icStatus", "status"),
          f("Install Status", "installStatus", "status"),
          f("Final Inspection", "finalInspectionStatus", "status"),
          f("PTO Status", "ptoStatus", "status"),
          f("Ready for Inspection", "readyForInspection"),
          f("Inspection Fail Count", "inspectionFailCount"),
          f("Inspection Failure Reason", "inspectionFailureReason"),
          f("Participate Energy Status", "participateEnergyStatus", "status"),
        ],
        deal,
      ),
  },

  // 4. Install Planning (Project only)
  {
    key: "install-planning",
    title: "Install Planning",
    defaultOpen: false,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("Install Crew", "installCrew"),
          f("Difficulty", "installDifficulty"),
          f("Expected Days", "expectedDaysForInstall"),
          f("Days for Installers", "daysForInstallers"),
          f("Days for Electricians", "daysForElectricians"),
          f("Expected Installers", "expectedInstallerCount"),
          f("Expected Electricians", "expectedElectricianCount"),
          f("Install Notes", "installNotes"),
        ],
        deal,
      ),
  },

  // 5. Revision Counts (Project only)
  {
    key: "revision-counts",
    title: "Revision Counts",
    defaultOpen: false,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("DA Revisions", "daRevisionCount"),
          f("As-Built Revisions", "asBuiltRevisionCount"),
          f("Permit Revisions", "permitRevisionCount"),
          f("IC Revisions", "icRevisionCount"),
          f("Total Revisions", "totalRevisionCount"),
        ],
        deal,
      ),
  },

  // 6. QC Turnaround Metrics (Project only)
  {
    key: "qc-metrics",
    title: "QC Turnaround Metrics",
    defaultOpen: false,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("Survey Turnaround", "siteSurveyTurnaroundDays", "days"),
          f("Design Turnaround", "designTurnaroundDays", "days"),
          f("Permit Turnaround", "permitTurnaroundDays", "days"),
          f("IC Turnaround", "icTurnaroundDays", "days"),
          f("Construction Turnaround", "constructionTurnaroundDays", "days"),
          f("Inspection Turnaround", "inspectionTurnaroundDays", "days"),
          f("Project Turnaround", "projectTurnaroundDays", "days"),
          f("DA Ready → Sent", "daReadyToSentDays", "days"),
          f("DA Sent → Approved", "daSentToApprovedDays", "days"),
          f("Time to Submit Permit", "timeToSubmitPermitDays", "days"),
          f("Time to Submit IC", "timeToSubmitIcDays", "days"),
          f("DA → RTB", "daToRtbDays", "days"),
          f("RTB → Construction", "rtbToConstructionDays", "days"),
          f("CC → PTO", "ccToPtoDays", "days"),
          f("Time to CC", "timeToCcDays", "days"),
          f("Time to DA", "timeToDaDays", "days"),
          f("Time to PTO", "timeToPtoDays", "days"),
          f("Time to RTB", "timeToRtbDays", "days"),
          f("RTB → CC", "rtbToCcDays", "days"),
          f("DA → CC", "daToCcDays", "days"),
          f("DA → Permit", "daToPermitDays", "days"),
        ],
        deal,
      ),
  },

  // 7. Incentive Programs (Project only)
  {
    key: "incentive-programs",
    title: "Incentive Programs",
    defaultOpen: false,
    pipelines: ["PROJECT"],
    fields: (deal) =>
      resolveFields(
        [
          f("N3CE EV Status", "n3ceEvStatus", "status"),
          f("N3CE Battery Status", "n3ceBatteryStatus", "status"),
          f("SGIP Status", "sgipStatus", "status"),
          f("PBSR Status", "pbsrStatus", "status"),
          f("CPA Status", "cpaStatus", "status"),
          f("Participate Energy Status", "participateEnergyStatus", "status"),
          f("Is Participate Energy", "isParticipateEnergy", "boolean"),
        ],
        deal,
      ),
  },

  // 8. Service Details (Service only)
  {
    key: "service-details",
    title: "Service Details",
    defaultOpen: true,
    pipelines: ["SERVICE"],
    fields: (deal) =>
      resolveFields(
        [
          f("Service Type", "serviceType"),
          f("Visit Status", "serviceVisitStatus", "status"),
          f("Visit Complete Date", "serviceVisitCompleteDate", "date"),
          f("Revisit Status", "serviceRevisitStatus", "status"),
          f("Issue Resolved", "serviceIssueResolved"),
          f("Account Number", "serviceAccountNumber"),
          f("Agreement ID", "serviceAgreementId"),
          f("Rate Equivalent", "serviceRateEquivalent"),
          f("Service Notes", "serviceNotes"),
        ],
        deal,
      ),
  },

  // 9. Roofing Details (D&R + Roofing)
  {
    key: "roofing-details",
    title: "Roofing Details",
    defaultOpen: true,
    pipelines: ["DNR", "ROOFING"],
    fields: (deal) =>
      resolveFields(
        [
          f("Roof Type", "roofType"),
          f("Roof Age", "roofAge"),
          f("Current Material", "currentRoofingMaterial"),
          f("Desired Material", "desiredRoofingMaterial"),
          f("Color Selection", "roofColorSelection"),
          f("Project Type", "roofingProjectType"),
          f("Roof Slope", "roofSlope"),
          f("Roofing Notes", "roofingNotes"),
        ],
        deal,
      ),
  },
];

// --- Pipeline filtering ---

export function getSectionsForPipeline(pipeline: string): SectionConfig[] {
  return SECTION_REGISTRY.filter(
    (s) => s.pipelines === "all" || s.pipelines.includes(pipeline),
  );
}

// --- Stage colors ---

/** Position-based color ramp for non-project pipelines */
const POSITION_PALETTE = [
  "#3B82F6", // blue-500
  "#6366F1", // indigo-500
  "#8B5CF6", // violet-500
  "#A855F7", // purple-500
  "#F97316", // orange-500
  "#F59E0B", // amber-500
  "#EAB308", // yellow-500
];

export function getStageColor(
  pipeline: string,
  stage: string,
  stageOrder: string[],
): string {
  // Project pipeline: use known STAGE_COLORS
  if (pipeline === "PROJECT") {
    const entry = STAGE_COLORS[stage];
    return entry?.hex ?? "#71717A";
  }

  // Terminal stage detection
  const lower = stage.toLowerCase();
  if (lower.includes("closed won") || lower.includes("complete")) return "#22C55E";
  if (lower.includes("closed lost") || lower.includes("cancelled")) return "#71717A";

  // Position-based color ramp
  const idx = stageOrder.indexOf(stage);
  if (idx < 0) return "#71717A";
  const paletteIdx = Math.round((idx / Math.max(stageOrder.length - 1, 1)) * (POSITION_PALETTE.length - 1));
  return POSITION_PALETTE[paletteIdx] ?? "#71717A";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- --testPathPattern=deal-detail/section-registry --verbose
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/deal-detail/section-registry.ts src/__tests__/deal-detail/section-registry.test.ts
git commit -m "feat(deal-detail): add section registry and pipeline-aware stage colors

- SECTION_REGISTRY with 9 sections covering all 5 pipelines
- getSectionsForPipeline() filters by pipeline enum
- getStageColor() reuses STAGE_COLORS for project, position-based for others
- Terminal stage detection (won=green, lost=gray)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: UI Components (Primitives)

### Task 5: CollapsibleSection and FieldGrid

**Files:**
- Create: `src/components/deal-detail/CollapsibleSection.tsx`
- Create: `src/components/deal-detail/FieldGrid.tsx`

- [ ] **Step 1: Create CollapsibleSection component**

Create `src/components/deal-detail/CollapsibleSection.tsx`:

```tsx
"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  fieldCount: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  fieldCount,
  defaultOpen,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-t-lg bg-surface-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/80"
        style={!isOpen ? { borderRadius: "0.5rem" } : undefined}
      >
        <span className="text-xs font-semibold text-foreground">
          {isOpen ? "▼" : "▶"} {title}
        </span>
        <span className="text-[10px] text-muted">{fieldCount} fields</span>
      </button>
      {isOpen && (
        <div className="rounded-b-lg bg-surface-2/30 p-3">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create FieldGrid component**

Create `src/components/deal-detail/FieldGrid.tsx`:

```tsx
import type { FieldDef } from "./types";
import { formatMoney } from "@/lib/format";

function formatFieldValue(field: FieldDef): string {
  if (field.value === null || field.value === undefined || field.value === "") {
    return "—";
  }

  switch (field.format) {
    case "date": {
      const d = new Date(String(field.value));
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    case "money":
      return formatMoney(Number(field.value));
    case "decimal":
      return String(Number(field.value).toFixed(1));
    case "days": {
      const n = Number(field.value);
      return Number.isFinite(n) ? `${n.toFixed(1)} days` : "—";
    }
    case "boolean":
      return field.value ? "Yes" : "No";
    case "status":
      return String(field.value);
    default:
      return String(field.value);
  }
}

function statusColor(field: FieldDef): string | undefined {
  if (field.format !== "status" || !field.value) return undefined;
  const v = String(field.value).toLowerCase();
  if (["complete", "completed", "issued", "approved", "passed"].some(k => v.includes(k))) {
    return "#22C55E";
  }
  if (["in progress", "pending", "submitted", "scheduled"].some(k => v.includes(k))) {
    return "#F97316";
  }
  return undefined;
}

interface FieldGridProps {
  fields: FieldDef[];
}

export default function FieldGrid({ fields }: FieldGridProps) {
  return (
    <div className="stagger-grid grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map((field) => {
        const color = statusColor(field);
        return (
          <div key={field.label}>
            <div className="text-[9px] uppercase tracking-wider text-muted">
              {field.label}
            </div>
            <div className="text-sm text-foreground" style={color ? { color } : undefined}>
              {color && field.value ? "● " : ""}
              {formatFieldValue(field)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/deal-detail/CollapsibleSection.tsx src/components/deal-detail/FieldGrid.tsx
git commit -m "feat(deal-detail): add CollapsibleSection and FieldGrid primitives

- CollapsibleSection: accordion with open/closed state, field count badge
- FieldGrid: 2-column label/value grid with format-aware rendering
  (date, money, decimal, days, boolean, status with color dots)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: DealHeader, MilestoneTimeline, StatusFlagsBar

**Files:**
- Create: `src/components/deal-detail/DealHeader.tsx`
- Create: `src/components/deal-detail/MilestoneTimeline.tsx`
- Create: `src/components/deal-detail/StatusFlagsBar.tsx`

- [ ] **Step 1: Create DealHeader component**

Create `src/components/deal-detail/DealHeader.tsx`. Renders:
- Deal name (`text-lg font-semibold`)
- Stage badge (colored pill via `getStageColor()`)
- Pipeline label (muted)
- Location (muted)
- Amount (green, `formatMoney()`)
- "Open in HubSpot" external link button (orange accent)

Props: `{ deal: SerializedDeal; stageColor: string }`

- [ ] **Step 2: Create MilestoneTimeline component**

Create `src/components/deal-detail/MilestoneTimeline.tsx`. Renders:
- Horizontal flexbox of stage nodes with connecting lines
- Three visual states: completed (green ✓), current (orange ● with glow), future (gray ○)
- Completion date below each node
- Responsive: `overflow-x-auto` with `min-width` on inner container

Props: `{ stages: TimelineStage[] }`

- [ ] **Step 3: Create StatusFlagsBar component**

Create `src/components/deal-detail/StatusFlagsBar.tsx`. Renders:
- Horizontal wrapping row of status chips
- Three visual states: true (green ✓), false-relevant (orange ◌), false-future (gray —)
- Relevance determined by comparing flag's associated stage to current stage position

Props: `{ deal: SerializedDeal; stageOrder: string[] }`

Boolean flags to show (Project pipeline) with their associated stage for relevance logic:

```typescript
const PROJECT_FLAGS: { key: string; label: string; stage: string }[] = [
  { key: "isSiteSurveyScheduled", label: "Survey Scheduled", stage: "Site Survey" },
  { key: "isSiteSurveyCompleted", label: "Survey Completed", stage: "Site Survey" },
  { key: "isDaSent", label: "DA Sent", stage: "Design & Engineering" },
  { key: "isLayoutApproved", label: "Layout Approved", stage: "Design & Engineering" },
  { key: "isDesignDrafted", label: "Design Drafted", stage: "Design & Engineering" },
  { key: "isDesignCompleted", label: "Design Completed", stage: "Design & Engineering" },
  { key: "isPermitSubmitted", label: "Permit Submitted", stage: "Permitting & Interconnection" },
  { key: "isPermitIssued", label: "Permit Issued", stage: "Permitting & Interconnection" },
  { key: "isIcSubmitted", label: "IC Submitted", stage: "Permitting & Interconnection" },
  { key: "isIcApproved", label: "IC Approved", stage: "Permitting & Interconnection" },
  { key: "isInspectionPassed", label: "Inspection Passed", stage: "Inspection" },
  { key: "hasInspectionFailed", label: "Inspection Failed", stage: "Inspection" },
];
```

A flag is "relevant" (orange when false) if its stage index in `stageOrder` is ≤ the current stage index. Otherwise it's "future" (gray when false).

Other pipelines: omit the bar if no boolean flags are defined (return `null`).

- [ ] **Step 4: Commit**

```bash
git add src/components/deal-detail/DealHeader.tsx src/components/deal-detail/MilestoneTimeline.tsx src/components/deal-detail/StatusFlagsBar.tsx
git commit -m "feat(deal-detail): add above-the-fold components

- DealHeader: name, stage badge, pipeline, location, amount, HubSpot link
- MilestoneTimeline: horizontal pipeline progress (complete/current/future)
- StatusFlagsBar: boolean flag chips with stage-aware relevance coloring

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Sidebar Cards

**Files:**
- Create: `src/components/deal-detail/DealSidebar.tsx`
- Create: `src/components/deal-detail/TeamCard.tsx`
- Create: `src/components/deal-detail/EquipmentCard.tsx`
- Create: `src/components/deal-detail/ContactCard.tsx`
- Create: `src/components/deal-detail/ExternalLinksCard.tsx`
- Create: `src/components/deal-detail/QuickActionsCard.tsx`

- [ ] **Step 1: Create DealSidebar container**

Create `src/components/deal-detail/DealSidebar.tsx`:
- Sticky container (`sticky top-16`)
- Renders children (the individual cards)
- `bg-surface/50` background, padding, flex column with gap

Props: `{ children: React.ReactNode }`

- [ ] **Step 2: Create TeamCard**

Create `src/components/deal-detail/TeamCard.tsx`. Fields from spec:
- Owner, PM, Ops Manager, Surveyor, Design Lead, Permit Tech, IC Tech, RTB Lead
- Parses `deal.departmentLeads` for the lead fields
- All fields show "—" if empty

Props: `{ deal: SerializedDeal }`

- [ ] **Step 3: Create EquipmentCard**

Create `src/components/deal-detail/EquipmentCard.tsx`. Fields from spec:
- Module: brand + model (×count)
- Inverter: brand + model (×qty)
- Battery: brand + model (×count)
- Battery Expansion: only if count > 0
- EV Charger: "×{count}" or "—"
- System Size: DC / AC

Props: `{ deal: SerializedDeal }`

- [ ] **Step 4: Create ContactCard**

Create `src/components/deal-detail/ContactCard.tsx`. Fields from spec:
- Name: `deal.customerName`
- Email: clickable `mailto:` link
- Phone: clickable `tel:` link
- Company: `deal.companyName`
- HubSpot Contact: link using `deal.hubspotContactId` (hidden if null)

Props: `{ deal: SerializedDeal }`

- [ ] **Step 5: Create ExternalLinksCard**

Create `src/components/deal-detail/ExternalLinksCard.tsx`. Links from spec:
- **HubSpot Record:** `deal.hubspotUrl`
- **Zuper Job:** `https://app.zuper.co/app/job-detail/${deal.zuperUid}` (only if `zuperUid` exists)
- **Google Drive:** `deal.driveUrl`
- **Design Folder:** `deal.designDocumentsUrl || deal.designFolderUrl || deal.allDocumentFolderUrl` (fallback chain — use first non-null)
- **OpenSolar:** `deal.openSolarUrl`
- Only show links that have values (hide empty — exception to "—" rule)
- All open in new tab (`target="_blank" rel="noopener noreferrer"`)

Props: `{ deal: SerializedDeal }`

- [ ] **Step 6: Create QuickActionsCard**

Create `src/components/deal-detail/QuickActionsCard.tsx`:
- Dashed-border placeholder
- Muted text: "Edit fields, sync to HubSpot, schedule..."
- V2 placeholder

No props needed.

- [ ] **Step 7: Commit**

```bash
git add src/components/deal-detail/DealSidebar.tsx src/components/deal-detail/TeamCard.tsx src/components/deal-detail/EquipmentCard.tsx src/components/deal-detail/ContactCard.tsx src/components/deal-detail/ExternalLinksCard.tsx src/components/deal-detail/QuickActionsCard.tsx
git commit -m "feat(deal-detail): add sidebar cards

- DealSidebar: sticky container
- TeamCard: owner, PM, ops mgr, surveyor, 4 dept leads
- EquipmentCard: module/inverter/battery/EV summary
- ContactCard: name, email (mailto), phone (tel), company, HubSpot link
- ExternalLinksCard: HubSpot, Zuper, Drive, Design, OpenSolar (hides empty)
- QuickActionsCard: V2 placeholder with dashed border

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: Page Assembly and Entry Point

### Task 8: Server Component (page.tsx)

**Files:**
- Create: `src/app/dashboards/deals/[pipeline]/[dealId]/page.tsx`

- [ ] **Step 1: Create the server component**

Create `src/app/dashboards/deals/[pipeline]/[dealId]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { serializeDeal, buildTimelineStages } from "@/components/deal-detail/serialize";
import { formatStaleness } from "@/lib/deal-sync";
import DealDetailView from "./DealDetailView";

// Stored stage shape from DealPipelineConfig.stages Json column
type StoredStage = { id: string; name: string; displayOrder: number; isActive: boolean };

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ pipeline: string; dealId: string }>;
}) {
  const { pipeline, dealId } = await params;

  if (!prisma) notFound();

  // Look up deal — try cuid first, fall back to hubspotDealId
  const isCuid = dealId.startsWith("c"); // cuids start with 'c'
  let deal = isCuid
    ? await prisma.deal.findUnique({ where: { id: dealId } })
    : await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });

  // If cuid lookup failed, also try hubspotDealId (in case someone passes a cuid-like string)
  if (!deal && isCuid) {
    deal = await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });
  }

  if (!deal) notFound();

  // Canonical URL enforcement: single redirect for both identifier + pipeline normalization
  const canonicalPipeline = deal.pipeline.toLowerCase();
  if (dealId !== deal.id || pipeline !== canonicalPipeline) {
    redirect(`/dashboards/deals/${canonicalPipeline}/${deal.id}`);
  }

  // Read stage order from local DealPipelineConfig (no live HubSpot calls)
  const pipelineConfig = await prisma.dealPipelineConfig.findUnique({
    where: { pipeline: deal.pipeline },
  });
  const stages = (pipelineConfig?.stages as StoredStage[]) ?? [];
  const stageOrder = stages
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => s.name);

  // Serialize for client
  const serialized = serializeDeal(deal);
  const timelineStages = buildTimelineStages(
    deal.pipeline,
    stageOrder,
    serialized,
  );
  const staleness = formatStaleness(deal.lastSyncedAt);

  return (
    <DealDetailView
      deal={serialized}
      timelineStages={timelineStages}
      stageOrder={stageOrder}
      staleness={staleness}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/deals/\\[pipeline\\]/\\[dealId\\]/page.tsx
git commit -m "feat(deal-detail): add server component page.tsx

- Prisma lookup with cuid-first, hubspotDealId fallback
- Canonical URL enforcement: redirects numeric IDs and wrong pipelines
- Reads DealPipelineConfig locally (no live HubSpot)
- Serializes deal + builds timeline stages for client

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Client Component (DealDetailView.tsx)

**Files:**
- Create: `src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx`

- [ ] **Step 1: Create the client component**

Create `src/app/dashboards/deals/[pipeline]/[dealId]/DealDetailView.tsx`:

```tsx
"use client";

import DashboardShell from "@/components/DashboardShell";
import DealHeader from "@/components/deal-detail/DealHeader";
import MilestoneTimeline from "@/components/deal-detail/MilestoneTimeline";
import StatusFlagsBar from "@/components/deal-detail/StatusFlagsBar";
import CollapsibleSection from "@/components/deal-detail/CollapsibleSection";
import FieldGrid from "@/components/deal-detail/FieldGrid";
import DealSidebar from "@/components/deal-detail/DealSidebar";
import TeamCard from "@/components/deal-detail/TeamCard";
import EquipmentCard from "@/components/deal-detail/EquipmentCard";
import ContactCard from "@/components/deal-detail/ContactCard";
import ExternalLinksCard from "@/components/deal-detail/ExternalLinksCard";
import QuickActionsCard from "@/components/deal-detail/QuickActionsCard";
import { getSectionsForPipeline, getStageColor } from "@/components/deal-detail/section-registry";
import type { SerializedDeal, TimelineStage } from "@/components/deal-detail/types";

interface DealDetailViewProps {
  deal: SerializedDeal;
  timelineStages: TimelineStage[];
  stageOrder: string[];
  staleness: string;
}

export default function DealDetailView({
  deal,
  timelineStages,
  stageOrder,
  staleness,
}: DealDetailViewProps) {
  const sections = getSectionsForPipeline(deal.pipeline);
  const stageColor = getStageColor(deal.pipeline, deal.stage, stageOrder);

  return (
    <DashboardShell
      title={deal.dealName}
      accentColor="orange"
      breadcrumbs={[
        { label: "Operations", href: "/suites/operations" },
        { label: "Deals", href: "/dashboards/deals" },
        { label: deal.dealName },
      ]}
      syncMeta={{
        source: "deal-mirror",
        lastSyncedAt: deal.lastSyncedAt ?? new Date().toISOString(),
        staleness,
      }}
      fullWidth
    >
      {/* Above the fold */}
      <DealHeader deal={deal} stageColor={stageColor} />
      {timelineStages.length > 0 && (
        <MilestoneTimeline stages={timelineStages} />
      )}
      <StatusFlagsBar deal={deal} stageOrder={stageOrder} />

      {/* Two-column layout */}
      <div className="mt-4 flex flex-col gap-6 lg:flex-row">
        {/* Left: collapsible sections */}
        <div className="min-w-0 flex-[2]">
          {sections.map((section) => {
            const fields = section.fields(deal);
            return (
              <CollapsibleSection
                key={section.key}
                title={section.title}
                fieldCount={fields.length}
                defaultOpen={section.defaultOpen}
              >
                <FieldGrid fields={fields} />
              </CollapsibleSection>
            );
          })}
        </div>

        {/* Right: pinned sidebar */}
        <div className="flex-1 lg:max-w-xs">
          <DealSidebar>
            <TeamCard deal={deal} />
            <EquipmentCard deal={deal} />
            <ContactCard deal={deal} />
            <ExternalLinksCard deal={deal} />
            <QuickActionsCard />
          </DealSidebar>
        </div>
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboards/deals/\\[pipeline\\]/\\[dealId\\]/DealDetailView.tsx
git commit -m "feat(deal-detail): add DealDetailView client component

Assembles the full page layout:
- DashboardShell with breadcrumbs and sync metadata
- Above-the-fold: DealHeader, MilestoneTimeline, StatusFlagsBar
- Two-column: registry-driven CollapsibleSections + pinned sidebar

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Update DealDetailPanel with "Open Full Record" Link

**Files:**
- Modify: `src/app/dashboards/deals/DealDetailPanel.tsx`

- [ ] **Step 1: Add "Open full record" link**

Open `src/app/dashboards/deals/DealDetailPanel.tsx`. Add `Link` import at top:

```tsx
import Link from "next/link";
```

Then after the existing "Open in HubSpot" `<a>` tag (around line 79), add:

```tsx
<Link
  href={`/dashboards/deals/${deal.pipeline?.toLowerCase() ?? "project"}/${deal.id}`}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 text-foreground border border-t-border rounded-lg text-xs font-medium hover:bg-surface-2/80 transition-colors"
>
  Open full record →
</Link>
```

Note: `deal.id` is the numeric HubSpot ID from `TableDeal`. The server component will redirect to the canonical cuid path.

- [ ] **Step 2: Run build to verify no type errors**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to deal-detail components.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/deals/DealDetailPanel.tsx
git commit -m "feat(deal-detail): add 'Open full record' link to slide-out panel

Links to /dashboards/deals/{pipeline}/{id} using HubSpot deal ID.
Server component redirects to canonical cuid path on load.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: Build Verification and Smoke Test

### Task 11: Full Build and Type Check

**Files:** (no new files)

- [ ] **Step 1: Run full test suite**

Run:
```bash
npm test -- --verbose 2>&1 | tail -20
```

Expected: All tests pass, including new deal-detail tests.

- [ ] **Step 2: Run TypeScript type check**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Run full build**

Run:
```bash
npm run build
```

Expected: Build succeeds. The new `[pipeline]/[dealId]` route appears in the dynamic route list.

- [ ] **Step 4: Run lint**

Run:
```bash
npm run lint
```

Expected: No lint errors.

- [ ] **Step 5: Smoke test locally**

Run:
```bash
npm run dev
```

Then navigate to a deal detail page in the browser. Verify:

**Page rendering:**
1. Page loads without errors
2. Header shows deal name, stage badge (colored pill), pipeline label, location, and amount (green)
3. Timeline shows stage progression with three visual states: completed (green ✓ + date), current (orange ● with glow), future (gray ○ + dash)
4. Status flags bar shows boolean chips with correct coloring (green for true, orange for false-relevant, gray for false-future)
5. Left column sections expand/collapse correctly; field count badge updates
6. Sidebar shows team, equipment, contact, links, and QuickActionsCard placeholder (dashed border)
7. Sidebar stays pinned (sticky) when scrolling the left column
8. Empty/null fields show "—" (never hidden), except ExternalLinksCard which hides empty links

**Navigation & routing:**
9. "Open in HubSpot" link opens HubSpot in a new tab
10. From deals table, "Open full record" link in the slide-out panel navigates to the detail page
11. Navigate using a numeric HubSpot deal ID (e.g., `/dashboards/deals/project/12345678`) — verify URL redirects to the canonical cuid path
12. Navigate with wrong pipeline segment — verify URL redirects to the correct pipeline
13. Navigate to a nonexistent deal ID — verify 404 page renders (not a crash)

**Responsive:**
14. Resize browser below 1024px — verify two-column layout collapses to single column with sidebar below content

**Dark mode:**
15. Toggle to dark mode — verify theme tokens render correctly (no hardcoded colors leaking)

- [ ] **Step 6: Final commit if any smoke-test fixes needed**

Only commit if fixes were required during smoke testing.
