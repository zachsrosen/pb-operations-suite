jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      deals: {
        searchApi: { doSearch: jest.fn() },
        basicApi: { getById: jest.fn(), update: jest.fn() },
      },
    },
  },
  searchWithRetry: jest.fn(),
  resolveHubSpotOwnerContact: jest.fn(),
}));
jest.mock("@/lib/db", () => ({
  prisma: {
    idrMeetingSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    idrMeetingItem: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    idrMeetingNote: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import {
  snapshotDealProperties,
  computeReadinessBadge,
  buildHubSpotNoteBody,
  buildHubSpotPropertyUpdates,
} from "@/lib/idr-meeting";

describe("snapshotDealProperties", () => {
  it("extracts and maps deal properties to snapshot fields", () => {
    const properties = {
      dealname: "PROJ-9612 | Pieren | 1234 Elm St",
      pb_location: "Westminster",
      project_type: "Solar + Battery",
      address_line_1: "1234 Elm St",
      city: "Denver",
      state: "CO",
      calculated_system_size__kwdc_: "8.4",
      site_survey_status: "Completed",
      site_survey_date: "2026-03-27",
      design_status: "Initial Review",
      design_draft_completion_date: "2026-03-30",
      all_document_parent_folder_id: "https://drive.google.com/drive/folders/abc123",
      site_survey_documents: "https://drive.google.com/drive/folders/def456",
      design_documents: "https://drive.google.com/drive/folders/ghi789",
      module_brand: "Hyundai",
      module_model: "HiE-S440HG",
      module_count: "16",
      inverter_brand: "Tesla",
      battery_brand: "Tesla",
      battery_count: "1",
      is_site_survey_completed_: "true",
      ahj: "Denver",
      utility_company: "Xcel Energy",
      link_to_opensolar: "Yes",
      os_project_link: "https://app.opensolar.com/project/123",
    };
    const snapshot = snapshotDealProperties(properties);
    expect(snapshot.dealName).toBe("PROJ-9612 | Pieren | 1234 Elm St");
    expect(snapshot.region).toBe("Westminster");
    expect(snapshot.systemSizeKw).toBe(8.4);
    expect(snapshot.surveyCompleted).toBe(true);
    expect(snapshot.plansetDate).toBe("2026-03-30");
    expect(snapshot.equipmentSummary).toContain("Hyundai");
    expect(snapshot.ahj).toBe("Denver");
    expect(snapshot.utilityCompany).toBe("Xcel Energy");
    expect(snapshot.openSolarUrl).toBe("https://app.opensolar.com/project/123");
  });
});

describe("computeReadinessBadge", () => {
  it("returns green when survey complete and planset uploaded", () => {
    expect(computeReadinessBadge(true, "2026-03-30")).toBe("green");
  });
  it("returns yellow when survey complete but no planset", () => {
    expect(computeReadinessBadge(true, null)).toBe("yellow");
  });
  it("returns orange when planset uploaded but survey not complete", () => {
    expect(computeReadinessBadge(false, "2026-03-30")).toBe("orange");
  });
  it("returns red when neither", () => {
    expect(computeReadinessBadge(false, null)).toBe("red");
  });
});

describe("buildHubSpotNoteBody", () => {
  it("builds formatted note with only non-empty fields", () => {
    const item = {
      difficulty: 3,
      installerCount: 2,
      installerDays: 1,
      electricianCount: 1,
      electricianDays: 1,
      discoReco: false,
      interiorAccess: false,
      customerNotes: "Wants panels hidden",
      operationsNotes: "Standard roof mount",
      designNotes: "South-facing, no shade",
      conclusion: "Approved for design",
    };
    const body = buildHubSpotNoteBody(item, "2026-04-01");
    expect(body).toContain("IDR Meeting -- 4/1/2026");
    expect(body).toContain("<strong>Customer Notes:</strong> Wants panels hidden");
    expect(body).toContain("<strong>Difficulty:</strong> 3/5");
    expect(body).not.toContain("undefined");
  });

  it("omits empty fields", () => {
    const item = {
      difficulty: null,
      installerCount: null,
      installerDays: null,
      electricianCount: null,
      electricianDays: null,
      discoReco: null,
      interiorAccess: null,
      customerNotes: null,
      operationsNotes: "Just ops notes",
      designNotes: null,
      conclusion: null,
    };
    const body = buildHubSpotNoteBody(item, "2026-04-01");
    expect(body).toContain("<strong>Operation Notes:</strong> Just ops notes");
    expect(body).not.toContain("Customer Notes");
    expect(body).not.toContain("Difficulty");
  });
});

describe("buildHubSpotPropertyUpdates", () => {
  it("maps item fields to HubSpot property names", () => {
    const updates = buildHubSpotPropertyUpdates({
      difficulty: 3,
      installerCount: 2,
      installerDays: 1,
      electricianCount: 1,
      electricianDays: 1,
      discoReco: true,
      interiorAccess: false,
      operationsNotes: "Standard install",
      needsSurveyInfo: null,
      needsResurvey: null,
      salesChangeRequested: null,
      salesChangeNotes: null,
      opsChangeNotes: null,
    });
    expect(updates.install_difficulty).toBe("3");
    expect(updates.expected_installer_cont).toBe("2");
    expect(updates.days_for_installers).toBe("1");
    expect(updates.expected_electrician_count).toBe("1");
    expect(updates.days_for_electricians).toBe("1");
    expect(updates.disco__reco).toBe("true");
    expect(updates.interior_access).toBe("false");
    expect(updates.notes_for_install).toBe("Standard install");
  });

  it("skips null fields", () => {
    const updates = buildHubSpotPropertyUpdates({
      difficulty: 3,
      installerCount: null,
      installerDays: null,
      electricianCount: null,
      electricianDays: null,
      discoReco: null,
      interiorAccess: null,
      operationsNotes: null,
      needsSurveyInfo: null,
      needsResurvey: null,
      salesChangeRequested: null,
      salesChangeNotes: null,
      opsChangeNotes: null,
    });
    expect(updates.install_difficulty).toBe("3");
    expect(updates).not.toHaveProperty("expected_installer_cont");
    expect(updates).not.toHaveProperty("notes_for_install");
  });
});
