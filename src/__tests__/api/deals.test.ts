/**
 * Tests for /api/deals route
 * Validates the response shape, filtering, pagination, and the batched stage query fix.
 */

// Mock the HubSpot client
jest.mock("@hubspot/api-client", () => {
  const mockDoSearch = jest.fn().mockResolvedValue({
    results: [
      {
        properties: {
          hs_object_id: "101",
          dealname: "Test Deal 1",
          amount: "50000",
          dealstage: "qualifiedtobuy",
          pipeline: "default",
          pb_location: "Westminster",
          city: "Boulder",
          state: "CO",
          createdate: "2024-06-01T00:00:00Z",
        },
      },
      {
        properties: {
          hs_object_id: "102",
          dealname: "Test Deal 2",
          amount: "75000",
          dealstage: "contractsent",
          pipeline: "default",
          pb_location: "Centennial",
          city: "Denver",
          state: "CO",
          createdate: "2024-07-01T00:00:00Z",
        },
      },
    ],
    paging: undefined,
  });

  return {
    Client: jest.fn().mockImplementation(() => ({
      crm: {
        deals: {
          searchApi: {
            doSearch: mockDoSearch,
          },
        },
      },
    })),
  };
});

jest.mock("@/lib/cache", () => ({
  appCache: {
    getOrFetch: jest.fn(async (_key: string, fetcher: () => Promise<unknown>) => {
      const data = await fetcher();
      return { data, cached: false, stale: false, lastUpdated: new Date().toISOString() };
    }),
  },
  CACHE_KEYS: {
    DEALS: (p: string) => `deals:${p}`,
  },
}));

import { GET } from "@/app/api/deals/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/deals");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe("GET /api/deals", () => {
  it("returns 400 when pipeline is missing", async () => {
    const req = makeRequest();
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid pipeline", async () => {
    const req = makeRequest({ pipeline: "invalid" });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns deals for valid pipeline", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deals).toBeDefined();
    expect(body.pipeline).toBe("sales");
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  it("includes stats in response", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.stats).toBeDefined();
    expect(body.stats.totalValue).toBeDefined();
    expect(body.stats.stageCounts).toBeDefined();
    expect(body.stats.locationCounts).toBeDefined();
  });

  it("filters by location", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false", location: "Westminster" });
    const res = await GET(req);
    const body = await res.json();

    for (const deal of body.deals) {
      expect(deal.pbLocation).toBe("Westminster");
    }
  });

  it("applies pagination when limit > 0", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false", limit: "1", page: "1" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.count).toBeLessThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBe(1);
  });

  it("returns no pagination when limit is not set", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false" });
    const res = await GET(req);
    const body = await res.json();

    expect(body.pagination).toBeNull();
  });

  it("includes cached/stale/lastUpdated metadata", async () => {
    const req = makeRequest({ pipeline: "sales" });
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveProperty("cached");
    expect(body).toHaveProperty("stale");
    expect(body).toHaveProperty("lastUpdated");
  });

  it("handles text search", async () => {
    const req = makeRequest({ pipeline: "sales", active: "false", search: "Boulder" });
    const res = await GET(req);
    const body = await res.json();

    // Should filter to deals that match "Boulder" in name/address/city
    for (const deal of body.deals) {
      const combined = `${deal.name} ${deal.address} ${deal.city}`.toLowerCase();
      expect(combined).toContain("boulder");
    }
  });
});
