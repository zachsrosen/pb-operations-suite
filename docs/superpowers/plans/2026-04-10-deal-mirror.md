# Deal Mirror Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate all HubSpot deals into a local Postgres `Deal` table so the suite reads from its own DB instead of calling HubSpot on every request.

**Architecture:** Prisma `Deal` model stores ~100 columns mirroring HubSpot deal properties. A hybrid sync engine (10-min batch cron + webhooks) keeps it fresh. API routes swap from live HubSpot calls to local DB reads behind a feature flag. Dashboards see no change — `Deal → Project/TransformedProject/Deal` mappers preserve existing contracts.

**Tech Stack:** Prisma 7.3 on Neon Postgres, Next.js 16 App Router, HubSpot CRM API v3/v4, Vercel cron

**Spec:** `docs/superpowers/specs/2026-04-10-deal-mirror-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add `Deal`, `DealSyncLog`, `DealPipelineConfig` models + enums |
| `src/lib/deal-property-map.ts` | Declarative HubSpot property → Deal column mapping (single source of truth) |
| `src/lib/deal-sync.ts` | Sync engine: batch sync, single-deal sync, association hydration, watermark, diff |
| `src/lib/deal-reader.ts` | DB reader: `dealToProject()`, `dealToTransformedProject()`, `dealToDeal()` mappers |
| `src/app/api/cron/deal-sync/route.ts` | Vercel cron endpoint — triggers batch sync |
| `src/app/api/webhooks/hubspot/deal-sync/route.ts` | Webhook handler — real-time deal updates |
| `src/app/api/admin/deal-sync/route.ts` | Admin: trigger manual sync (full or per-pipeline) |
| `src/app/api/admin/deal-sync/[dealId]/route.ts` | Admin: refresh single deal |
| `src/app/api/admin/deal-sync/health/route.ts` | Health endpoint: per-pipeline sync status |
| `src/app/api/projects/route.ts` | Modify: add feature-flag branch to read from local DB |
| `src/app/api/deals/route.ts` | Modify: add feature-flag branch to read from local DB |
| `src/app/api/cron/audit-retention/route.ts` | Modify: add `DealSyncLog` cleanup |
| `src/components/DashboardShell.tsx` | Modify: add staleness indicator |
| `vercel.json` | Modify: add cron entry + function maxDuration |
| `src/__tests__/deal-property-map.test.ts` | Tests for property mapper |
| `src/__tests__/deal-sync.test.ts` | Tests for sync engine |
| `src/__tests__/deal-reader.test.ts` | Tests for DB-to-type mappers |

---

## Chunk 1: Schema + Property Mapper

### Task 1: Add Prisma models and enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums after `ActivityType` (line ~178)**

Add these enums after the closing `}` of `ActivityType`:

```prisma
// ===========================================
// DEAL MIRROR — Local HubSpot Deal Replication
// ===========================================

enum DealPipeline {
  SALES
  PROJECT
  DNR
  SERVICE
  ROOFING
}

enum DealSyncSource {
  BATCH
  WEBHOOK
  MANUAL
}

enum DealSyncType {
  BATCH_FULL
  BATCH_INCREMENTAL
  WEBHOOK
  MANUAL
}

enum DealSyncStatus {
  SUCCESS
  FAILED
  SKIPPED
}
```

- [ ] **Step 2: Add new ActivityType values**

Inside the `ActivityType` enum, before the closing `}` (line 178), add:

```prisma
  // Deal Mirror Sync
  DEAL_SYNC_BATCH_COMPLETE
  DEAL_SYNC_WEBHOOK_RECEIVED
  DEAL_SYNC_ERROR
  DEAL_SYNC_DISCREPANCY
