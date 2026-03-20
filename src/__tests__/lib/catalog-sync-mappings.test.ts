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
  getSystemMappings,
  getPullableMappings,
  validateMappings,
  isVirtualField,
  generators,
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

  it("has name as push-only on all three systems", () => {
    const edges = getAllMappingEdges();
    const nameEdges = edges.filter((e) => e.externalField === "name");
    expect(nameEdges).toHaveLength(3);
    for (const e of nameEdges) {
      expect(e.direction).toBe("push-only");
      expect(e.generator).toBe("skuName");
      expect(e.internalField).toBe("_name");
    }
  });

  it("has specification as push-only on zuper", () => {
    const edges = getAllMappingEdges();
    const specEdge = edges.find(
      (e) => e.system === "zuper" && e.externalField === "specification",
    );
    expect(specEdge).toBeDefined();
    expect(specEdge!.direction).toBe("push-only");
    expect(specEdge!.generator).toBe("zuperSpecification");
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
  it("includes MODULE-conditional fields for MODULE products", () => {
    const mappings = getActiveMappings("MODULE");
    // Should have at least some HubSpot category-conditional edges
    const hubspotConditional = mappings.filter(
      (e) => e.system === "hubspot" && e.condition,
    );
    expect(hubspotConditional.length).toBeGreaterThan(0);
  });

  it("excludes MODULE-conditional fields for INVERTER products", () => {
    const moduleMappings = getActiveMappings("MODULE");
    const inverterMappings = getActiveMappings("INVERTER");
    // MODULE-only edges should not appear in INVERTER mappings
    const moduleOnlyEdges = moduleMappings.filter(
      (e) => e.condition && e.condition.category.length === 1 && e.condition.category[0] === "MODULE",
    );
    for (const edge of moduleOnlyEdges) {
      const found = inverterMappings.find(
        (e) => e.system === edge.system && e.externalField === edge.externalField && e.internalField === edge.internalField,
      );
      expect(found).toBeUndefined();
    }
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

describe("isVirtualField", () => {
  it("identifies virtual fields", () => {
    expect(isVirtualField("_name")).toBe(true);
    expect(isVirtualField("_specification")).toBe(true);
    expect(isVirtualField("sellPrice")).toBe(false);
  });
});

describe("getPullableMappings", () => {
  it("excludes push-only fields like name", () => {
    const pullable = getPullableMappings("hubspot", "MODULE");
    const nameEdge = pullable.find((e) => e.externalField === "name");
    expect(nameEdge).toBeUndefined();
  });

  it("includes bidirectional fields like price", () => {
    const pullable = getPullableMappings("hubspot", "MODULE");
    const priceEdge = pullable.find((e) => e.externalField === "price");
    expect(priceEdge).toBeDefined();
  });
});
