import {
  harvestInternal,
  harvestQuickBooks,
  parseHarvestWarnings,
  type HarvestedProduct,
} from "@/lib/catalog-harvest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "sku_1",
          category: "MODULE",
          brand: "REC Solar",
          model: "Alpha 405-AA",
          description: "405W module",
          vendorPartNumber: "REC-405",
          zohoItemId: "zo_1",
          hubspotProductId: "hs_1",
          zuperItemId: null,
          quickbooksItemId: null,
          sellPrice: 150,
          isActive: true,
        },
      ]),
    },
    catalogProduct: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

// ---------------------------------------------------------------------------
// Tests: harvestInternal
// ---------------------------------------------------------------------------

describe("harvestInternal", () => {
  it("returns products in the correct HarvestedProduct shape", async () => {
    const products = await harvestInternal();

    expect(products).toHaveLength(1);
    const p = products[0];

    expect(p.source).toBe("internal");
    expect(p.externalId).toBe("sku_1");
    expect(p.rawName).toBe("REC Solar Alpha 405-AA");
    expect(p.rawBrand).toBe("REC Solar");
    expect(p.rawModel).toBe("Alpha 405-AA");
    expect(p.category).toBe("MODULE");
    expect(p.price).toBe(150);
    expect(p.description).toBe("405W module");
    expect(p.rawPayload).toBeDefined();
    expect(p.rawPayload.id).toBe("sku_1");
  });
});

// ---------------------------------------------------------------------------
// Tests: harvestQuickBooks
// ---------------------------------------------------------------------------

describe("harvestQuickBooks", () => {
  it("returns empty when no CatalogProduct rows exist for QUICKBOOKS", async () => {
    const db = await import("@/lib/db");
    (db.prisma!.catalogProduct.findMany as jest.Mock).mockResolvedValueOnce([]);

    const products = await harvestQuickBooks();
    expect(products).toHaveLength(0);
  });

  it("maps CatalogProduct rows with source QUICKBOOKS correctly", async () => {
    const db = await import("@/lib/db");
    (db.prisma!.catalogProduct.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: "cp_1",
        source: "QUICKBOOKS",
        externalId: "qb_99",
        name: "Enphase IQ8M-72-2-US",
        sku: "IQ8M",
        normalizedName: "enphaseiq8m722us",
        normalizedSku: "iq8m",
        description: "Microinverter",
        price: 200,
        status: "active",
        url: null,
        lastSyncedAt: new Date(),
      },
    ]);

    const products = await harvestQuickBooks();
    expect(products).toHaveLength(1);
    expect(products[0].source).toBe("quickbooks");
    expect(products[0].externalId).toBe("qb_99");
    // splitName("Enphase IQ8M-72-2-US") -> brand: "Enphase", model: "IQ8M-72-2-US"
    expect(products[0].rawBrand).toBe("Enphase");
    expect(products[0].rawModel).toBe("IQ8M-72-2-US");
    expect(products[0].price).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: parseHarvestWarnings
// ---------------------------------------------------------------------------

describe("parseHarvestWarnings", () => {
  const base: HarvestedProduct = {
    source: "internal",
    externalId: "test_1",
    rawName: "REC Solar Alpha 405-AA",
    rawBrand: "REC Solar",
    rawModel: "Alpha 405-AA",
    category: "MODULE",
    price: 150,
    description: "405W module",
    rawPayload: {},
  };

  it("returns empty array for a complete product", () => {
    expect(parseHarvestWarnings(base)).toEqual([]);
  });

  it("flags missing_brand when brand is null", () => {
    const warnings = parseHarvestWarnings({ ...base, rawBrand: null });
    expect(warnings).toContain("missing_brand");
    expect(warnings).not.toContain("name_only");
  });

  it("flags missing_model when model is null", () => {
    const warnings = parseHarvestWarnings({ ...base, rawModel: null });
    expect(warnings).toContain("missing_model");
    expect(warnings).not.toContain("name_only");
  });

  it("flags name_only when both brand and model are missing", () => {
    const warnings = parseHarvestWarnings({
      ...base,
      rawBrand: null,
      rawModel: null,
    });
    expect(warnings).toContain("name_only");
    expect(warnings).not.toContain("missing_brand");
    expect(warnings).not.toContain("missing_model");
  });

  it("flags ambiguous_category when category is null", () => {
    const warnings = parseHarvestWarnings({ ...base, category: null });
    expect(warnings).toContain("ambiguous_category");
  });

  it("flags ambiguous_category when category is empty string", () => {
    const warnings = parseHarvestWarnings({ ...base, category: "  " });
    expect(warnings).toContain("ambiguous_category");
  });

  it("flags multiple warnings simultaneously", () => {
    const warnings = parseHarvestWarnings({
      ...base,
      rawBrand: null,
      rawModel: null,
      category: null,
    });
    expect(warnings).toContain("name_only");
    expect(warnings).toContain("ambiguous_category");
    expect(warnings).toHaveLength(2);
  });
});