```

- [ ] **Step 3: Add the Deal model**

Add after the new enums. This is the full model with all columns from the spec. Follow the existing pattern (cuid IDs, `@default(now())` on timestamps):

```prisma
model Deal {
  id              String   @id @default(cuid())

  // Identity
  hubspotDealId   String   @unique
  dealName        String
  pipeline        DealPipeline
  stage           String
  stageId         String
  amount          Decimal?

  // Location
  pbLocation      String?
  address         String?
  city            String?
  state           String?
  zipCode         String?
  ahj             String?
  utility         String?

  // Team
  hubspotOwnerId      String?
  dealOwnerName        String?
  projectManager       String?
  operationsManager    String?
  siteSurveyor         String?
  departmentLeads      Json?

  // Milestones
  closeDate                    DateTime?
  siteSurveyScheduleDate       DateTime?
  siteSurveyScheduledDate      DateTime?
  siteSurveyCompletionDate     DateTime?
  dateReturnedFromDesigners    DateTime?
  designStartDate              DateTime?
  designDraftCompletionDate    DateTime?
  designCompletionDate         DateTime?
  designApprovalSentDate       DateTime?
  layoutApprovalDate           DateTime?
  permitSubmitDate             DateTime?
  permitIssueDate              DateTime?
  icSubmitDate                 DateTime?
  icApprovalDate               DateTime?
  rtbDate                      DateTime?
  installScheduleDate          DateTime?
  constructionCompleteDate     DateTime?
  inspectionScheduleDate       DateTime?
  inspectionPassDate           DateTime?
  inspectionFailDate           DateTime?
  inspectionBookedDate         DateTime?
  ptoStartDate                 DateTime?
  ptoCompletionDate            DateTime?
  forecastedInstallDate        DateTime?
  forecastedInspectionDate     DateTime?
  forecastedPtoDate            DateTime?

  // Status Flags
  isSiteSurveyScheduled                Boolean  @default(false)
  isSiteSurveyCompleted                Boolean  @default(false)
  isDaSent                             Boolean  @default(false)
  isLayoutApproved                     Boolean  @default(false)
  isDesignDrafted                      Boolean  @default(false)
  isDesignCompleted                    Boolean  @default(false)
  isPermitSubmitted                    Boolean  @default(false)
  isPermitIssued                       Boolean  @default(false)
  isIcSubmitted                        Boolean  @default(false)
  isIcApproved                         Boolean  @default(false)
  isParticipateEnergy                  Boolean  @default(false)
  isInspectionPassed                   Boolean  @default(false)
  hasInspectionFailed                  Boolean  @default(false)
  firstTimeInspectionPass              Boolean  @default(false)
  hasInspectionFailedNotRejected       Boolean  @default(false)
  firstTimeInspectionPassNotRejected   Boolean  @default(false)
  readyForInspection                   String?
  finalInspectionStatus                String?
  inspectionFailCount                  Int?
  inspectionFailureReason              String?
  installStatus                        String?
  designStatus                         String?
  surveyStatus                         String?
  permittingStatus                     String?
  layoutStatus                         String?
  icStatus                             String?
  ptoStatus                            String?

  // Equipment
  systemSizeKwdc          Decimal?
  systemSizeKwac          Decimal?
  moduleBrand             String?
  moduleModel             String?
  moduleCount             Int?
  moduleWattage           Int?
  moduleName              String?
  inverterBrand           String?
  inverterModel           String?
  inverterQty             Int?
  inverterSizeKwac        Decimal?
  inverterName            String?
  batteryBrand            String?
  batteryModel            String?
  batteryCount            Int?
  batterySizeKwh          Decimal?
  batteryName             String?
  batteryExpansionCount   Int?
  batteryExpansionName    String?
  batteryExpansionModel   String?
  evCount                 Int?

  // QC Metrics (days, converted from HubSpot ms)
  siteSurveyTurnaroundDays   Decimal?
  designTurnaroundDays       Decimal?
  permitTurnaroundDays       Decimal?
  icTurnaroundDays           Decimal?
  constructionTurnaroundDays Decimal?
  projectTurnaroundDays      Decimal?
  inspectionTurnaroundDays   Decimal?
  daReadyToSentDays          Decimal?
  daSentToApprovedDays       Decimal?
  timeToSubmitPermitDays     Decimal?
  timeToSubmitIcDays         Decimal?
  daToRtbDays                Decimal?
  rtbToConstructionDays      Decimal?
  ccToPtoDays                Decimal?
  timeToCcDays               Decimal?
  timeToDaDays               Decimal?
  timeToPtoDays              Decimal?
  timeToRtbDays              Decimal?
  rtbToCcDays                Decimal?
  daToCcDays                 Decimal?
  daToPermitDays             Decimal?

  // Revisions
  daRevisionCount         Int?
  asBuiltRevisionCount    Int?
  permitRevisionCount     Int?
  icRevisionCount         Int?
  totalRevisionCount      Int?

  // External Links
  designDocumentsUrl      String?
  designFolderUrl         String?
  allDocumentFolderUrl    String?
  driveUrl                String?
  openSolarUrl            String?
  openSolarId             String?
  zuperUid                String?
  hubspotUrl              String?

  // Install Planning
  expectedDaysForInstall    Int?
  daysForInstallers         Int?
  daysForElectricians       Int?
  installCrew               String?
  installDifficulty         String?
  installNotes              String?
  expectedInstallerCount    Int?
  expectedElectricianCount  Int?

  // Incentive Programs
  n3ceEvStatus              String?
  n3ceBatteryStatus         String?
  sgipStatus                String?
  pbsrStatus                String?
  cpaStatus                 String?
  participateEnergyStatus   String?

  // Misc
  projectNumber             String?
  projectType               String?
  tags                      String?
  discoReco                 String?
  interiorAccess            String?
  siteSurveyDocuments       String?
  systemPerformanceReview   String?
  dateEnteredCurrentStage   DateTime?
  createDate                DateTime?

  // Associations
  hubspotContactId    String?
  customerName        String?
  customerEmail       String?
  customerPhone       String?
  hubspotCompanyId    String?
  companyName         String?

  // Sync Metadata
  hubspotUpdatedAt    DateTime?
  lastSyncedAt        DateTime  @default(now())
  syncSource          DealSyncSource
  rawProperties       Json?

  // Standard
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  // Relations
  syncLogs            DealSyncLog[]

  @@index([pipeline, stage])
  @@index([pbLocation])
  @@index([lastSyncedAt])
  @@index([hubspotOwnerId])
}
```

- [ ] **Step 4: Add DealSyncLog model**

```prisma
model DealSyncLog {
  id              String          @id @default(cuid())
  dealId          String?
  deal            Deal?           @relation(fields: [dealId], references: [id], onDelete: SetNull)
  hubspotDealId   String?
  syncType        DealSyncType
  source          String
  changesDetected Json?
  dealCount       Int?
  status          DealSyncStatus
  errorMessage    String?
  durationMs      Int?
  createdAt       DateTime        @default(now())

  @@index([dealId, createdAt])
  @@index([syncType, createdAt])
  @@index([status, createdAt])
}
```

- [ ] **Step 5: Add DealPipelineConfig model**

```prisma
model DealPipelineConfig {
  id                String       @id @default(cuid())
  pipeline          DealPipeline @unique
  hubspotPipelineId String
  stages            Json
  lastSyncedAt      DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
}
```

- [ ] **Step 6: Run prisma generate to validate schema**

Run: `npx prisma generate`
Expected: no errors, clean generation

- [ ] **Step 7: Create migration**

Run: `npx prisma migrate dev --name add-deal-mirror-tables`
Expected: migration created and applied

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat(deal-mirror): add Deal, DealSyncLog, DealPipelineConfig schema"
```

---

### Task 2: Create property mapper

**Files:**
- Create: `src/lib/deal-property-map.ts`
- Test: `src/__tests__/deal-property-map.test.ts`

- [ ] **Step 1: Write tests for the property mapper**

Create `src/__tests__/deal-property-map.test.ts`:

```typescript
import {
  dealPropertyMap,
  mapHubSpotToDeal,
  msToDays,
  DEAL_SYNC_PROPERTIES,
} from "@/lib/deal-property-map";

describe("deal-property-map", () => {
  describe("msToDays", () => {
    it("converts milliseconds to days", () => {
      expect(msToDays("86400000")).toBe(1);
    });
    it("returns null for null input", () => {
      expect(msToDays(null)).toBeNull();
    });
    it("returns null for empty string", () => {
      expect(msToDays("")).toBeNull();
    });
  });

  describe("DEAL_SYNC_PROPERTIES", () => {
    it("includes all mapped HubSpot properties", () => {
      const mappedProps = Object.keys(dealPropertyMap);
      for (const prop of mappedProps) {
        expect(DEAL_SYNC_PROPERTIES).toContain(prop);
      }
    });
    it("includes hs_lastmodifieddate for watermark", () => {
      expect(DEAL_SYNC_PROPERTIES).toContain("hs_lastmodifieddate");
    });
  });

  describe("mapHubSpotToDeal", () => {
    it("maps basic string fields", () => {
      const result = mapHubSpotToDeal({ dealname: "Test Deal" });
      expect(result.dealName).toBe("Test Deal");
    });

    it("maps decimal fields", () => {
      const result = mapHubSpotToDeal({ amount: "50000" });
      expect(result.amount).toBe(50000);
    });

    it("maps datetime fields", () => {
      const result = mapHubSpotToDeal({
        closedate: "2026-04-10T00:00:00.000Z",
      });
      expect(result.closeDate).toBeInstanceOf(Date);
    });

    it("maps boolean fields from HubSpot string", () => {
      const result = mapHubSpotToDeal({
        is_site_survey_scheduled_: "true",
      });
      expect(result.isSiteSurveyScheduled).toBe(true);
    });

    it("converts QC metrics from ms to days", () => {
      const result = mapHubSpotToDeal({
        site_survey_turnaround_time: "172800000",
      });
      expect(result.siteSurveyTurnaroundDays).toBe(2);
    });

    it("maps int fields", () => {
      const result = mapHubSpotToDeal({ module_count: "24" });
      expect(result.moduleCount).toBe(24);
    });

    it("skips null/undefined values without error", () => {
      const result = mapHubSpotToDeal({
        dealname: "Test",
        amount: null,
        closedate: undefined,
      });
      expect(result.dealName).toBe("Test");
      expect(result.amount).toBeNull();
    });

    it("computes isParticipateEnergy from tags", () => {
      const result = mapHubSpotToDeal({
        tags: "Participate Energy;Other Tag",
      });
      expect(result.isParticipateEnergy).toBe(true);
    });

    it("computes hubspotUrl from deal ID", () => {
      const result = mapHubSpotToDeal(
        { hs_object_id: "12345" },
        { portalId: "99999" }
      );
      expect(result.hubspotUrl).toBe(
        "https://app.hubspot.com/contacts/99999/deal/12345"
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/deal-property-map.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create the property mapper**

Create `src/lib/deal-property-map.ts`. This is the single source of truth for all HubSpot → Deal column mappings. Reference `src/lib/hubspot.ts` lines 508-560 for the full `DEAL_PROPERTIES` list.

```typescript
/**
 * Deal Property Map — single source of truth for HubSpot property → Deal column.
 *
 * Drives: batch sync upserts, webhook updates, change diffs, future write-back.
 * See spec: docs/superpowers/specs/2026-04-10-deal-mirror-design.md
 */

