// Mock modules that require runtime dependencies (Prisma client, HubSpot SDK, etc.)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {},
  searchWithRetry: jest.fn(),
  ACTIVE_STAGES: [
    "Project Rejected - Needs Review",
    "Site Survey",
    "Design & Engineering",
    "Permitting & Interconnection",
    "RTB - Blocked",
    "Ready To Build",
    "Construction",
    "Inspection",
    "Permission To Operate",
    "Close Out",
    "On Hold",
  ],
  computeDaysInStage: jest.fn().mockReturnValue(21),
}));

import { dealToProject, dealToTransformedProject, dealToDeal } from "@/lib/deal-reader";

const { Decimal } = require("@prisma/client/runtime/client");

const mockDeal = {
  id: "cuid123",
  hubspotDealId: "12345",
  dealName: "Test Solar Project",
  pipeline: "PROJECT" as const,
  stage: "Construction",
  stageId: "20440342",
  amount: new Decimal("50000"),
  pbLocation: "DTC",
  address: "123 Main St",
  city: "Denver",
  state: "CO",
  zipCode: "80202",
  ahj: "Denver",
  utility: "Xcel Energy",
  projectNumber: "PB-2026-001",
  projectType: "Residential",
  hubspotUrl: "https://app.hubspot.com/contacts/99999/record/0-3/12345",
  tags: "Participate Energy;Premium",
  isParticipateEnergy: true,
  isSiteSurveyScheduled: true,
  isSiteSurveyCompleted: true,
  isDaSent: false,
  isLayoutApproved: false,
  isDesignDrafted: false,
  isDesignCompleted: false,
  isPermitSubmitted: false,
  isPermitIssued: false,
  isIcSubmitted: false,
  isIcApproved: false,
  isInspectionPassed: false,
  hasInspectionFailed: false,
  firstTimeInspectionPass: false,
  hasInspectionFailedNotRejected: false,
  firstTimeInspectionPassNotRejected: false,
  closeDate: new Date("2026-01-15T00:00:00.000Z"),
  installScheduleDate: new Date("2026-04-10T00:00:00.000Z"),
  constructionCompleteDate: null,
  inspectionScheduleDate: null,
  inspectionPassDate: null,
  forecastedInstallDate: new Date("2026-04-15T00:00:00.000Z"),
  forecastedInspectionDate: null,
  forecastedPtoDate: null,
  dateEnteredCurrentStage: new Date("2026-03-20T00:00:00.000Z"),
  createDate: new Date("2025-12-01T00:00:00.000Z"),
  hubspotUpdatedAt: new Date("2026-04-10T12:00:00.000Z"),
  systemSizeKwdc: new Decimal("12.5"),
  moduleCount: 24,
  moduleBrand: "REC",
  moduleModel: "Alpha Pure-R 430",
  moduleWattage: 430,
  moduleName: "REC Alpha Pure-R 430",
  inverterBrand: "Enphase",
  inverterModel: "IQ8M",
  inverterQty: 24,
  inverterSizeKwac: null,
  inverterName: "Enphase IQ8M",
  batteryBrand: null,
  batteryModel: null,
  batteryCount: null,
  batterySizeKwh: null,
  batteryName: null,
  batteryExpansionCount: null,
  batteryExpansionName: null,
  batteryExpansionModel: null,
  evCount: null,
  systemSizeKwac: null,
  hubspotOwnerId: "12345",
  dealOwnerName: "John Smith",
  projectManager: "Jane Doe",
  operationsManager: "Bob Wilson",
  siteSurveyor: "Alice Johnson",
  departmentLeads: { design: "Carol", permit_tech: "Dave", interconnections_tech: "Eve", rtb_lead: "Frank" },
  designDocumentsUrl: null,
  designFolderUrl: "folder123",
  allDocumentFolderUrl: null,
  driveUrl: "https://drive.google.com/folder123",
  openSolarUrl: "https://opensolar.com/123",
  openSolarId: "os-123",
  zuperUid: "zuper-456",
  hubspotContactId: "contact-789",
  systemPerformanceReview: "true",
  siteSurveyScheduleDate: null,
  siteSurveyScheduledDate: null,
  siteSurveyCompletionDate: null,
  dateReturnedFromDesigners: null,
  designStartDate: null,
  designDraftCompletionDate: null,
  designCompletionDate: null,
  designApprovalSentDate: null,
  layoutApprovalDate: null,
  permitSubmitDate: null,
  permitIssueDate: null,
  icSubmitDate: null,
  icApprovalDate: null,
  rtbDate: null,
  inspectionFailDate: null,
  inspectionBookedDate: null,
  ptoStartDate: null,
  ptoCompletionDate: null,
  readyForInspection: null,
  finalInspectionStatus: null,
  inspectionFailCount: null,
  inspectionFailureReason: null,
  installStatus: null,
  designStatus: "Completed",
  surveyStatus: "Completed",
  permittingStatus: null,
  layoutStatus: null,
  icStatus: null,
  ptoStatus: null,
  siteSurveyTurnaroundDays: new Decimal("2.5"),
  designTurnaroundDays: null,
  permitTurnaroundDays: null,
  icTurnaroundDays: null,
  constructionTurnaroundDays: null,
  projectTurnaroundDays: null,
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
  daRevisionCount: null,
  asBuiltRevisionCount: null,
  permitRevisionCount: null,
  icRevisionCount: null,
  totalRevisionCount: null,
  expectedDaysForInstall: 2,
  daysForInstallers: 2,
  daysForElectricians: 1,
  installCrew: "Alpha",
  installDifficulty: 3,
  installNotes: "Standard residential",
  expectedInstallerCount: 4,
  expectedElectricianCount: 2,
  n3ceEvStatus: null,
  n3ceBatteryStatus: null,
  sgipStatus: null,
  pbsrStatus: null,
  cpaStatus: null,
  participateEnergyStatus: "Active",
  discoReco: null,
  interiorAccess: null,
  siteSurveyDocuments: null,
  syncSource: "BATCH",
  rawProperties: null,
  lastSyncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  customerName: "John Customer",
  customerEmail: "john@example.com",
  customerPhone: "303-555-1234",
  hubspotCompanyId: "company-456",
  companyName: "Customer Co",
};

