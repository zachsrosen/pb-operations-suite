import { hubspotClient } from "@/lib/hubspot";
import { fetchClosedTicketsSince } from "@/lib/hubspot-tickets";

describe("fetchClosedTicketsSince", () => {
  let searchSpy: jest.SpyInstance;
  let batchReadSpy: jest.SpyInstance;
  let pipelineSpy: jest.SpyInstance;
  let assocReadSpy: jest.SpyInstance;
  let dealsReadSpy: jest.SpyInstance;

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
    // Default association + deal-read stubs (empty) so the resolveTicketLocations
    // call from fetchClosedTicketsSince doesn't hit the network. Individual tests
    // can override these via mockResolvedValueOnce.
    assocReadSpy = jest
      .spyOn(hubspotClient.crm.associations.batchApi, "read")
      .mockResolvedValue({ results: [] } as never);
    dealsReadSpy = jest
      .spyOn(hubspotClient.crm.deals.batchApi, "read")
      .mockResolvedValue({ results: [] } as never);
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
    const pipelineFilter = callArg.filterGroups[0].filters.find(
      (f: { propertyName: string }) => f.propertyName === "hs_pipeline"
    );
    expect(pipelineFilter).toBeDefined();
    expect(pipelineFilter.operator).toBe("EQ");
    expect(pipelineFilter.value).toBeTruthy();
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

  it("populates _derivedLocation from ticket→deal.pb_location association", async () => {
    searchSpy.mockResolvedValueOnce({
      results: [{ id: "T1" }],
      paging: undefined,
    } as never);
    // Ticket has no pb_location of its own — must fall back to deal
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
    // Ticket T1 → Deal D1
    assocReadSpy.mockResolvedValueOnce({
      results: [{ _from: { id: "T1" }, to: [{ id: "D1" }] }],
    } as never);
    // Deal D1 has pb_location = Westminster
    dealsReadSpy.mockResolvedValueOnce({
      results: [{ id: "D1", properties: { pb_location: "Westminster" } }],
    } as never);

    const result = await fetchClosedTicketsSince("2026-05-19T00:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0]._derivedLocation).toBe("Westminster");
    expect(assocReadSpy).toHaveBeenCalled();
    expect(dealsReadSpy).toHaveBeenCalled();
  });

  it("prefers ticket-level pb_location over derived deal location", async () => {
    searchSpy.mockResolvedValueOnce({
      results: [{ id: "T2" }],
      paging: undefined,
    } as never);
    batchReadSpy.mockResolvedValueOnce({
      results: [
        {
          id: "T2",
          properties: {
            hs_object_id: "T2",
            subject: "Y",
            createdate: "2026-05-20T00:00:00Z",
            hs_lastclosedate: "2026-05-20T03:00:00Z",
            hs_pipeline_stage: "closed-stage-id",
            pb_location: "DTC",
          },
        },
      ],
    } as never);
    // Deal would say Westminster, but ticket-level DTC wins
    assocReadSpy.mockResolvedValueOnce({
      results: [{ _from: { id: "T2" }, to: [{ id: "D2" }] }],
    } as never);
    dealsReadSpy.mockResolvedValueOnce({
      results: [{ id: "D2", properties: { pb_location: "Westminster" } }],
    } as never);

    const result = await fetchClosedTicketsSince("2026-05-19T00:00:00Z");
    expect(result).toHaveLength(1);
    expect(result[0]._derivedLocation).toBe("DTC");
  });
});
