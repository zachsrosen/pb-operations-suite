const mockSearchWithRetry = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  searchWithRetry: (...args: unknown[]) => mockSearchWithRetry(...args),
  DEAL_STAGE_MAP: { "71052436": "RTB - Blocked", "22580871": "Ready To Build" },
}));

import { fetchRtbQueue } from "@/lib/rtb-review";

describe("fetchRtbQueue", () => {
  beforeEach(() => mockSearchWithRetry.mockReset());

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
            permit_completion_date: "2026-07-01T00:00:00Z",
            // raw HubSpot option *values* that differ from their display labels
            permitting_status: "Complete",
            design_status: "DA Approved",
            total_revision_count: "2",
            pm_rtb_approved: "false",
            hs_lastmodifieddate: "2026-07-06T00:00:00Z",
          },
        },
      ],
    });
    const rows = await fetchRtbQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dealId: "111",
      dealName: "PROJ-1000 - Smith",
      location: "Westminster",
      dealStage: "RTB - Blocked",
      permitIssueDate: "2026-07-01T00:00:00Z",
      // resolved to display labels, not the raw values
      permittingStatus: "Permit Issued",
      designStatus: "Final Design Review",
      approved: false,
    });
    const req = mockSearchWithRetry.mock.calls[0][0];
    const flat = JSON.stringify(req.filterGroups);
    expect(flat).toContain("6900017");
    expect(flat).toContain("71052436");
  });

  it("returns [] when no deals are parked", async () => {
    mockSearchWithRetry.mockResolvedValue({ results: [] });
    expect(await fetchRtbQueue()).toEqual([]);
  });
});