describe("deal-reader", () => {
  describe("dealToProject", () => {
    it("maps hubspotDealId to numeric id", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.id).toBe(12345);
    });

    it("maps dealName to name", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.name).toBe("Test Solar Project");
    });

    it("maps stage and stageId", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.stage).toBe("Construction");
      expect(project.stageId).toBe("20440342");
    });

    it("converts Decimal amount to number", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.amount).toBe(50000);
    });

    it("splits tags by semicolon", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.tags).toEqual(["Participate Energy", "Premium"]);
    });

    it("builds equipment object", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.equipment.modules.brand).toBe("REC");
      expect(project.equipment.modules.count).toBe(24);
    });

    it("maps department leads from JSON", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.designLead).toBe("Carol");
      expect(project.permitLead).toBe("Dave");
    });

    it("computes designFolderUrl with fallback chain", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.designFolderUrl).toBe("folder123");
    });

    it("converts systemPerformanceReview string to boolean", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.systemPerformanceReview).toBe(true);
    });

    it("computes daysSinceClose", () => {
      const project = dealToProject(mockDeal as any);
      expect(typeof project.daysSinceClose).toBe("number");
      expect(project.daysSinceClose).toBeGreaterThan(0);
    });

    it("uses hubspotUrl as project url", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.url).toBe("https://app.hubspot.com/contacts/99999/record/0-3/12345");
    });

    it("maps boolean status flags 1:1", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.isSiteSurveyScheduled).toBe(true);
      expect(project.isSiteSurveyCompleted).toBe(true);
      expect(project.isDASent).toBe(false);
    });

    it("maps isActive based on stage", () => {
      const project = dealToProject(mockDeal as any);
      // Construction is in ACTIVE_STAGES
      expect(project.isActive).toBe(true);
    });

    it("maps isBlocked — false for Construction stage", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.isBlocked).toBe(false);
    });

    it("maps isRtb — false for Construction stage", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.isRtb).toBe(false);
    });

    it("maps isSchedulable — true for Construction stage", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.isSchedulable).toBe(true);
    });

    it("maps QC metrics from Decimal to number", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.siteSurveyTurnaroundTime).toBe(2.5);
    });

    it("maps null QC metrics to null", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.designTurnaroundTime).toBeNull();
    });

    it("maps participateEnergyStatus", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.participateEnergyStatus).toBe("Active");
    });

    it("maps hubspotContactId", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.hubspotContactId).toBe("contact-789");
    });

    it("maps interconnectionsLead and preconstructionLead", () => {
      const project = dealToProject(mockDeal as any);
      expect(project.interconnectionsLead).toBe("Eve");
      expect(project.preconstructionLead).toBe("Frank");
    });

    it("handles null departmentLeads gracefully", () => {
      const dealNoDepts = { ...mockDeal, departmentLeads: null };
      const project = dealToProject(dealNoDepts as any);
      expect(project.designLead).toBe("");
      expect(project.permitLead).toBe("");
    });

    it("uses designDocumentsUrl first in fallback chain", () => {
      const dealWithDocsUrl = {
        ...mockDeal,
        designDocumentsUrl: "primary-docs-url",
        designFolderUrl: "folder123",
      };
      const project = dealToProject(dealWithDocsUrl as any);
      expect(project.designFolderUrl).toBe("primary-docs-url");
    });

    it("falls back to allDocumentFolderUrl when others are null", () => {
      const dealFallback = {
        ...mockDeal,
        designDocumentsUrl: null,
        designFolderUrl: null,
        allDocumentFolderUrl: "fallback-folder",
      };
      const project = dealToProject(dealFallback as any);
      expect(project.designFolderUrl).toBe("fallback-folder");
    });

    it("returns null designFolderUrl when all are null", () => {
      const dealNoFolder = {
        ...mockDeal,
        designDocumentsUrl: null,
        designFolderUrl: null,
        allDocumentFolderUrl: null,
      };
      const project = dealToProject(dealNoFolder as any);
      expect(project.designFolderUrl).toBeNull();
    });

    it("converts systemPerformanceReview 'false' string to boolean false", () => {
      const dealFalse = { ...mockDeal, systemPerformanceReview: "false" };
      const project = dealToProject(dealFalse as any);
      expect(project.systemPerformanceReview).toBe(false);
    });

    it("converts null systemPerformanceReview to false", () => {
      const dealNull = { ...mockDeal, systemPerformanceReview: null };
      const project = dealToProject(dealNull as any);
      expect(project.systemPerformanceReview).toBe(false);
    });

    it("isBlocked true for RTB - Blocked stage", () => {
      const blockedDeal = { ...mockDeal, stage: "RTB - Blocked" };
      const project = dealToProject(blockedDeal as any);
      expect(project.isBlocked).toBe(true);
    });

    it("isRtb true for Ready To Build stage", () => {
      const rtbDeal = { ...mockDeal, stage: "Ready To Build" };
      const project = dealToProject(rtbDeal as any);
      expect(project.isRtb).toBe(true);
    });

    it("isActive false for completed/cancelled stages", () => {
      const completeDeal = { ...mockDeal, stage: "Project Complete" };
      const project = dealToProject(completeDeal as any);
      expect(project.isActive).toBe(false);
    });
  });

  describe("dealToTransformedProject", () => {
    it("returns snake_case fields", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(tp.id).toBe("12345");
      expect(tp.pb_location).toBe("DTC");
      expect(tp.project_type).toBe("Residential");
    });

    it("sets forecast to null", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(tp.forecast).toBeNull();
    });

    it("maps amount as number", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(tp.amount).toBe(50000);
    });

    it("maps stage correctly", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(tp.stage).toBe("Construction");
    });

    it("computes days_since_close as a positive number", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(typeof tp.days_since_close).toBe("number");
      expect(tp.days_since_close).toBeGreaterThan(0);
    });

    it("includes ahj and utility", () => {
      const tp = dealToTransformedProject(mockDeal as any);
      expect(tp.ahj).toBe("Denver");
      expect(tp.utility).toBe("Xcel Energy");
    });
  });

  describe("dealToDeal", () => {
    it("maps to Deal type for sales/service dashboards", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.id).toBe(12345);
      expect(deal.name).toBe("Test Solar Project");
      expect(deal.pipeline).toBe("PROJECT");
      expect(deal.isActive).toBe(true);
    });

    it("computes daysSinceCreate", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(typeof deal.daysSinceCreate).toBe("number");
      expect(deal.daysSinceCreate).toBeGreaterThan(0);
    });

    it("maps location fields", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.pbLocation).toBe("DTC");
      expect(deal.address).toBe("123 Main St");
      expect(deal.city).toBe("Denver");
      expect(deal.state).toBe("CO");
      expect(deal.postalCode).toBe("80202");
    });

    it("maps amount as number", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.amount).toBe(50000);
    });

    it("maps url from hubspotUrl", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.url).toBe("https://app.hubspot.com/contacts/99999/record/0-3/12345");
    });

    it("maps closeDate as ISO string", () => {
      const deal = dealToDeal(mockDeal as any);
      expect(deal.closeDate).toBe("2026-01-15T00:00:00.000Z");
    });

    it("returns null closeDate when not set", () => {
      const dealNoClose = { ...mockDeal, closeDate: null };
      const deal = dealToDeal(dealNoClose as any);
      expect(deal.closeDate).toBeNull();
    });
  });
});
