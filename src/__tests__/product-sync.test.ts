// Mock heavy dependencies so Jest can load the module without Prisma/API clients
jest.mock("@/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error { code: string; constructor(message: string, opts: { code: string }) { super(message); this.code = opts.code; } } },
}));
const mockPrisma: Record<string, unknown> = {};
jest.mock("@/lib/db", () => ({ prisma: mockPrisma }));
jest.mock("@/lib/zoho-inventory", () => ({ zohoInventory: {} }));
jest.mock("@/lib/hubspot", () => ({ listRecentHubSpotProducts: jest.fn() }));
jest.mock("@/lib/zuper-catalog", () => ({ listRecentZuperProducts: jest.fn() }));
jest.mock("@/lib/product-sync-outbound", () => ({ pushToMissingSystems: jest.fn().mockResolvedValue(undefined) }));

import {
  extractFieldsFromZohoItem,
  extractFieldsFromHubSpotProduct,
  extractFieldsFromZuperProduct,
  processItem,
} from "@/lib/product-sync";
import type { ExternalProductFields } from "@/lib/product-sync";

describe("product-sync field extraction", () => {
  describe("extractFieldsFromZohoItem", () => {
    it("extracts core fields from a Zoho item", () => {
      const zohoItem = {
        item_id: "zoho-123",
        name: "REC Alpha Pure Black 400",
        sku: "REC-400-AB",
        description: "400W module",
        brand: "REC",
        manufacturer: "",
        part_number: "REC400AA",
        rate: 250,
        purchase_rate: 180,
        category_name: "Module",
      };

      const result = extractFieldsFromZohoItem(zohoItem);

      expect(result.externalId).toBe("zoho-123");
      expect(result.source).toBe("zoho");
      expect(result.name).toBe("REC Alpha Pure Black 400");
      expect(result.brand).toBe("REC");
      expect(result.model).toBe("REC400AA");
      expect(result.sku).toBe("REC-400-AB");
      expect(result.sellPrice).toBe(250);
      expect(result.unitCost).toBe(180);
      expect(result.sourceCategory).toBe("Module");
    });

    it("falls back to manufacturer when brand is empty", () => {
      const zohoItem = {
        item_id: "z-1",
        name: "Test",
        brand: "",
        manufacturer: "Enphase",
        category_name: "Inverter",
      };
      const result = extractFieldsFromZohoItem(zohoItem);
      expect(result.brand).toBe("Enphase");
    });

    it("parses model from name when part_number is missing", () => {
      const zohoItem = {
        item_id: "z-2",
        name: "Enphase IQ8A-72-M-US",
        brand: "Enphase",
        category_name: "Inverter",
      };
      const result = extractFieldsFromZohoItem(zohoItem);
      // model should be extracted from name minus brand
      expect(result.model).toBeTruthy();
    });
  });

  describe("extractFieldsFromHubSpotProduct", () => {
    it("extracts core fields from a HubSpot product", () => {
      const product = {
        id: "hs-456",
        properties: {
          name: "SolarEdge SE10000H-US",
          hs_sku: "SE10000H",
          price: "1200",
          description: "10kW inverter",
          manufacturer: "SolarEdge",
          product_category: "Inverter",
          hs_cost_of_goods_sold: "900",
        },
      };

      const result = extractFieldsFromHubSpotProduct(product);

      expect(result.externalId).toBe("hs-456");
      expect(result.source).toBe("hubspot");
      expect(result.name).toBe("SolarEdge SE10000H-US");
      expect(result.brand).toBe("SolarEdge");
      expect(result.sku).toBe("SE10000H");
      expect(result.sellPrice).toBe(1200);
      expect(result.unitCost).toBe(900);
      expect(result.sourceCategory).toBe("Inverter");
    });
  });

  describe("extractFieldsFromZuperProduct", () => {
    it("extracts core fields from a Zuper product", () => {
      const product = {
        id: "zup-789",
        name: "Tesla Powerwall 3",
        sku: "PW3",
        brand: "Tesla",
        model: "Powerwall 3",
        description: "13.5 kWh battery",
        price: 8500,
        purchasePrice: 7000,
        categoryName: "Battery",
        raw: {},
      };

      const result = extractFieldsFromZuperProduct(product);

      expect(result.externalId).toBe("zup-789");
      expect(result.source).toBe("zuper");
      expect(result.name).toBe("Tesla Powerwall 3");
      expect(result.brand).toBe("Tesla");
      expect(result.model).toBe("Powerwall 3");
      expect(result.sellPrice).toBe(8500);
      expect(result.unitCost).toBe(7000);
      expect(result.sourceCategory).toBe("Battery");
    });
  });
});

