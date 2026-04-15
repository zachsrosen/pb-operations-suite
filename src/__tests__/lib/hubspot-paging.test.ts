/**
 * Tests for cursor-paged HubSpot search helpers used by the property-object
 * backfill streaming script (Task 4.2):
 *   - searchHubSpotContactsWithDeals
 *   - searchAllHubSpotDeals
 *   - searchAllHubSpotTickets
 *
 * Each verifies:
 *   - `after` is forwarded to the HubSpot search body
 *   - the return value has `{ results, paging }` shape
 *   - `after: null` is normalized to `undefined` in the request body
 *     (HubSpot rejects `null`)
 *   - rate-limit errors propagate to the caller (not swallowed)
 */

const contactsSearch = jest.fn();
const dealsSearch = jest.fn();
const ticketsSearch = jest.fn();

jest.mock("@hubspot/api-client", () => ({
  Client: jest.fn().mockImplementation(() => ({
    crm: {
      contacts: {
        searchApi: {
          doSearch: (body: unknown) => contactsSearch(body),
        },
      },
      deals: {
        searchApi: {
          doSearch: (body: unknown) => dealsSearch(body),
        },
      },
      tickets: {
        searchApi: {
          doSearch: (body: unknown) => ticketsSearch(body),
        },
      },
      associations: { batchApi: { read: jest.fn() } },
      lineItems: { batchApi: { read: jest.fn() } },
    },
  })),
}));

jest.mock("@hubspot/api-client/lib/codegen/crm/deals", () => ({
  FilterOperatorEnum: {},
}));

describe("cursor-paged HubSpot search helpers", () => {
  beforeEach(() => {
    contactsSearch.mockReset();
    dealsSearch.mockReset();
    ticketsSearch.mockReset();
  });

  describe("searchHubSpotContactsWithDeals", () => {
    it("forwards `after` cursor and returns {results, paging}", async () => {
      contactsSearch.mockResolvedValue({
        results: [{ id: "c1", properties: { firstname: "A", lastname: "B" } }],
        paging: { next: { after: "cursor-2" } },
      });

      const { searchHubSpotContactsWithDeals } = await import("@/lib/hubspot");
      const page = await searchHubSpotContactsWithDeals("cursor-1");

      expect(contactsSearch).toHaveBeenCalledTimes(1);
      const body = contactsSearch.mock.calls[0][0];
      expect(body.after).toBe("cursor-1");
      expect(body.limit).toBe(100);
      expect(body.filterGroups[0].filters[0]).toEqual({
        propertyName: "num_associated_deals",
        operator: "GT",
        value: "0",
      });
      expect(body.properties).toEqual(
        expect.arrayContaining(["firstname", "lastname", "email", "address", "city", "state", "zip"])
      );
      expect(page.results).toHaveLength(1);
      expect(page.paging?.next?.after).toBe("cursor-2");
    });

    it("normalizes `after: null` to undefined in the request body", async () => {
      contactsSearch.mockResolvedValue({ results: [], paging: undefined });

      const { searchHubSpotContactsWithDeals } = await import("@/lib/hubspot");
      await searchHubSpotContactsWithDeals(null);

      const body = contactsSearch.mock.calls[0][0];
      expect(body.after).toBeUndefined();
      // Important: must not be `null` — HubSpot rejects null explicitly.
      expect(body.after).not.toBeNull();
    });

    it("propagates rate-limit errors (after retry exhaustion)", async () => {
      const err = Object.assign(new Error("429 Too Many Requests"), { code: 429 });
      contactsSearch.mockRejectedValue(err);

      const { searchHubSpotContactsWithDeals } = await import("@/lib/hubspot");
      await expect(searchHubSpotContactsWithDeals(null)).rejects.toThrow(/429/);
    }, 60_000);
  });

  describe("searchAllHubSpotDeals", () => {
    it("forwards `after` cursor and sorts by createdate ASCENDING", async () => {
      dealsSearch.mockResolvedValue({
        results: [{ id: "d1", properties: { dealname: "X" } }],
        paging: { next: { after: "deal-cursor-2" } },
      });

      const { searchAllHubSpotDeals } = await import("@/lib/hubspot");
      const page = await searchAllHubSpotDeals("deal-cursor-1");

      expect(dealsSearch).toHaveBeenCalledTimes(1);
      const body = dealsSearch.mock.calls[0][0];
      expect(body.after).toBe("deal-cursor-1");
      expect(body.limit).toBe(100);
      expect(body.filterGroups).toEqual([]);
      expect(body.sorts).toEqual([{ propertyName: "createdate", direction: "ASCENDING" }]);
      expect(body.properties).toEqual(["dealname", "pipeline", "dealstage", "createdate"]);
      expect(page.results).toHaveLength(1);
      expect(page.paging?.next?.after).toBe("deal-cursor-2");
    });

    it("normalizes `after: null` to undefined in the request body", async () => {
      dealsSearch.mockResolvedValue({ results: [] });

      const { searchAllHubSpotDeals } = await import("@/lib/hubspot");
      await searchAllHubSpotDeals(null);

      const body = dealsSearch.mock.calls[0][0];
      expect(body.after).toBeUndefined();
      expect(body.after).not.toBeNull();
    });

    it("propagates rate-limit errors", async () => {
      const err = Object.assign(new Error("HubSpot 429 secondly limit"), { code: 429 });
      dealsSearch.mockRejectedValue(err);

      const { searchAllHubSpotDeals } = await import("@/lib/hubspot");
      await expect(searchAllHubSpotDeals(null)).rejects.toThrow(/429/);
    }, 60_000);
  });

  describe("searchAllHubSpotTickets", () => {
    it("forwards `after` cursor and sorts by createdate ASCENDING", async () => {
      ticketsSearch.mockResolvedValue({
        results: [{ id: "t1", properties: { subject: "help" } }],
        paging: { next: { after: "ticket-cursor-2" } },
      });

      const { searchAllHubSpotTickets } = await import("@/lib/hubspot");
      const page = await searchAllHubSpotTickets("ticket-cursor-1");

      expect(ticketsSearch).toHaveBeenCalledTimes(1);
      const body = ticketsSearch.mock.calls[0][0];
      expect(body.after).toBe("ticket-cursor-1");
      expect(body.limit).toBe(100);
      expect(body.filterGroups).toEqual([]);
      expect(body.sorts).toEqual([{ propertyName: "createdate", direction: "ASCENDING" }]);
      expect(body.properties).toEqual(["subject", "hs_pipeline", "hs_pipeline_stage", "createdate"]);
      expect(page.results).toHaveLength(1);
      expect(page.paging?.next?.after).toBe("ticket-cursor-2");
    });

    it("normalizes `after: null` to undefined in the request body", async () => {
      ticketsSearch.mockResolvedValue({ results: [] });

      const { searchAllHubSpotTickets } = await import("@/lib/hubspot");
      await searchAllHubSpotTickets(null);

      const body = ticketsSearch.mock.calls[0][0];
      expect(body.after).toBeUndefined();
      expect(body.after).not.toBeNull();
    });

    it("propagates rate-limit errors", async () => {
      const err = Object.assign(new Error("429 rate limited"), { code: 429 });
      ticketsSearch.mockRejectedValue(err);

      const { searchAllHubSpotTickets } = await import("@/lib/hubspot");
      await expect(searchAllHubSpotTickets(null)).rejects.toThrow(/429/);
    }, 60_000);
  });
});
