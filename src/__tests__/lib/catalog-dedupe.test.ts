import { dedupeProducts } from "@/lib/catalog-dedupe";
import type { HarvestedProduct } from "@/lib/catalog-harvest";

function makeProduct(overrides: Partial<HarvestedProduct>): HarvestedProduct {
  return {
    source: "internal",
    externalId: "id_1",
    rawName: "Test Product",
    rawBrand: "Brand",
    rawModel: "Model",
    category: "MODULE",
    price: null,
    description: null,
    rawPayload: {},
    ...overrides,
  };
}

describe("dedupeProducts", () => {
  it("groups products with the same canonical key", () => {
    const products = [
      makeProduct({
        externalId: "a1",
        rawName: "IQ Combiner BOX-5",
        rawBrand: "Enphase",
        rawModel: "IQ Combiner BOX-5",
        category: "BOS",
      }),
      makeProduct({
        externalId: "a2",
        rawName: "IQ Combiner BOX 5",
        rawBrand: "Enphase",
        rawModel: "IQ Combiner BOX 5",
        category: "BOS",
      }),
    ];

    const clusters = dedupeProducts(products);

    // Both should be in the same cluster
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].dedupeReason).toBe("canonical_key_match");
    expect(clusters[0].sourceIds).toContain("a1");
    expect(clusters[0].sourceIds).toContain("a2");
  });

  it("picks representative with most fields populated", () => {
    const sparse = makeProduct({
      externalId: "sparse_1",
      rawName: "Enphase IQ8PLUS",
      rawBrand: "Enphase",
      rawModel: "IQ8PLUS",
      category: "INVERTER",
      price: null,
      description: null,
    });

    const rich = makeProduct({
      externalId: "rich_1",
      rawName: "Enphase IQ8PLUS",
      rawBrand: "Enphase",
      rawModel: "IQ8PLUS",
      category: "INVERTER",
      price: 199.99,
      description: "Microinverter for residential solar",
    });

    const clusters = dedupeProducts([sparse, rich]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].representative.externalId).toBe("rich_1");
  });

  it("does NOT cluster products with completely different canonical keys", () => {
    const products = [
      makeProduct({
        externalId: "x1",
        rawName: "Tesla Powerwall 3",
        rawBrand: "Tesla",
        rawModel: "Powerwall 3",
        category: "BATTERY",
      }),
      makeProduct({
        externalId: "x2",
        rawName: "Enphase IQ8PLUS",
        rawBrand: "Enphase",
        rawModel: "IQ8PLUS",
        category: "INVERTER",
      }),
    ];

    const clusters = dedupeProducts(products);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 1)).toBe(true);
    expect(clusters.every((c) => c.dedupeReason === "singleton")).toBe(true);
  });

  it("uses vendor part number as fallback key to merge products with different model text but same VPN", () => {
    const products = [
      makeProduct({
        externalId: "v1",
        rawName: "SolarEdge P505 Optimizer",
        rawBrand: "SolarEdge",
        rawModel: "P505 Optimizer",
        category: "BOS",
        rawPayload: { vendor_part_number: "P505-4RM4MBY" },
      }),
      makeProduct({
        externalId: "v2",
        rawName: "SolarEdge P505",
        rawBrand: "SolarEdge",
        rawModel: "P505",
        category: "BOS",
        rawPayload: { vendor_part_number: "P505-4RM4MBY" },
      }),
    ];

    const clusters = dedupeProducts(products);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].sourceIds).toContain("v1");
    expect(clusters[0].sourceIds).toContain("v2");
  });

  it("prefers higher-quality source when field count is tied", () => {
    const zohoProduct = makeProduct({
      source: "zoho",
      externalId: "z1",
      rawName: "Tesla Powerwall 3",
      rawBrand: "Tesla",
      rawModel: "Powerwall 3",
      category: "BATTERY",
    });

    const hubspotProduct = makeProduct({
      source: "hubspot",
      externalId: "h1",
      rawName: "Tesla Powerwall 3",
      rawBrand: "Tesla",
      rawModel: "Powerwall 3",
      category: "BATTERY",
    });

    const clusters = dedupeProducts([hubspotProduct, zohoProduct]);

    expect(clusters).toHaveLength(1);
    // zoho has better quality score (0) than hubspot (2)
    expect(clusters[0].representative.source).toBe("zoho");
  });

  it("returns empty array for empty input", () => {
    expect(dedupeProducts([])).toEqual([]);
  });

  it("handles products with null brand/model/category gracefully", () => {
    const products = [
      makeProduct({
        externalId: "n1",
        rawName: "Mystery Widget",
        rawBrand: null,
        rawModel: null,
        category: null,
      }),
      makeProduct({
        externalId: "n2",
        rawName: "Something Else",
        rawBrand: null,
        rawModel: null,
        category: null,
      }),
    ];

    const clusters = dedupeProducts(products);

    // Should not crash, should produce 2 separate singletons
    expect(clusters).toHaveLength(2);
  });

  it("does NOT merge products that share only a name (no brand/model)", () => {
    // This verifies the over-merge fix: name-only matching is excluded
    // from automatic union to prevent generic names from collapsing
    // unrelated products.
    const products = [
      makeProduct({
        externalId: "g1",
        rawName: "Conduit Box",
        rawBrand: null,
        rawModel: null,
        category: "BOS",
      }),
      makeProduct({
        externalId: "g2",
        rawName: "Conduit Box",
        rawBrand: null,
        rawModel: null,
        category: "ELECTRICAL",
      }),
    ];

    const clusters = dedupeProducts(products);

    // Even though they have the exact same name, they should NOT merge
    // because name-only is not a union key
    expect(clusters).toHaveLength(2);
  });
});