export type PropertyType =
  | "string"
  | "decimal"
  | "int"
  | "boolean"
  | "datetime"
  | "json";

export interface PropertyMapping {
  column: string;
  type: PropertyType;
  transform?: (value: string | null | undefined) => unknown;
}

// --- Transform helpers ---

export function msToDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = parseFloat(value);
  if (isNaN(ms)) return null;
  return Math.round((ms / 86_400_000) * 100) / 100; // 2 decimal places
}

function toBool(value: string | null | undefined): boolean {
  return value === "true" || value === "True" || value === "TRUE";
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function toDecimal(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function toInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

// --- The map ---

export const dealPropertyMap: Record<string, PropertyMapping> = {
  // Identity
  dealname: { column: "dealName", type: "string" },
  amount: { column: "amount", type: "decimal" },
  dealstage: { column: "stageId", type: "string" },
  // pipeline resolved separately from pipeline ID
  // stage name resolved via DealPipelineConfig from stageId

  // Location
  pb_location: { column: "pbLocation", type: "string" },
  address_line_1: { column: "address", type: "string" },
  city: { column: "city", type: "string" },
  state: { column: "state", type: "string" },
  postal_code: { column: "zipCode", type: "string" },
  ahj: { column: "ahj", type: "string" },
  utility_company: { column: "utility", type: "string" },

  // Team
  hubspot_owner_id: { column: "hubspotOwnerId", type: "string" },
  // dealOwnerName resolved via Owners API during sync
  project_manager: { column: "projectManager", type: "string" },
  operations_manager: { column: "operationsManager", type: "string" },
  site_surveyor: { column: "siteSurveyor", type: "string" },
  // departmentLeads built from design, permit_tech, interconnections_tech, rtb_lead
  design: { column: "_dept_design", type: "string" },
  permit_tech: { column: "_dept_permit_tech", type: "string" },
  interconnections_tech: { column: "_dept_ic_tech", type: "string" },
  rtb_lead: { column: "_dept_rtb_lead", type: "string" },

  // Milestones (all datetime)
  closedate: { column: "closeDate", type: "datetime" },
  site_survey_schedule_date: { column: "siteSurveyScheduleDate", type: "datetime" },
  site_survey_scheduled_date: { column: "siteSurveyScheduledDate", type: "datetime" },
  site_survey_date: { column: "siteSurveyCompletionDate", type: "datetime" },
  date_returned_from_designers: { column: "dateReturnedFromDesigners", type: "datetime" },
  design_start_date: { column: "designStartDate", type: "datetime" },
  design_draft_completion_date: { column: "designDraftCompletionDate", type: "datetime" },
  design_completion_date: { column: "designCompletionDate", type: "datetime" },
  design_approval_sent_date: { column: "designApprovalSentDate", type: "datetime" },
  layout_approval_date: { column: "layoutApprovalDate", type: "datetime" },
  permit_submit_date: { column: "permitSubmitDate", type: "datetime" },
  permit_completion_date: { column: "permitIssueDate", type: "datetime" },
  interconnections_submit_date: { column: "icSubmitDate", type: "datetime" },
  interconnections_completion_date: { column: "icApprovalDate", type: "datetime" },
  ready_to_build_date: { column: "rtbDate", type: "datetime" },
  install_schedule_date: { column: "installScheduleDate", type: "datetime" },
  construction_complete_date: { column: "constructionCompleteDate", type: "datetime" },
  inspections_schedule_date: { column: "inspectionScheduleDate", type: "datetime" },
  inspections_completion_date: { column: "inspectionPassDate", type: "datetime" },
  inspections_fail_date: { column: "inspectionFailDate", type: "datetime" },
  inspection_booked_date: { column: "inspectionBookedDate", type: "datetime" },
  pto_start_date: { column: "ptoStartDate", type: "datetime" },
  pto_completion_date: { column: "ptoCompletionDate", type: "datetime" },
  forecasted_installation_date: { column: "forecastedInstallDate", type: "datetime" },
  forecasted_inspection_date: { column: "forecastedInspectionDate", type: "datetime" },
  forecasted_pto_date: { column: "forecastedPtoDate", type: "datetime" },
  hs_v2_date_entered_current_stage: { column: "dateEnteredCurrentStage", type: "datetime" },
  hs_createdate: { column: "createDate", type: "datetime" },

  // Status Flags (booleans)
  is_site_survey_scheduled_: { column: "isSiteSurveyScheduled", type: "boolean" },
  is_site_survey_completed_: { column: "isSiteSurveyCompleted", type: "boolean" },
  is_da_sent_: { column: "isDaSent", type: "boolean" },
  layout_approved: { column: "isLayoutApproved", type: "boolean" },
  is_design_drafted_: { column: "isDesignDrafted", type: "boolean" },
  is_design_completed_: { column: "isDesignCompleted", type: "boolean" },
  is_permit_submitted_: { column: "isPermitSubmitted", type: "boolean" },
  permit_issued_: { column: "isPermitIssued", type: "boolean" },
  is_interconnection_submitted_: { column: "isIcSubmitted", type: "boolean" },
  interconnection_approved_: { column: "isIcApproved", type: "boolean" },
  // isParticipateEnergy computed from tags — handled in mapHubSpotToDeal
  is_inspection_passed_: { column: "isInspectionPassed", type: "boolean" },
  has_inspection_failed_: { column: "hasInspectionFailed", type: "boolean" },
  first_time_inspection_pass_: { column: "firstTimeInspectionPass", type: "boolean" },
  "has_inspection_failed__not_rejected__": { column: "hasInspectionFailedNotRejected", type: "boolean" },
  "first_time_inspection_pass____not_rejected_": { column: "firstTimeInspectionPassNotRejected", type: "boolean" },

  // Status Flags (strings)
  ready_for_inspection_: { column: "readyForInspection", type: "string" },
  final_inspection_status: { column: "finalInspectionStatus", type: "string" },
  inspection_fail_count: { column: "inspectionFailCount", type: "int" },
  inspection_failure_reason: { column: "inspectionFailureReason", type: "string" },
  install_status: { column: "installStatus", type: "string" },
  design_status: { column: "designStatus", type: "string" },
  site_survey_status: { column: "surveyStatus", type: "string" },
  permitting_status: { column: "permittingStatus", type: "string" },
  layout_status: { column: "layoutStatus", type: "string" },
  interconnection_status: { column: "icStatus", type: "string" },
  pto_status: { column: "ptoStatus", type: "string" },

  // Equipment
  calculated_system_size__kwdc_: { column: "systemSizeKwdc", type: "decimal" },
  system_size_kwac: { column: "systemSizeKwac", type: "decimal" },
  module_brand: { column: "moduleBrand", type: "string" },
  module_model: { column: "moduleModel", type: "string" },
  module_count: { column: "moduleCount", type: "int" },
  module_wattage: { column: "moduleWattage", type: "int" },
  modules: { column: "moduleName", type: "string" },
  inverter_brand: { column: "inverterBrand", type: "string" },
  inverter_model: { column: "inverterModel", type: "string" },
  inverter_qty: { column: "inverterQty", type: "int" },
  inverter_size_kwac: { column: "inverterSizeKwac", type: "decimal" },
  inverter: { column: "inverterName", type: "string" },
  battery_brand: { column: "batteryBrand", type: "string" },
  battery_model: { column: "batteryModel", type: "string" },
  battery_count: { column: "batteryCount", type: "int" },
  battery_size: { column: "batterySizeKwh", type: "decimal" },
  battery: { column: "batteryName", type: "string" },
  battery_expansion_count: { column: "batteryExpansionCount", type: "int" },
  battery_expansion: { column: "batteryExpansionName", type: "string" },
  expansion_model: { column: "batteryExpansionModel", type: "string" },
  ev_count: { column: "evCount", type: "int" },

  // QC Metrics (ms → days)
  site_survey_turnaround_time: { column: "siteSurveyTurnaroundDays", type: "decimal", transform: msToDays },
  design_turnaround_time: { column: "designTurnaroundDays", type: "decimal", transform: msToDays },
  permit_turnaround_time: { column: "permitTurnaroundDays", type: "decimal", transform: msToDays },
  interconnection_turnaround_time: { column: "icTurnaroundDays", type: "decimal", transform: msToDays },
  construction_turnaround_time: { column: "constructionTurnaroundDays", type: "decimal", transform: msToDays },
  project_turnaround_time: { column: "projectTurnaroundDays", type: "decimal", transform: msToDays },
  inspection_turnaround_time: { column: "inspectionTurnaroundDays", type: "decimal", transform: msToDays },
  time_between_da_ready_and_da_sent: { column: "daReadyToSentDays", type: "decimal", transform: msToDays },
  time_between_da_sent_and_da_approved: { column: "daSentToApprovedDays", type: "decimal", transform: msToDays },
  time_to_submit_permit: { column: "timeToSubmitPermitDays", type: "decimal", transform: msToDays },
  time_to_submit_interconnection: { column: "timeToSubmitIcDays", type: "decimal", transform: msToDays },
  da_to_rtb: { column: "daToRtbDays", type: "decimal", transform: msToDays },
  time_between_rtb___construction_schedule_date: { column: "rtbToConstructionDays", type: "decimal", transform: msToDays },
  time_between_cc___pto: { column: "ccToPtoDays", type: "decimal", transform: msToDays },
  time_to_cc: { column: "timeToCcDays", type: "decimal", transform: msToDays },
  time_to_da: { column: "timeToDaDays", type: "decimal", transform: msToDays },
  time_to_pto: { column: "timeToPtoDays", type: "decimal", transform: msToDays },
  time_to_rtb: { column: "timeToRtbDays", type: "decimal", transform: msToDays },
  time_from_rtb_to_cc: { column: "rtbToCcDays", type: "decimal", transform: msToDays },
  da_to_cc: { column: "daToCcDays", type: "decimal", transform: msToDays },
  da_to_permit: { column: "daToPermitDays", type: "decimal", transform: msToDays },

  // Revisions
  da_revision_counter: { column: "daRevisionCount", type: "int" },
  as_built_revision_counter: { column: "asBuiltRevisionCount", type: "int" },
  permit_revision_counter: { column: "permitRevisionCount", type: "int" },
  interconnection_revision_counter: { column: "icRevisionCount", type: "int" },
  total_revision_count: { column: "totalRevisionCount", type: "int" },

  // External Links
  design_documents: { column: "designDocumentsUrl", type: "string" },
  design_document_folder_id: { column: "designFolderUrl", type: "string" },
  all_document_parent_folder_id: { column: "allDocumentFolderUrl", type: "string" },
  g_drive: { column: "driveUrl", type: "string" },
  link_to_opensolar: { column: "openSolarUrl", type: "string" },
  os_project_id: { column: "openSolarId", type: "string" },
  zuper_site_survey_uid: { column: "zuperUid", type: "string" },

  // Install Planning
  expected_days_for_install: { column: "expectedDaysForInstall", type: "int" },
  days_for_installers: { column: "daysForInstallers", type: "int" },
  days_for_electricians: { column: "daysForElectricians", type: "int" },
  install_crew: { column: "installCrew", type: "string" },
  install_difficulty: { column: "installDifficulty", type: "string" },
  notes_for_install: { column: "installNotes", type: "string" },
  expected_installer_cont: { column: "expectedInstallerCount", type: "int" },
  expected_electrician_count: { column: "expectedElectricianCount", type: "int" },

  // Incentives
  n3ce_ev_status: { column: "n3ceEvStatus", type: "string" },
  n3ce_battery_status: { column: "n3ceBatteryStatus", type: "string" },
  sgip_incentive_status: { column: "sgipStatus", type: "string" },
  pbsr_incentive_status: { column: "pbsrStatus", type: "string" },
  cpa_status: { column: "cpaStatus", type: "string" },
  participate_energy_status: { column: "participateEnergyStatus", type: "string" },

  // Misc
  project_number: { column: "projectNumber", type: "string" },
  project_type: { column: "projectType", type: "string" },
  tags: { column: "tags", type: "string" },
  disco__reco: { column: "discoReco", type: "string" },
  interior_access: { column: "interiorAccess", type: "string" },
  site_survey_documents: { column: "siteSurveyDocuments", type: "string" },
  system_performance_review: { column: "systemPerformanceReview", type: "string" },
};

/**
 * All HubSpot properties the sync engine should request.
 * Derived from the map keys + system properties needed for sync.
 */
export const DEAL_SYNC_PROPERTIES: string[] = [
  ...Object.keys(dealPropertyMap),
  "hs_object_id",        // deal ID
  "hs_lastmodifieddate", // watermark for incremental sync
  "pipeline",            // pipeline resolution
  "is_participate_energy", // secondary PE check
  "os_project_link",     // openSolarUrl fallback (not in map, consumed in mapHubSpotToDeal)
];

/** Department lead property keys for building departmentLeads Json */
const DEPT_LEAD_PROPS = ["design", "permit_tech", "interconnections_tech", "rtb_lead"] as const;

/**
 * Convert a flat HubSpot properties object into a partial Deal upsert payload.
 * Does NOT set: pipeline, stage (name), dealOwnerName, associations, hubspotDealId.
 * Those are resolved separately during sync.
 */
export function mapHubSpotToDeal(
  properties: Record<string, string | null | undefined>,
  options?: { portalId?: string }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [hsProp, mapping] of Object.entries(dealPropertyMap)) {
    // Skip department lead intermediate columns
    if (mapping.column.startsWith("_dept_")) continue;

    const raw = properties[hsProp];

    if (mapping.transform) {
      result[mapping.column] = mapping.transform(raw);
    } else {
      switch (mapping.type) {
        case "string":
          result[mapping.column] = raw ?? null;
          break;
        case "decimal":
          result[mapping.column] = toDecimal(raw);
          break;
        case "int":
          result[mapping.column] = toInt(raw);
          break;
        case "boolean":
          result[mapping.column] = toBool(raw);
          break;
        case "datetime":
          result[mapping.column] = toDate(raw);
          break;
        case "json":
          result[mapping.column] = raw ? JSON.parse(raw) : null;
          break;
      }
    }
  }

  // Computed: isParticipateEnergy from tags
  const tags = (properties.tags ?? "") as string;
  result.isParticipateEnergy =
    tags.includes("Participate Energy") ||
    toBool(properties.is_participate_energy);

  // Computed: departmentLeads JSON
  const deptLeads: Record<string, string | null> = {};
  for (const key of DEPT_LEAD_PROPS) {
    deptLeads[key] = (properties[key] as string) ?? null;
  }
  result.departmentLeads = deptLeads;

  // Computed: hubspotUrl
  const dealId = properties.hs_object_id;
  const portalId = options?.portalId ?? process.env.HUBSPOT_PORTAL_ID;
  if (dealId && portalId) {
    result.hubspotUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`;
  }

  // Computed: openSolarUrl fallback
  if (!result.openSolarUrl && properties.os_project_link) {
    result.openSolarUrl = properties.os_project_link;
  }

  // Sync metadata
  result.hubspotUpdatedAt = toDate(properties.hs_lastmodifieddate);

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/deal-property-map.test.ts --no-coverage`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-property-map.ts src/__tests__/deal-property-map.test.ts
git commit -m "feat(deal-mirror): add property mapper with tests"
```

---

## Chunk 2: Sync Engine

### Task 3: Create the sync engine

**Files:**
- Create: `src/lib/deal-sync.ts`
- Test: `src/__tests__/deal-sync.test.ts`

The sync engine is the largest module. It handles:
- Pipeline config sync (stage maps)
- Batch sync (full + incremental)
- Single-deal sync (for webhooks / manual)
- Association hydration (batch + single)
- Change diffing
- Watermark management

- [ ] **Step 1: Write core sync tests**

Create `src/__tests__/deal-sync.test.ts`. Focus on unit-testable logic — the diff engine and pipeline resolution. Integration tests for HubSpot API calls will be tested via the cron/webhook routes in later tasks.

```typescript
import { diffDealProperties, resolvePipeline, resolveStage } from "@/lib/deal-sync";

describe("deal-sync", () => {
  describe("diffDealProperties", () => {
    it("detects changed fields", () => {
      const existing = { dealName: "Old Name", amount: 5000 };
      const incoming = { dealName: "New Name", amount: 5000 };
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({ dealName: ["Old Name", "New Name"] });
    });

    it("returns empty object when no changes", () => {
      const data = { dealName: "Same", amount: 5000 };
      expect(diffDealProperties(data, data)).toEqual({});
    });

    it("detects null → value changes", () => {
      const existing = { closeDate: null };
      const incoming = { closeDate: new Date("2026-04-10") };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.closeDate).toBeDefined();
    });
  });

  describe("resolvePipeline", () => {
    it("maps known pipeline IDs to enum", () => {
      expect(resolvePipeline("6900017")).toBe("PROJECT");
      expect(resolvePipeline("21997330")).toBe("DNR");
      expect(resolvePipeline("23928924")).toBe("SERVICE");
      expect(resolvePipeline("765928545")).toBe("ROOFING");
    });

    it("defaults to SALES for default/unknown pipeline", () => {
      expect(resolvePipeline("default")).toBe("SALES");
      expect(resolvePipeline("")).toBe("SALES");
      expect(resolvePipeline(undefined)).toBe("SALES");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/deal-sync.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Create the sync engine module**

Create `src/lib/deal-sync.ts`. This is a large module — key sections below. The implementer should reference:
- `src/lib/hubspot.ts` for `searchWithRetry()` (line ~123), `fetchAllProjects()` (line ~1076), `fetchPrimaryContactId()` (line ~1397)
- `src/lib/deal-property-map.ts` for `mapHubSpotToDeal()` and `DEAL_SYNC_PROPERTIES`
- `src/lib/db.ts` for `prisma` client

```typescript
/**
 * Deal Sync Engine
 *
 * Handles batch sync, single-deal sync, association hydration,
 * change diffing, and watermark management.
 *
 * See spec: docs/superpowers/specs/2026-04-10-deal-mirror-design.md
 */

import { prisma } from "@/lib/db";
import { mapHubSpotToDeal, DEAL_SYNC_PROPERTIES } from "@/lib/deal-property-map";
import type { DealPipeline, DealSyncSource, DealSyncType } from "@/generated/prisma";

// --- Pipeline resolution ---

const PIPELINE_ID_MAP: Record<string, DealPipeline> = {
  "6900017": "PROJECT",
  "21997330": "DNR",
  "23928924": "SERVICE",
  "765928545": "ROOFING",
};

export function resolvePipeline(pipelineId: string | undefined | null): DealPipeline {
  if (!pipelineId || pipelineId === "default") return "SALES";
  return PIPELINE_ID_MAP[pipelineId] ?? "SALES";
}

/**
 * Resolve stage ID to stage name using DealPipelineConfig.
 * Falls back to the stage ID itself if not found.
 */
export async function resolveStage(
  stageId: string,
  pipeline: DealPipeline
): Promise<string> {
  const config = await prisma.dealPipelineConfig.findUnique({
    where: { pipeline },
  });
  if (config?.stages) {
    const stages = config.stages as Array<{ id: string; name: string }>;
    const match = stages.find((s) => s.id === stageId);
    if (match) return match.name;
  }
  return stageId; // fallback
}

// --- Change diffing ---

export function diffDealProperties(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, [unknown, unknown]> {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(incoming)) {
    const oldVal = existing[key];
    const newVal = incoming[key];
    // Compare dates by ISO string, everything else by JSON
    const oldStr = oldVal instanceof Date ? oldVal.toISOString() : JSON.stringify(oldVal);
    const newStr = newVal instanceof Date ? newVal.toISOString() : JSON.stringify(newVal);
    if (oldStr !== newStr) {
      diff[key] = [oldVal, newVal];
    }
  }
  return diff;
}

// --- Watermark management ---

function watermarkKey(pipeline: DealPipeline): string {
  return `deal-sync:watermark:${pipeline}`;
}

async function getWatermark(pipeline: DealPipeline): Promise<Date | null> {
  const config = await prisma.systemConfig.findUnique({
    where: { key: watermarkKey(pipeline) },
  });
  return config?.value ? new Date(config.value) : null;
}

async function setWatermark(pipeline: DealPipeline, timestamp: Date): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: watermarkKey(pipeline) },
    update: { value: timestamp.toISOString() },
    create: { key: watermarkKey(pipeline), value: timestamp.toISOString() },
  });
}

// --- Pipeline config sync ---

export async function syncPipelineConfigs(): Promise<void> {
  // Fetch all pipelines from HubSpot in one call
  const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", {
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`);
  const data = await res.json();

  for (const pipeline of data.results) {
    const pipelineEnum = resolvePipeline(pipeline.id);
    const stages = pipeline.stages.map((s: { id: string; label: string; displayOrder: number }) => ({
      id: s.id,
      name: s.label,
      displayOrder: s.displayOrder,
      isActive: true,
    }));
    await prisma.dealPipelineConfig.upsert({
      where: { pipeline: pipelineEnum },
      update: { hubspotPipelineId: pipeline.id, stages, lastSyncedAt: new Date() },
      create: { pipeline: pipelineEnum, hubspotPipelineId: pipeline.id, stages },
    });
  }
}

// --- Batch sync core ---

// The implementer should build out these functions following
// the two-phase pattern from fetchAllProjects() (hubspot.ts ~1076):
//
// 1. searchDealIds(pipeline, incremental?) — search API with minimal props
//    IMPORTANT: Sales pipeline must query by stage IDs, not pipeline filter.
//    See /api/deals/route.ts ~142-176 for the Sales special case.
//
// 2. batchReadDeals(dealIds) — batch-read full DEAL_SYNC_PROPERTIES
//    100 per batch, 3 concurrent. Use searchWithRetry() for rate limiting.
//
// 3. hydrateAssociations(dealIds) — batch association reads:
//    POST /crm/v4/associations/deals/contacts/batch/read (100 per req)
//    POST /crm/v4/associations/deals/companies/batch/read (100 per req)
//    Then batch-read contact/company properties for resolved IDs.
//
// 4. upsertDeals(deals) — for each deal:
//    a. mapHubSpotToDeal(properties)
//    b. resolvePipeline(properties.pipeline)
//    c. resolveStage(stageId, pipeline)
//    d. Resolve owner name (Owners API with circuit breaker)
//    e. Diff against existing row
//    f. prisma.deal.upsert() if changed
//    g. Log to DealSyncLog
//
// 5. detectDeletions(pipeline, knownDealIds) — full sync only:
//    Find deals in DB not in HubSpot response, mark stage="DELETED"
//
// 6. updateWatermark(pipeline, maxHubspotUpdatedAt)

export interface BatchSyncResult {
  pipeline: DealPipeline;
  totalFetched: number;
  upserted: number;
  skipped: number;
  deleted: number;
  errors: number;
  durationMs: number;
}

/**
 * Run batch sync for a single pipeline.
 * Called by the cron job for each pipeline.
 */
export async function batchSyncPipeline(
  pipeline: DealPipeline,
  options: { full?: boolean } = {}
): Promise<BatchSyncResult> {
  const start = Date.now();
  // Implementation follows the pattern above.
  // This is the core function the implementer builds out.
  // See detailed flow in spec Section: Batch Sync (Cron).
  throw new Error("Not implemented — see plan Task 3 Step 3 comments");
}

/**
 * Sync a single deal by HubSpot deal ID.
 * Used by webhook handler and manual admin sync.
 */
export async function syncSingleDeal(
  hubspotDealId: string,
  source: DealSyncSource
): Promise<void> {
  // 1. Fetch deal from HubSpot (single batch-read of 1 deal)
  // 2. mapHubSpotToDeal(properties)
  // 3. Resolve pipeline, stage, owner
  // 4. Single-deal association read (fetchPrimaryContactId pattern)
  // 5. Diff, upsert, log
  throw new Error("Not implemented — see plan Task 3 Step 3 comments");
}
```

The implementer should fill in `batchSyncPipeline()` and `syncSingleDeal()` following the inline comments and spec references. The key implementation details:

- **Sales pipeline**: Query by stage IDs, not pipeline filter. Reference `src/app/api/deals/route.ts` lines 142-176.
- **Batch reads**: 100 per batch, 3 concurrent. Use `searchWithRetry()` from `src/lib/hubspot.ts`.
- **Association hydration**: Use `POST /crm/v4/associations/deals/contacts/batch/read` for batch sync. Use `fetchPrimaryContactId()` for single-deal sync.
- **Watermark**: Store max observed `hubspotUpdatedAt` per pipeline in `SystemConfig`. Apply 2-minute overlap window on incremental fetches.
- **Owner resolution**: Reuse existing Owners API logic from `hubspot.ts` with circuit breaker.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/deal-sync.test.ts --no-coverage`
Expected: PASS for diffDealProperties and resolvePipeline tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-sync.ts src/__tests__/deal-sync.test.ts
git commit -m "feat(deal-mirror): add sync engine with diff, pipeline resolution, watermark"
```

---

### Task 4: Create the DB reader / type mappers

**Files:**
- Create: `src/lib/deal-reader.ts`
- Test: `src/__tests__/deal-reader.test.ts`

This module converts Prisma `Deal` rows into the three downstream types the API routes currently return. Reference:
- `src/lib/types.ts` for `RawProject` (line 4), `TransformedProject` (line ~146), `Deal` type (line ~267)
- `src/lib/transforms.ts` for `transformProject()` logic
- `src/lib/hubspot.ts` for the `Project` interface (line ~250)

- [ ] **Step 1: Write reader tests**

```typescript
import { dealToProject, dealToDeal } from "@/lib/deal-reader";

describe("deal-reader", () => {
  const mockDeal = {
    hubspotDealId: "123",
    dealName: "Test Project",
    pipeline: "PROJECT" as const,
    stage: "Construction",
    stageId: "20440342",
    amount: 50000,
    pbLocation: "DTC",
    // ... minimal fields for test
  };

  describe("dealToProject", () => {
    it("maps hubspotDealId to id", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.id).toBe("123");
    });

    it("maps dealName to name", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.name).toBe("Test Project");
    });

    it("maps stage correctly", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.stage).toBe("Construction");
    });
  });

  describe("dealToDeal", () => {
    it("maps to the Deal shape used by /api/deals", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.id).toBe("123");
      expect(deal.name).toBe("Test Project");
      expect(deal.pipeline).toBe("PROJECT");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/deal-reader.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Create the deal reader module**

Create `src/lib/deal-reader.ts`. The implementer should reference the existing `Project` interface in `hubspot.ts` (line ~250) and `transformProject()` in `transforms.ts` to ensure exact field-for-field compatibility. Key mappings:

- `deal.hubspotDealId` → `project.id`
- `deal.dealName` → `project.name`
- `deal.systemPerformanceReview` → coerce string to boolean for `Project.systemPerformanceReview`
- `deal.designDocumentsUrl || deal.designFolderUrl || deal.allDocumentFolderUrl` → `project.designFolderUrl` (three-way fallback chain, matches `hubspot.ts` lines 1064-1067)
- QC metrics: Deal stores days (Decimal); Project stores days (number) — just `Number()` conversion
- Computed fields like `daysToInstall`, `daysSinceClose`, `isActive`, `isBlocked` must be derived from dates/stage, matching existing logic

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/deal-reader.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/deal-reader.ts src/__tests__/deal-reader.test.ts
git commit -m "feat(deal-mirror): add Deal-to-Project/TransformedProject/Deal mappers"
```

---

## Chunk 3: Cron + Webhook + Admin Routes

### Task 5: Create the batch sync cron route

**Files:**
- Create: `src/app/api/cron/deal-sync/route.ts`
- Modify: `vercel.json`

Follow the existing cron pattern from `src/app/api/cron/audit-retention/route.ts`.

- [ ] **Step 1: Create the cron route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { batchSyncPipeline, syncPipelineConfigs } from "@/lib/deal-sync";
import { prisma } from "@/lib/db";
import type { DealPipeline } from "@/generated/prisma";

export const maxDuration = 300; // 5 minutes

const ALL_PIPELINES: DealPipeline[] = ["PROJECT", "SALES", "DNR", "SERVICE", "ROOFING"];

// Determine if this is a full sync cycle (every 6 hours)
function isFullSyncCycle(): boolean {
  const hour = new Date().getUTCHours();
  return hour % 6 === 0 && new Date().getUTCMinutes() < 10;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const full = isFullSyncCycle();
  const results = [];

  // Sync pipeline configs first (stage maps)
  try {
    await syncPipelineConfigs();
  } catch (err) {
    console.error("[deal-sync] Pipeline config sync failed:", err);
    // Continue with deal sync using cached configs
  }

  for (const pipeline of ALL_PIPELINES) {
    try {
      const result = await batchSyncPipeline(pipeline, { full });
      results.push(result);
    } catch (err) {
      console.error(`[deal-sync] ${pipeline} sync failed:`, err);
      results.push({
        pipeline,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    syncType: full ? "full" : "incremental",
    timestamp: new Date().toISOString(),
    results,
  });
}
```

- [ ] **Step 2: Add cron entry and maxDuration to vercel.json**

In `vercel.json`, add to the `functions` object (after the zuper sync-cache entry at line 32):

```json
"src/app/api/cron/deal-sync/route.ts": {
  "maxDuration": 300
}
```

Add to the `crons` array (after the eod-summary entry at line 70):

```json
{
  "path": "/api/cron/deal-sync",
  "schedule": "*/10 * * * *"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/deal-sync/route.ts vercel.json
git commit -m "feat(deal-mirror): add batch sync cron route (10-min cycle)"
```

---

### Task 6: Create the webhook handler

**Files:**
- Create: `src/app/api/webhooks/hubspot/deal-sync/route.ts`

Follow the existing webhook pattern from `src/app/api/webhooks/hubspot/design-complete/route.ts` — signature validation, idempotency, `waitUntil()` for background processing.

- [ ] **Step 1: Create the webhook route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db";
import { syncSingleDeal } from "@/lib/deal-sync";

export const maxDuration = 60;

// Validate HubSpot webhook signature
// Reuse validateHubSpotWebhook() from existing webhook infrastructure
// See: src/app/api/webhooks/hubspot/design-complete/route.ts ~49-62

export async function POST(request: NextRequest) {
  // 1. Validate signature (reuse existing pattern)
  // 2. Parse body — HubSpot sends array of events
  const events = await request.json();

  // Return 200 immediately — process in background
  waitUntil(processEvents(events));

  return NextResponse.json({ received: true });
}

async function processEvents(events: HubSpotWebhookEvent[]) {
  for (const event of events) {
    // Idempotency check via IdempotencyKey table.
    // NOTE: IdempotencyKey has composite unique on (key, scope) and requires
    // status (non-nullable). Use scope="deal-sync" for all deal mirror events.
    const idempotencyKey = String(event.eventId);
    const scope = "deal-sync";
    const exists = await prisma.idempotencyKey.findUnique({
      where: { key_scope: { key: idempotencyKey, scope } },
    });
    if (exists) continue;

    try {
      // Branch by event type (per spec):
      // - deal.deletion: mark stage="DELETED" from objectId alone
      // - deal.merge: mark merged deals "MERGED", fetch surviving deal
      // - deal.creation / deal.propertyChange: fetch + upsert
      const objectId = String(event.objectId);

      if (event.subscriptionType === "deal.deletion") {
        await prisma.deal.updateMany({
          where: { hubspotDealId: objectId },
          data: { stage: "DELETED", lastSyncedAt: new Date(), syncSource: "WEBHOOK" },
        });
        await logSyncEvent(objectId, "WEBHOOK", "deal.deletion", "SUCCESS");
      } else if (event.subscriptionType === "deal.merge") {
        // Mark merged deals, fetch surviving deal
        // event.mergedObjectIds contains the IDs that were merged away
        // Implementation: mark those MERGED, then syncSingleDeal for objectId
        await syncSingleDeal(objectId, "WEBHOOK");
      } else {
        await syncSingleDeal(objectId, "WEBHOOK");
      }

      // Record idempotency key (scope + status required by schema)
      await prisma.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          scope,
          status: "completed",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      console.error(`[deal-sync-webhook] Error processing event ${event.eventId}:`, err);
      await logSyncEvent(
        String(event.objectId),
        "WEBHOOK",
        event.subscriptionType,
        "FAILED",
        err instanceof Error ? err.message : "Unknown"
      );
    }
  }
}

// Type for HubSpot webhook event payload
interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  mergedObjectIds?: number[];
}

async function logSyncEvent(
  hubspotDealId: string,
  syncType: "WEBHOOK",
  source: string,
  status: "SUCCESS" | "FAILED",
  errorMessage?: string
) {
  const deal = await prisma.deal.findUnique({ where: { hubspotDealId } });
  await prisma.dealSyncLog.create({
    data: {
      dealId: deal?.id,
      hubspotDealId,
      syncType: "WEBHOOK",
      source: `webhook:${source}`,
      status,
      errorMessage,
      createdAt: new Date(),
    },
  });
}
```

- [ ] **Step 2: Add maxDuration to vercel.json**

In `vercel.json` functions:

```json
"src/app/api/webhooks/hubspot/deal-sync/route.ts": {
  "maxDuration": 60
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/hubspot/deal-sync/route.ts vercel.json
git commit -m "feat(deal-mirror): add webhook handler for real-time deal sync"
```

---

### Task 7: Create admin endpoints

**Files:**
- Create: `src/app/api/admin/deal-sync/route.ts`
- Create: `src/app/api/admin/deal-sync/[dealId]/route.ts`
- Create: `src/app/api/admin/deal-sync/health/route.ts`

- [ ] **Step 1: Create bulk sync trigger**

`src/app/api/admin/deal-sync/route.ts` — `POST` to trigger sync for all or one pipeline:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { batchSyncPipeline, syncPipelineConfigs } from "@/lib/deal-sync";
import type { DealPipeline } from "@/generated/prisma";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "OWNER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pipeline = body.pipeline as DealPipeline | undefined;
  const pipelines: DealPipeline[] = pipeline
    ? [pipeline]
    : ["PROJECT", "SALES", "DNR", "SERVICE", "ROOFING"];

  await syncPipelineConfigs();
  const results = [];
  for (const p of pipelines) {
    const result = await batchSyncPipeline(p, { full: true });
    results.push(result);
  }

  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Create single-deal sync endpoint**

`src/app/api/admin/deal-sync/[dealId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncSingleDeal } from "@/lib/deal-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "OWNER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { dealId } = await params;
  await syncSingleDeal(dealId, "MANUAL");
  return NextResponse.json({ synced: dealId });
}
```

- [ ] **Step 3: Create health endpoint**

`src/app/api/admin/deal-sync/health/route.ts` — see spec Section: Health Endpoint for the response shape. Query `DealSyncLog` for per-pipeline stats.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/deal-sync/
git commit -m "feat(deal-mirror): add admin sync trigger, single-deal sync, health endpoint"
```

---

### Task 8: Add DealSyncLog to audit retention

**Files:**
- Modify: `src/app/api/cron/audit-retention/route.ts`

- [ ] **Step 1: Add DealSyncLog cleanup**

In the `prisma.$transaction()` array (after the `auditSession.deleteMany` at line ~54), add:

```typescript
prisma.dealSyncLog.deleteMany({
  where: { createdAt: { lt: cutoff } },
}),
```

Update the response to include the new count.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/audit-retention/route.ts
git commit -m "feat(deal-mirror): add DealSyncLog to audit retention cleanup"
```

---

## Chunk 4: API Cutover + Staleness UI

### Task 9: Add feature-flag reader and modify /api/projects

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Modify: `src/app/api/deals/route.ts`

- [ ] **Step 1: Create a helper to read the feature flag**

Add to `src/lib/deal-sync.ts` (or a separate small file):

```typescript
export async function getDealSyncSource(route: string): Promise<"hubspot" | "local-with-verify" | "local"> {
  const config = await prisma.systemConfig.findUnique({
    where: { key: `deal-sync:source:${route}` },
  });
  return (config?.value as "hubspot" | "local-with-verify" | "local") ?? "hubspot";
}
```

- [ ] **Step 2: Add local-DB branch to /api/projects**

In `src/app/api/projects/route.ts`, at the top of the GET handler (before the `appCache.getOrFetch()` call), add a feature-flag check:

```typescript
const syncSource = await getDealSyncSource("projects");

if (syncSource === "local" || syncSource === "local-with-verify") {
  // Read from local Deal table
  const deals = await prisma.deal.findMany({
    where: {
      pipeline: "PROJECT",
      // Apply same filters: location, stage, search, active
      ...(location ? { pbLocation: location } : {}),
      ...(stage ? { stage } : {}),
      ...(active !== "false" ? { NOT: { stage: { in: ["Project Complete", "Cancelled", "On Hold", "DELETED"] } } } : {}),
    },
    orderBy: { dealName: "asc" },
  });

  const projects = deals.map(dealToProject);
  // Transform if needed for the context
  const lastSync = deals[0]?.lastSyncedAt ?? new Date();

  const response = {
    projects,
    count: projects.length,
    sync: {
      source: syncSource,
      lastSyncedAt: lastSync.toISOString(),
      staleness: formatStaleness(lastSync),
      syncHealth: await getSyncHealth("PROJECT"),
    },
  };

  // Shadow verify mode: also fetch from HubSpot and log discrepancies
  if (syncSource === "local-with-verify") {
    // Fire-and-forget: fetch the same data from HubSpot via existing
    // appCache.getOrFetch() path, compare field-by-field against local
    // results, and log mismatches to DealSyncLog with syncType BATCH_FULL
    // and status SUCCESS but changesDetected containing the discrepancies.
    // Use ActivityType.DEAL_SYNC_DISCREPANCY for activity logging.
    verifyAgainstHubSpot(projects).catch(console.error);
  }

  return NextResponse.json(response);
}

// Existing HubSpot path continues below...
```

The implementer should ensure all query params (`location`, `locations`, `stage`, `search`, `context`, `active`, `stats`, `page`, `limit`, `sort`, `order`) are handled in the local-DB branch with equivalent Prisma queries.

- [ ] **Step 3: Add local-DB branch to /api/deals**

Same pattern for `src/app/api/deals/route.ts`. The pipeline param determines which `DealPipeline` enum to filter by. Use `dealToDeal()` mapper.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/deals/route.ts src/lib/deal-sync.ts
git commit -m "feat(deal-mirror): add feature-flag cutover to /api/projects and /api/deals"
```

---

### Task 10: Add staleness indicator to DashboardShell

**Files:**
- Modify: `src/components/DashboardShell.tsx`

- [ ] **Step 1: Add staleness dot component**

Add a small component inside `DashboardShell.tsx` that renders the staleness indicator based on the `sync` metadata in the API response. Show it near the existing `LiveIndicator` / clock area in the header.

Thresholds from spec:
- `< 15 min` → green dot, no text
- `15–30 min` → yellow dot, "Synced 18m ago"
- `> 30 min` → red dot, "Data may be stale — last synced 45m ago"

The implementer should:
1. Add a `syncMeta` prop to `DashboardShellProps`: `syncMeta?: { source: string; lastSyncedAt: string; staleness: string; syncHealth: string }`
2. Render the indicator only when `syncMeta` is provided (backwards compatible)
3. Use existing theme tokens (`text-muted`, `text-foreground`)

- [ ] **Step 2: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "feat(deal-mirror): add staleness indicator to DashboardShell"
```

---

### Task 11: Audit and standardize polling on deal/project consumers

**Files:**
- Modify: various dashboard pages and hooks

Per the spec requirement: before flipping any route to `local` mode, every consumer must have a `refetchInterval`.

- [ ] **Step 1: Audit current polling state**

Search for all consumers of `/api/projects` and `/api/deals`:
- `useProjectData` hook — check its `refetchInterval` setting
- `useProgressiveDeals` hook — check its `refetchInterval`
- `/dashboards/deals/page.tsx` — check if it has polling (spec says it uses manual fetch + SSE with no polling fallback)
- Any other pages that fetch from these routes

Run: `grep -r "api/projects\|api/deals\|useProjectData\|useProgressiveDeals" src/app/dashboards/ src/hooks/ --include="*.tsx" --include="*.ts" -l`

- [ ] **Step 2: Add refetchInterval where missing**

Recommended intervals from spec:
- High-activity dashboards (deals, scheduler, executive): `60_000` (60s)
- Lower-traffic pages: `300_000` (5 min)

For `/dashboards/deals/page.tsx` specifically — add React Query wrapper with `refetchInterval: 60_000` to replace manual fetch + SSE-only pattern.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/ src/hooks/
git commit -m "feat(deal-mirror): standardize refetchInterval on all deal/project consumers"
```

---

### Task 11b: Add sync status widget to admin dashboard

**Files:**
- Modify: the admin dashboard page (find via `grep -r "admin" src/app/suites/admin/`)

- [ ] **Step 1: Create a SyncStatusCard component**

Fetch from `GET /api/admin/deal-sync/health` and render:
- Sync status indicator (green/yellow/red dot based on `status` field)
- Deal counts by pipeline
- Last sync time per pipeline
- Recent errors (if any)
- "Sync Now" button that POSTs to `/api/admin/deal-sync`

Use existing `MetricCard` or `SummaryCard` patterns from `src/components/ui/MetricCard.tsx`.

- [ ] **Step 2: Add the widget to the admin suite page**

- [ ] **Step 3: Commit**

```bash
git add src/app/suites/admin/ src/components/
git commit -m "feat(deal-mirror): add sync status widget to admin dashboard"
```

---

### Task 11c: Register HubSpot webhook subscriptions

**Files:** None (HubSpot configuration, not code)

- [ ] **Step 1: Verify existing HubSpot webhook app configuration**

Check HubSpot Developer Portal → App → Webhooks tab. Note:
- What target URL is configured for the existing app
- Whether existing webhooks (design-complete, ready-to-build, etc.) use the same app or separate registrations
- HubSpot sends ALL subscriptions for one app to the SAME target URL

- [ ] **Step 2: Register new subscriptions**

If existing webhooks use per-route target URLs (separate apps), create a new app or add subscriptions pointing to `/api/webhooks/hubspot/deal-sync`.

If all existing webhooks share one target URL, you'll need a unified dispatcher route that inspects the `subscriptionType` field and routes to the appropriate handler. In that case, add deal-sync event handling to the existing dispatcher or create one.

New subscriptions needed:
- `deal.propertyChange` (for stage, amount, key dates)
- `deal.creation`
- `deal.deletion`
- `deal.merge` (if available on the HubSpot plan)

- [ ] **Step 3: Document the webhook configuration**

Add a note to the webhook route file explaining which HubSpot app and subscriptions point to it.

---

## Chunk 5: Final Integration

### Task 12: Run full test suite and verify build

- [ ] **Step 1: Run all tests**

Run: `npm run test`
Expected: all pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: clean build, no type errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(deal-mirror): address test/build/lint issues"
```

---

### Task 13: Manual verification — initial sync

This task requires a running dev server with database access.

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Trigger pipeline config sync**

```bash
curl -X POST http://localhost:3000/api/admin/deal-sync \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d '{"pipeline": "PROJECT"}'
```

Verify: `DealPipelineConfig` rows created for all 5 pipelines.

- [ ] **Step 3: Trigger PROJECT pipeline sync**

Same endpoint, verify:
- `Deal` rows created for PROJECT pipeline
- `DealSyncLog` entries show SUCCESS
- Row count matches expected (~700 active)

- [ ] **Step 4: Verify feature flag cutover**

Set `deal-sync:source:projects` to `local-with-verify` in SystemConfig. Hit `/api/projects` and verify:
- Response includes `sync` metadata
- Data matches HubSpot (check discrepancy logs)

- [ ] **Step 5: Commit any fixes from manual testing**

```bash
git add -A
git commit -m "fix(deal-mirror): fixes from manual integration testing"
```
