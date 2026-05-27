import { hubspotClient } from "@/lib/hubspot";
import { fetchClosedTicketsSince } from "@/lib/hubspot-tickets";

describe("fetchClosedTicketsSince", () => {
  let searchSpy: jest.SpyInstance;
  let batchReadSpy: jest.SpyInstance;
  let pipelineSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    // Stub the pipeline-stages fetch that getTicketStageMap() makes.
    // We do this at the HubSpot client level because getTicketStageMap is in the
    // same module as fetchClosedTicketsSince and can't be jest.mock'd indirectly.
    pipelineSpy = jest
      .spyOn(hubspotClient.crm.pipelines.pipelinesApi, "getById")
      .mockResolvedValue({
        stages: [
          { id: "open-stage-id", label: "Open", displayOrder: 0 },
          { id: "closed-stage-id", label: "Closed", displayOrder: 1 },
        ],
      } as never);
    searchSpy = jest.spyOn(hubspotClient.crm.tickets.searchApi, "doSearch");
    batchReadSpy = jest.spyOn(hubspotClient.crm.tickets.batchApi, "read");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters by hs_lastclosedate >= sinceIso", async () => {
    searchSpy.mockResolvedValueOnce({ results: [], paging: undefined } as never);

    await fetchClosedTicketsSince("2026-05-19T00:00:00Z");

    const callArg = searchSpy.mock.calls[0][0];
    const closeDateFilter = callArg.filterGroups[0].filters.find(
      (f: { propertyName: string }) => f.propertyName === "hs_lastclosedate"
    );
    expect(closeDateFilter).toBeDefined();
    expect(closeDateFilter.operator).toBe("GTE");
    expect(closeDateFilter.value).toBe("2026-05-19T00:00:00Z");
    expect(pipelineSpy).toHaveBeenCalled();
  });

  it("computes resolutionHours from createDate and closedDate", async () => {
    searchSpy.mockResolvedValueOnce({
      results: [{ id: "T1" }],
      paging: undefined,
    } as never);
    batchReadSpy.mockResolvedValueOnce({
      results: [
        {
          id: "T1",
          properties: {
            hs_object_id: "T1",
            subject: "X",
            createdate: "2026-05-20T00:00:00Z",
            hs_lastclosedate: "2026-05-20T06:00:00Z",
            hs_pipeline_stage: "closed-stage-id",
          },
        },
      ],
    } as never);

    const result = await fetchClosedTicketsSince("2026-05-19T00:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0].resolutionHours).toBe(6);
    expect(result[0].subject).toBe("X");
    expect(result[0].stageName).toBe("Closed");
  });
});
