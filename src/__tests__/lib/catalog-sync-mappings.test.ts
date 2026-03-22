// src/__tests__/lib/catalog-sync-mappings.test.ts

// Mock heavy dependencies that pull in Prisma/ESM modules
jest.mock("@/lib/db", () => ({
  prisma: {},
}));

jest.mock("@/lib/zuper-catalog", () => ({
  resolveZuperCategoryUid: jest.fn(async (cat: string) => `uid-for-${cat}`),
}));

jest.mock("@/lib/hubspot", () => ({}));
jest.mock("@/lib/zoho-inventory", () => ({ zohoInventory: {} }));

import {
  normalize,
  normalizedEqual,
  getAllMappingEdges,
  getActiveMappings,
  getPullableMappings,
  validateMappings,
} from "@/lib/catalog-sync-mappings";

describe("normalizers", () => {
  describe("number", () => {
    it("parses float from string", () => {
      expect(normalize("6600.00", "number")).toBe(6600);
    });
    it("returns null for empty string", () => {
      expect(normalize("", "number")).toBeNull();
    });
    it("returns null for NaN", () => {
      expect(normalize("abc", "number")).toBeNull();
    });
    it("returns null for null/undefined", () => {
      expect(normalize(null, "number")).toBeNull();
      expect(normalize(undefined, "number")).toBeNull();
    });
  });

  describe("trimmed-string", () => {
    it("trims whitespace", () => {
      expect(normalize("  hello  ", "trimmed-string")).toBe("hello");
    });
    it("returns null for empty after trim", () => {
      expect(normalize("   ", "trimmed-string")).toBeNull();
    });
  });

  describe("enum-ci", () => {
    it("lowercases and trims", () => {
      expect(normalize("  HYUNDAI  ", "enum-ci")).toBe("hyundai");
    });
  });
});

describe("normalizedEqual", () => {
  it("numbers equal regardless of string formatting", () => {
    expect(normalizedEqual("6600", "6600.00", "number")).toBe(true);
  });
  it("enum-ci ignores case", () => {
    expect(normalizedEqual("Hyundai", "HYUNDAI", "enum-ci")).toBe(true);
  });
  it("trimmed-string is case-sensitive", () => {
    expect(normalizedEqual("Hyundai", "HYUNDAI", "trimmed-string")).toBe(false);
  });
});

describe("mapping table", () => {
  it("returns non-empty edge list", () => {
    const edges = getAllMappingEdges();
    expect(edges.length).toBeGreaterThan(15);
  });

  it("has name as bidirectional on all three systems mapped to name", () => {
    const edges = getAllMappingEdges();
    const nameEdges = edges.filter((e) => e.externalField === "name");
    expect(nameEdges).toHaveLength(3);
    for (const e of nameEdges) {
      expect(e.direction).toBeUndefined();
      expect(e.internalField).toBe("name");
    }
  });

  it("does not have a specification edge on zuper", () => {
    const edges = getAllMappingEdges();
    const specEdge = edges.find(
      (e) => e.system === "zuper" && e.externalField === "specification",
    );
    expect(specEdge).toBeUndefined();
  });

  it("has companion fields for zoho vendor", () => {
    const edges = getAllMappingEdges();
    const vendorName = edges.find(
      (e) => e.system === "zoho" && e.externalField === "vendor_name",
    );
    const vendorId = edges.find(
      (e) => e.system === "zoho" && e.externalField === "vendor_id",
    );
    expect(vendorName!.companion).toBe("vendor_id");
    expect(vendorId!.companion).toBe("vendor_name");
  });
});

describe("getActiveMappings", () => {
  it("includes MODULE-conditional dc_size for MODULE products", () => {
    const mappings = getActiveMappings("MODULE");
    const dcSize = mappings.find(
      (e) => e.system === "hubspot" && e.externalField === "dc_size",
    );
    expect(dcSize).toBeDefined();
    expect(dcSize!.internalField).toBe("wattage");
  });

  it("excludes MODULE-conditional dc_size for INVERTER products", () => {
    const mappings = getActiveMappings("INVERTER");
    const dcSize = mappings.find(
      (e) => e.system === "hubspot" && e.externalField === "dc_size",
    );
    expect(dcSize).toBeUndefined();
  });
});

