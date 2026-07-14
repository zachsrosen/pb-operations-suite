/**
 * Regression: a transient empty HubSpot search must NOT resolve to [] (which the
 * shared PROJECTS_ALL cache would store, blanking every dashboard for the TTL).
 * fetchAllProjects must throw so the empty is never cached.
 */
import { fetchAllProjects, hubspotClient } from "@/lib/hubspot";

describe("fetchAllProjects — transient empty search guard", () => {
  const doSearch = jest.spyOn(hubspotClient.crm.deals.searchApi, "doSearch");

  afterEach(() => doSearch.mockReset());
  afterAll(() => doSearch.mockRestore());

  it("throws when the search reports deals but returns no rows", async () => {
    doSearch.mockResolvedValue({ total: 4213, results: [], paging: undefined } as never);
    await expect(fetchAllProjects({ activeOnly: false })).rejects.toThrow(/transient failure/i);
  });

  it("throws on a spurious total:0 empty page (the gap the earlier fix missed)", async () => {
    doSearch.mockResolvedValue({ total: 0, results: [], paging: undefined } as never);
    await expect(fetchAllProjects({ activeOnly: false })).rejects.toThrow(/transient failure/i);
  });
});
