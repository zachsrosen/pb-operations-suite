const mockSearchWithRetry = jest.fn();
const mockFetchLineItemsForDeals = jest.fn();
const mockResolveOwner = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: (...args: unknown[]) => mockSearchWithRetry(...args),
  fetchLineItemsForDeals: (...args: unknown[]) => mockFetchLineItemsForDeals(...args),
  resolveHubSpotOwnerContact: (...args: unknown[]) => mockResolveOwner(...args),
  DEAL_STAGE_MAP: { "71052436": "RTB - Blocked", "22580871": "Ready To Build" },
}));

const mockEarliestInstallAvailability = jest.fn();
jest.mock("@/lib/install-availability", () => ({
  earliestInstallAvailability: (...a: unknown[]) => mockEarliestInstallAvailability(...a),
}));

import { fetchRtbQueue } from "@/lib/rtb-review";

// entered RTB-Blocked exactly 10 days before the test runs
const ENTERED_STAGE_AT = new Date(Date.now() - 10 * 86_400_000).toISOString();

describe("fetchRtbQueue", () => {
  beforeEach(() => {
    mockSearchWithRetry.mockReset();
    mockFetchLineItemsForDeals.mockReset();
    mockFetchLineItemsForDeals.mockResolvedValue([]);
    mockResolveOwner.mockReset();
    mockResolveOwner.mockResolvedValue(null);
    mockEarliestInstallAvailability.mockReset();
    mockEarliestInstallAvailability.mockResolvedValue(new Map());
  });

  it("shapes RTB-Blocked deals into queue rows with resolved labels", async () => {
    mockSearchWithRetry.mockResolvedValue({
      results: [
        {
          id: "111",
          properties: {
            dealname: "PROJ-1000 - Smith",
            dealstage: "71052436",
            pipeline: "6900017",
            pb_location: "Westminster",
            project_manager: "212300959",
            permit_completion_date: "2026-07-01T00:00:00Z",
            permitting_status: "Complete",
            interconnection_status: "Signature Acquired By Customer",
            rtb_blocked_reason: "Waiting on utility meter release",
            install_status: "Ready to Build",
            all_document_parent_folder_id: "1PVPgD83LcjB4iUHHYrHhZeyYCdJakMRk",
            project_type: "Solar",
            amount: "30105.6",
            da_invoice_status: "Paid In Full",
            payment_method: "Wheelhouse 12 year 4.49%",
            loan_status: "Funding Secured",
            hs_v2_date_entered_71052436: ENTERED_STAGE_AT,
            pm_rtb_approved: "false",
            pm_rtb_approved_date: "1751500800000",
            hs_lastmodifieddate: "2026-07-06T00:00:00Z",
          },
        },
      ],
    });
    mockFetchLineItemsForDeals.mockResolvedValue([
      { dealId: "111", name: "Q.TRON BLK M-G2+ 425W", quantity: 18, productCategory: "MODULE" },
      { dealId: "111", name: "Tesla Powerwall 3", quantity: 1, productCategory: "BATTERY" },
      { dealId: "999", name: "Other deal item", quantity: 5, productCategory: "MODULE" },
    ]);
    mockResolveOwner.mockResolvedValue({
      id: "212300959",
      name: "Jane PM",
      email: "jane@photonbrothers.com",
    });
    mockEarliestInstallAvailability.mockResolvedValue(
      new Map([["Westminster", "2026-07-15"]])
    );

    const rows = await fetchRtbQueue();
    expect(rows).toHaveLength(1);
    expect(mockResolveOwner).toHaveBeenCalledWith("212300959");
    expect(rows[0]).toMatchObject({
      dealId: "111",
      dealName: "PROJ-1000 - Smith",
      location: "Westminster",
      // resolved from the project_manager userId via the owner directory
      projectManager: "Jane PM",
      dealStage: "RTB - Blocked",
      permitIssueDate: "2026-07-01T00:00:00Z",
      // resolved to display label, not the raw value
      // permitting_status value "Complete" displays as "Permit Issued"
      permittingStatus: "Permit Issued",
      interconnectionStatus: "Ready To Submit",
      rtbBlockedReason: "Waiting on utility meter release",
      constructionStatus: "Ready to Build",
      driveFolderUrl:
        "https://drive.google.com/drive/folders/1PVPgD83LcjB4iUHHYrHhZeyYCdJakMRk",
      projectType: "Solar",
      amount: 30105.6,
      enteredStageAt: ENTERED_STAGE_AT,
      daysInStage: 10,
      paymentMethod: "Wheelhouse 12 year 4.49%",
      // loan_status value "Funding Secured" displays as "Approved"
      loanStatus: "Approved",
      earliestInstallDate: "2026-07-15",
      releasedDate: "1751500800000",
      daStatus: "Paid In Full",
      daPaid: true,
      approved: false,
    });
    // only THIS deal's line items, in {name, quantity, category} shape
    expect(rows[0].lineItems).toEqual([
      { name: "Q.TRON BLK M-G2+ 425W", quantity: 18, category: "MODULE" },
      { name: "Tesla Powerwall 3", quantity: 1, category: "BATTERY" },
    ]);
    expect(mockFetchLineItemsForDeals).toHaveBeenCalledWith(["111"]);

    const req = mockSearchWithRetry.mock.calls[0][0];
    const flat = JSON.stringify(req.filterGroups);
    expect(flat).toContain("6900017");
    expect(flat).toContain("71052436");
  });

  it("returns [] when no deals are parked (and skips the line-item fetch)", async () => {
    mockSearchWithRetry.mockResolvedValue({ results: [] });
    expect(await fetchRtbQueue()).toEqual([]);
    expect(mockFetchLineItemsForDeals).not.toHaveBeenCalled();
  });

  it("still returns rows when the line-item fetch fails", async () => {
    mockSearchWithRetry.mockResolvedValue({
      results: [{ id: "111", properties: { dealname: "PROJ-1000", dealstage: "71052436" } }],
    });
    mockFetchLineItemsForDeals.mockRejectedValue(new Error("hubspot down"));
    const rows = await fetchRtbQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0].lineItems).toEqual([]);
  });

  it("targets the Ready To Build stage when stage='ready'", async () => {
    const entered = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mockSearchWithRetry.mockResolvedValue({
      results: [
        {
          id: "222",
          properties: {
            dealname: "PROJ-2000 - Jones",
            dealstage: "22580871",
            hs_v2_date_entered_22580871: entered,
            pm_rtb_approved: "true",
          },
        },
      ],
    });

    const rows = await fetchRtbQueue("ready");

    const req = mockSearchWithRetry.mock.calls[0][0];
    const flat = JSON.stringify(req.filterGroups);
    expect(flat).toContain("22580871");
    expect(flat).not.toContain("71052436");
    expect(rows[0]).toMatchObject({
      dealId: "222",
      dealStage: "Ready To Build",
      daysInStage: 3,
      approved: true,
    });
  });
});
