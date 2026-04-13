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

  it("uses raw stageOrder for SERVICE pipeline", () => {
    const serviceStages = ["New", "In Progress", "Completed", "Closed Won"];
    const serialized = { ...serializeDeal(mockDeal as any), pipeline: "SERVICE", stage: "In Progress" };
    const result = buildTimelineStages("SERVICE", serviceStages, serialized);
    expect(result.map(s => s.label)).toEqual(serviceStages);
    expect(result.find(s => s.label === "In Progress")?.isCurrent).toBe(true);
  });
});
