import { enrichServiceItems } from "@/lib/service-enrichment";

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      contacts: { batchApi: { read: jest.fn().mockResolvedValue({ results: [] }) } },
      associations: { batchApi: { read: jest.fn().mockResolvedValue({ results: [] }) } },
      lineItems: { batchApi: { read: jest.fn().mockResolvedValue({ results: [] }) } },
    },
  },
}));
jest.mock("@/lib/db", () => ({
  getCachedZuperJobsByDealIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/external-links", () => ({
  getZuperJobUrl: jest.fn((uid: string) => `https://zuper.test/jobs/${uid}/details`),
}));

describe("enrichServiceItems", () => {
  it("returns empty enrichment map for empty input", async () => {
    const result = await enrichServiceItems([]);
    expect(result.size).toBe(0);
  });

  it("returns null fields when all lookups return empty", async () => {
    const result = await enrichServiceItems([
      { itemId: "deal-1", itemType: "deal", contactIds: [], serviceType: null, dealLastContacted: null },
    ]);
    const enrichment = result.get("deal-1");
    expect(enrichment).toBeDefined();
    expect(enrichment!.serviceType).toBeNull();
    expect(enrichment!.lastContactDate).toBeNull();
    expect(enrichment!.lineItems).toBeNull();
    expect(enrichment!.zuperJobs).toBeNull();
  });

  it("passes through serviceType from input", async () => {
    const result = await enrichServiceItems([
      { itemId: "deal-2", itemType: "deal", contactIds: [], serviceType: "Warranty Repair" },
    ]);
    expect(result.get("deal-2")!.serviceType).toBe("Warranty Repair");
  });
});
