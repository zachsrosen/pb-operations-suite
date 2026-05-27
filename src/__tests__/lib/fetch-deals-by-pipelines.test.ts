import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { fetchDealsByPipelines, hubspotClient } from "@/lib/hubspot";

describe("fetchDealsByPipelines", () => {
  let searchSpy: jest.SpyInstance;
  let batchReadSpy: jest.SpyInstance;
  let ownersGetPageSpy: jest.SpyInstance;

  beforeEach(() => {
    searchSpy = jest
      .spyOn(hubspotClient.crm.deals.searchApi, "doSearch")
      .mockResolvedValue({ results: [], paging: undefined } as never);
    batchReadSpy = jest
      .spyOn(hubspotClient.crm.deals.batchApi, "read")
      .mockResolvedValue({ results: [] } as never);
    ownersGetPageSpy = jest
      .spyOn(hubspotClient.crm.owners.ownersApi, "getPage")
      .mockResolvedValue({ results: [], paging: undefined } as never);
  });

  afterEach(() => {
    searchSpy.mockRestore();
    batchReadSpy.mockRestore();
    ownersGetPageSpy.mockRestore();
  });

  it("queries HubSpot with IN filter on multiple pipeline IDs", async () => {
    await fetchDealsByPipelines(["6900017", "23928924"], false);

    expect(searchSpy).toHaveBeenCalled();
    const callArg = searchSpy.mock.calls[0][0];
    const pipelineFilter = callArg.filterGroups[0].filters.find(
      (f: { propertyName: string }) => f.propertyName === "pipeline"
    );
    expect(pipelineFilter).toBeDefined();
    expect(pipelineFilter.operator).toBe(FilterOperatorEnum.In);
    expect(pipelineFilter.values).toEqual(["6900017", "23928924"]);
  });

  it("returns empty array when no deals match", async () => {
    const result = await fetchDealsByPipelines(["6900017"], true);
    expect(result).toEqual([]);
  });

  it("excludes terminal stages when activeOnly=true", async () => {
    await fetchDealsByPipelines(["21997330"], true); // D&R pipeline

    const callArg = searchSpy.mock.calls[0][0];
    const stageFilters = callArg.filterGroups[0].filters.filter(
      (f: { propertyName: string }) => f.propertyName === "dealstage"
    );
    // D&R terminal stages should be filtered: Complete (68245827), Cancelled (52474745), On-hold (72700977)
    expect(stageFilters.length).toBeGreaterThanOrEqual(3);
    expect(
      stageFilters.every(
        (f: { operator: string }) => f.operator === FilterOperatorEnum.Neq
      )
    ).toBe(true);
  });
});