// ── processItem incomplete_data guard ───────────────────────────────────────

describe("processItem incomplete_data guard", () => {
  const mockCreate = jest.fn().mockResolvedValue({});

  beforeAll(() => {
    Object.assign(mockPrisma, {
      pendingCatalogPush: { create: mockCreate },
      internalProduct: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    });
  });

  beforeEach(() => mockCreate.mockClear());

  function makeFields(overrides: Partial<ExternalProductFields>): ExternalProductFields {
    return {
      externalId: "test-123",
      source: "zoho",
      name: "",
      brand: "",
      model: "",
      description: "",
      sourceCategory: "Module",
      rawMetadata: {},
      ...overrides,
    };
  }

  it("flags as incomplete_data when only brand is present (no name, no model)", async () => {
    const stats = { zohoScanned: 0, hubspotScanned: 0, zuperScanned: 0, imported: 0, linked: 0, flagged: 0, skipped: 0, errors: [] };
    await processItem(makeFields({ brand: "REC" }), stats);

    expect(stats.flagged).toBe(1);
    expect(stats.imported).toBe(0);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewReason: "incomplete_data" }),
      }),
    );
  });

  it("flags as incomplete_data when only model is present (no name, no brand)", async () => {
    const stats = { zohoScanned: 0, hubspotScanned: 0, zuperScanned: 0, imported: 0, linked: 0, flagged: 0, skipped: 0, errors: [] };
    await processItem(makeFields({ model: "IQ8A-72-M-US" }), stats);

    expect(stats.flagged).toBe(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewReason: "incomplete_data" }),
      }),
    );
  });

  it("flags as incomplete_data when name, brand, and model are all blank/whitespace", async () => {
    const stats = { zohoScanned: 0, hubspotScanned: 0, zuperScanned: 0, imported: 0, linked: 0, flagged: 0, skipped: 0, errors: [] };
    await processItem(makeFields({ name: "  ", brand: "  ", model: "  " }), stats);

    expect(stats.flagged).toBe(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewReason: "incomplete_data" }),
      }),
    );
  });

  it("does NOT flag when name is present (even without brand/model)", async () => {
    // processItem will proceed past the incomplete guard into canonical key dedup
    // which calls prisma.internalProduct.findFirst — mock it to return null (no match)
    const ip = mockPrisma.internalProduct as { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    ip.findFirst.mockResolvedValueOnce(null);
    ip.findMany.mockResolvedValueOnce([]);
    ip.create.mockResolvedValueOnce({ id: "new-1" });

    const stats = { zohoScanned: 0, hubspotScanned: 0, zuperScanned: 0, imported: 0, linked: 0, flagged: 0, skipped: 0, errors: [] };
    await processItem(makeFields({ name: "REC Alpha Pure Black 400" }), stats);

    // Should NOT be flagged as incomplete
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does NOT flag when both brand and model are present (even without name)", async () => {
    const ip = mockPrisma.internalProduct as { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    ip.findFirst.mockResolvedValueOnce(null);
    ip.findMany.mockResolvedValueOnce([]);
    ip.create.mockResolvedValueOnce({ id: "new-2" });

    const stats = { zohoScanned: 0, hubspotScanned: 0, zuperScanned: 0, imported: 0, linked: 0, flagged: 0, skipped: 0, errors: [] };
    await processItem(makeFields({ brand: "REC", model: "Alpha Pure Black 400" }), stats);

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
