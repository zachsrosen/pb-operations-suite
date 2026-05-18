import {
  PE_DOC_HUBSPOT_MAP,
  PE_STATUS_TO_HUBSPOT,
  HUBSPOT_TO_PE_STATUS,
  extractHubSpotNotes,
  docNameToStatusProp,
  statusPropToDocName,
  syncPeDocStatusesToHubSpot,
  upsertPeDocFromHubSpot,
} from "@/lib/pe-hubspot-sync";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/db", () => ({
  prisma: {
    peDocumentReview: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("@/lib/db");

// ---------------------------------------------------------------------------
// Mapping constants
// ---------------------------------------------------------------------------

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
    const expected = [
      "NOT_UPLOADED",
      "UPLOADED",
      "UNDER_REVIEW",
      "ACTION_REQUIRED",
      "REJECTED",
      "APPROVED",
    ];
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
    expect(docNameToStatusProp("Permission to Operate (PTO)")).toBe(
      "pe_doc_permission_to_operate",
    );
  });

  test("statusPropToDocName maps HubSpot property to canonical name", () => {
    expect(statusPropToDocName("pe_doc_design_plan")).toBe("Design Plan");
    expect(statusPropToDocName("pe_doc_permission_to_operate")).toBe(
      "Permission to Operate (PTO)",
    );
  });

  test("docNameToStatusProp returns undefined for unknown name", () => {
    expect(docNameToStatusProp("Unknown Doc")).toBeUndefined();
  });

  test("statusPropToDocName handles notes props by stripping _notes suffix", () => {
    expect(statusPropToDocName("pe_doc_design_plan_notes")).toBe("Design Plan");
  });
});

// ---------------------------------------------------------------------------
// extractHubSpotNotes
// ---------------------------------------------------------------------------

describe("extractHubSpotNotes", () => {
  test("extracts Approver segment from pipe-delimited notes", () => {
    const raw =
      "Synced from PE portal scraper (PROJ-8708) | Submitted: 2026-04-16 | Approver: The design plan must be stamped by a PE | Responded: 2026-05-15";
    expect(extractHubSpotNotes(raw)).toBe(
      "The design plan must be stamped by a PE",
    );
  });

  test("extracts Partner segment when present", () => {
    const raw =
      "Synced from PE portal scraper (PROJ-1234) | Partner: Please resubmit with updated specs";
    expect(extractHubSpotNotes(raw)).toBe(
      "Please resubmit with updated specs",
    );
  });

  test("combines Approver and Partner when both present", () => {
    const raw =
      "Synced from PE portal scraper (PROJ-1234) | Partner: Updated file attached | Approver: Looks good now";
    const result = extractHubSpotNotes(raw);
    expect(result).toContain("Updated file attached");
    expect(result).toContain("Looks good now");
  });

  test("returns empty string when no Approver or Partner segments", () => {
    const raw =
      "Synced from PE portal scraper (PROJ-1234) | Submitted: 2026-04-16";
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

// ---------------------------------------------------------------------------
// syncPeDocStatusesToHubSpot
// ---------------------------------------------------------------------------

describe("syncPeDocStatusesToHubSpot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HUBSPOT_ACCESS_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
  });

  test("builds correct batch payload from DB rows", async () => {
    prisma.peDocumentReview.findMany.mockResolvedValue([
      {
        dealId: "123",
        docName: "Design Plan",
        status: "APPROVED",
        notes:
          "Synced from PE portal scraper (PROJ-1234) | Approver: Looks good",
      },
      {
        dealId: "123",
        docName: "Utility Bill",
        status: "NOT_UPLOADED",
        notes: null,
      },
    ]);

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await syncPeDocStatusesToHubSpot(["123"]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.hubapi.com/crm/v3/objects/deals/batch/update",
    );

    const body = JSON.parse(opts.body);
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0].id).toBe("123");
    expect(body.inputs[0].properties.pe_doc_design_plan).toBe("approved");
    expect(body.inputs[0].properties.pe_doc_design_plan_notes).toBe(
      "Looks good",
    );
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
      {
        dealId: "123",
        docName: "Design Plan",
        status: "APPROVED",
        notes: null,
      },
    ]);

    await syncPeDocStatusesToHubSpot(["123"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("logs but does not throw on HubSpot API failure", async () => {
    prisma.peDocumentReview.findMany.mockResolvedValue([
      {
        dealId: "456",
        docName: "Design Plan",
        status: "APPROVED",
        notes: null,
      },
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

  test("deduplicates deal IDs", async () => {
    prisma.peDocumentReview.findMany.mockResolvedValue([
      {
        dealId: "123",
        docName: "Design Plan",
        status: "APPROVED",
        notes: null,
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await syncPeDocStatusesToHubSpot(["123", "123", "123"]);

    // findMany should be called with deduplicated list
    expect(prisma.peDocumentReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dealId: { in: ["123"] } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// upsertPeDocFromHubSpot (echo suppression)
// ---------------------------------------------------------------------------

describe("upsertPeDocFromHubSpot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns skipped-unknown for unrecognized property name", async () => {
    const result = await upsertPeDocFromHubSpot(
      "123",
      "some_random_prop",
      "approved",
    );
    expect(result.action).toBe("skipped-unknown");
  });

  test("returns skipped-unknown for unrecognized status value", async () => {
    prisma.peDocumentReview.findUnique.mockResolvedValue(null);
    const result = await upsertPeDocFromHubSpot(
      "123",
      "pe_doc_design_plan",
      "bogus_status",
    );
    expect(result.action).toBe("skipped-unknown");
  });

  test("echo suppression: skips when DB status matches and reviewedBy is not hubspot-manual", async () => {
    prisma.peDocumentReview.findUnique.mockResolvedValue({
      status: "APPROVED",
      reviewedBy: "pe-scraper-sync",
    });

    const result = await upsertPeDocFromHubSpot(
      "123",
      "pe_doc_design_plan",
      "approved",
    );
    expect(result.action).toBe("skipped-echo");
    expect(prisma.peDocumentReview.upsert).not.toHaveBeenCalled();
  });

  test("echo suppression: does NOT skip when reviewedBy is hubspot-manual (user re-set same value)", async () => {
    prisma.peDocumentReview.findUnique.mockResolvedValue({
      status: "APPROVED",
      reviewedBy: "hubspot-manual",
    });
    prisma.peDocumentReview.upsert.mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot(
      "123",
      "pe_doc_design_plan",
      "approved",
    );
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalled();
  });

  test("echo suppression: does NOT skip when status differs", async () => {
    prisma.peDocumentReview.findUnique.mockResolvedValue({
      status: "NOT_UPLOADED",
      reviewedBy: "pe-scraper-sync",
    });
    prisma.peDocumentReview.upsert.mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot(
      "123",
      "pe_doc_design_plan",
      "approved",
    );
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalled();
  });

  test("upserts when no existing row (new deal)", async () => {
    prisma.peDocumentReview.findUnique.mockResolvedValue(null);
    prisma.peDocumentReview.upsert.mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot(
      "999",
      "pe_doc_utility_bill",
      "uploaded",
    );
    expect(result.action).toBe("upserted");
    expect(prisma.peDocumentReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dealId_docName: { dealId: "999", docName: "Utility Bill" },
        },
      }),
    );
  });

  test("handles _notes property by updating notes column", async () => {
    prisma.peDocumentReview.upsert.mockResolvedValue({});

    const result = await upsertPeDocFromHubSpot(
      "123",
      "pe_doc_design_plan_notes",
      "Manual reviewer comment",
    );
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
