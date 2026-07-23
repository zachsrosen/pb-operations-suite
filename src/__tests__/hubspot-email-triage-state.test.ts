import { fetchTriageState } from "../../scripts/hubspot-email-triage-state";

// DEAL_STAGE_MAP must be in the mock — toRow indexes it, and a bare
// jest.fn()-only factory leaves it undefined, throwing on every row build.
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: jest.fn(),
  DEAL_STAGE_MAP: { "68229430": "Close Out" },
}));
jest.mock("@/lib/pe-api", () => ({ listAllProjects: jest.fn() }));

import { searchWithRetry } from "@/lib/hubspot";
import { listAllProjects, type PeProjectListItem } from "@/lib/pe-api";

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

  it("captures loose ends, cancellation, and per-rejection-type causes", async () => {
    mockSearch.mockResolvedValue({
      results: [
        {
          id: "77",
          properties: {
            dealname: "PROJ-9584 | Bitz, Lauren",
            loose_ends_remaining_: "Yes",
            loose_end_notes_: "Conduit strap missing on south run",
            cancellation_reason: "Customer financing fell through",
            cancellation_reason_category: "financing_credit",
            cancellation_date: "2026-07-02",
            cause_of_permit_rejection_: "Design Quality Issue",
            cause_of_interconnection_rejection_: "Utility Error",
            design_approval_rejection_reason: "Wrong panel count on page 3",
            pto_rejection_reason: "Photos illegible",
            inspection_rejection_reason: "As-built missing conduit run",
          },
        },
      ],
    });

    const row = (await fetchTriageState(["PROJ-9584"])).rows["PROJ-9584"];

    expect(row.looseEnds).toEqual({
      remaining: "Yes",
      notes: "Conduit strap missing on south run",
    });
    expect(row.reasons).toMatchObject({
      cancellation: "Customer financing fell through",
      cancellationCategory: "financing_credit",
      permitRejectionCause: "Design Quality Issue",
      interconnectionRejectionCause: "Utility Error",
      daRejection: "Wrong panel count on page 3",
      ptoRejection: "Photos illegible",
      asBuiltRevision: "As-built missing conduit run",
    });
    expect(row.dates.cancelled).toBe("2026-07-02");
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
