const mockSearchWithRetry = jest.fn();
const mockFetchLineItemsForDeals = jest.fn();
const mockResolveOwner = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: (...args: unknown[]) => mockSearchWithRetry(...args),
  fetchLineItemsForDeals: (...args: unknown[]) => mockFetchLineItemsForDeals(...args),
  resolveHubSpotOwnerContact: (...args: unknown[]) => mockResolveOwner(...args),
  DEAL_STAGE_MAP: { "71052436": "RTB - Blocked", "22580871": "Ready To Build" },
}));

import { fetchRtbQueue } from "@/lib/rtb-review";

describe("fetchRtbQueue", () => {
  beforeEach(() => {
    mockSearchWithRetry.mockReset();
    mockFetchLineItemsForDeals.mockReset();
    mockFetchLineItemsForDeals.mockResolvedValue([]);
    mockResolveOwner.mockReset();
    mockResolveOwner.mockResolvedValue(null);
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
            interconnection_status: "Signature Acquired By Customer",
            rtb_blocked_reason: "Waiting on utility meter release",
            install_status: "Ready to Build",
            all_document_parent_folder_id: "1PVPgD83LcjB4iUHHYrHhZeyYCdJakMRk",
            da_invoice_status: "Paid In Full",
            pm_rtb_approved: "false",
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
      interconnectionStatus: "Ready To Submit",
      rtbBlockedReason: "Waiting on utility meter release",
      constructionStatus: "Ready to Build",
      driveFolderUrl:
        "https://drive.google.com/drive/folders/1PVPgD83LcjB4iUHHYrHhZeyYCdJakMRk",
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
});