describe("validateMappings", () => {
  it("reports no collisions for MODULE", () => {
    expect(validateMappings("MODULE")).toEqual([]);
  });

  it("reports no collisions for BATTERY", () => {
    expect(validateMappings("BATTERY")).toEqual([]);
  });

  it("reports no collisions for EV_CHARGER", () => {
    expect(validateMappings("EV_CHARGER")).toEqual([]);
  });
});

describe("getPullableMappings", () => {
  it("includes bidirectional name field", () => {
    const pullable = getPullableMappings("hubspot", "MODULE");
    const nameEdge = pullable.find((e) => e.externalField === "name");
    expect(nameEdge).toBeDefined();
    expect(nameEdge!.internalField).toBe("name");
  });

  it("includes bidirectional fields like price", () => {
    const pullable = getPullableMappings("hubspot", "MODULE");
    const priceEdge = pullable.find((e) => e.externalField === "price");
    expect(priceEdge).toBeDefined();
  });
});

describe("extended mapping edges", () => {
  it("includes zoho brand edge", () => {
    const edges = getActiveMappings("MODULE");
    const zohoBrand = edges.find(
      (e) => e.system === "zoho" && e.externalField === "brand",
    );
    expect(zohoBrand).toBeDefined();
    expect(zohoBrand!.internalField).toBe("brand");
    expect(zohoBrand!.normalizeWith).toBe("enum-ci");
    expect(zohoBrand!.direction).toBeUndefined();
  });

  it("includes hubspot vendor_part_number edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsModel = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "vendor_part_number",
    );
    expect(hsModel).toBeDefined();
    expect(hsModel!.internalField).toBe("model");
    expect(hsModel!.normalizeWith).toBe("trimmed-string");
  });

  it("includes hubspot unit_label edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsUnit = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "unit_label",
    );
    expect(hsUnit).toBeDefined();
    expect(hsUnit!.internalField).toBe("unitLabel");
  });

  it("includes hubspot vendor_name edge", () => {
    const edges = getActiveMappings("MODULE");
    const hsVendor = edges.find(
      (e) => e.system === "hubspot" && e.externalField === "vendor_name",
    );
    expect(hsVendor).toBeDefined();
    expect(hsVendor!.internalField).toBe("vendorName");
  });

  it("includes zuper price edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperPrice = edges.find(
      (e) => e.system === "zuper" && e.externalField === "price",
    );
    expect(zuperPrice).toBeDefined();
    expect(zuperPrice!.internalField).toBe("sellPrice");
    expect(zuperPrice!.normalizeWith).toBe("number");
  });

  it("includes zuper purchase_price edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperCost = edges.find(
      (e) => e.system === "zuper" && e.externalField === "purchase_price",
    );
    expect(zuperCost).toBeDefined();
    expect(zuperCost!.internalField).toBe("unitCost");
    expect(zuperCost!.normalizeWith).toBe("number");
  });

  it("includes zuper model edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperModel = edges.find(
      (e) => e.system === "zuper" && e.externalField === "model",
    );
    expect(zuperModel).toBeDefined();
    expect(zuperModel!.internalField).toBe("model");
  });

  it("includes zuper uom edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperUom = edges.find(
      (e) => e.system === "zuper" && e.externalField === "uom",
    );
    expect(zuperUom).toBeDefined();
    expect(zuperUom!.internalField).toBe("unitLabel");
  });

  it("includes zuper vendor_name edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperVendor = edges.find(
      (e) => e.system === "zuper" && e.externalField === "vendor_name",
    );
    expect(zuperVendor).toBeDefined();
    expect(zuperVendor!.internalField).toBe("vendorName");
  });

  it("includes zuper brand edge", () => {
    const edges = getActiveMappings("MODULE");
    const zuperBrand = edges.find(
      (e) => e.system === "zuper" && e.externalField === "brand",
    );
    expect(zuperBrand).toBeDefined();
    expect(zuperBrand!.internalField).toBe("brand");
  });

  it("zoho part_number is now bidirectional", () => {
    const edges = getActiveMappings("MODULE");
    const zohoModel = edges.find(
      (e) => e.system === "zoho" && e.externalField === "part_number",
    );
    expect(zohoModel).toBeDefined();
    expect(zohoModel!.direction).toBeUndefined();
  });

  it("zoho unit is now bidirectional", () => {
    const edges = getActiveMappings("MODULE");
    const zohoUnit = edges.find(
      (e) => e.system === "zoho" && e.externalField === "unit",
    );
    expect(zohoUnit).toBeDefined();
    expect(zohoUnit!.direction).toBeUndefined();
  });
});
