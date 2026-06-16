import { ZohoInventoryClient, type ZohoInventoryItem } from "@/lib/zoho-inventory";

/**
 * Regression test for the base Powerwall 3 catalog-match override.
 *
 * BOM_QUERY_OVERRIDES maps the base PW3 model `1707000` to a single exact
 * Zoho SKU. The override is intentionally strict: if that SKU is not present
 * in the live catalog, findItemIdByName returns null (no fuzzy fallback) and
 * the base Powerwall 3 is silently dropped from the generated Sales Order.
 *
 * The override SKU must therefore match the real active catalog SKU. This test
 * stubs a catalog that mirrors production (base unit = "1707000-21-M",
 * expansion = "1807000-20-B") and asserts the base PW3 resolves to it.
 */
describe("BOM_QUERY_OVERRIDES — base Powerwall 3", () => {
  // Mirror of the relevant production catalog rows (verified live 2026-06-15).
  const CATALOG: ZohoInventoryItem[] = [
    { item_id: "pw3-base", name: "Powerwall 3 (USA module)", sku: "1707000-21-M", status: "active" },
    { item_id: "pw3-nondom", name: "PW3 -Non Domestic", sku: "1707000-11-M", status: "active" },
    { item_id: "pw3-exp", name: "Powerwall 3 - Expansion", sku: "1807000-20-B", status: "active" },
  ];

  function client(): ZohoInventoryClient {
    const c = new ZohoInventoryClient();
    jest.spyOn(c, "getItemsForMatching").mockResolvedValue(CATALOG);
    return c;
  }

  it("resolves the base PW3 (1707000-XX-Y) to the active domestic catalog SKU, not null", async () => {
    const match = await client().findItemIdByName("TESLA POWERWALL-3 [SI1-SB], [240V] 1707000-XX-Y");
    expect(match).not.toBeNull();
    expect(match?.zohoSku).toBe("1707000-21-M");
  });

  it("warns when an override matches but its SKU is absent from the catalog", async () => {
    const c = new ZohoInventoryClient();
    // Catalog WITHOUT any 1707000 base unit — simulates a stale override SKU.
    jest.spyOn(c, "getItemsForMatching").mockResolvedValue([
      { item_id: "pw3-exp", name: "Powerwall 3 - Expansion", sku: "1807000-20-B", status: "active" },
    ]);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const match = await c.findItemIdByName("TESLA POWERWALL-3 1707000-XX-Y");

    expect(match).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not in the active catalog"));
    warn.mockRestore();
  });
});
