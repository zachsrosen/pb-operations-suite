// src/__tests__/lib/sync-modal-logic.test.ts
// Tests for the extracted pure functions from the SyncModal wide table

// Mock heavy dependencies that pull in Prisma/ESM modules
jest.mock("@/lib/db", () => ({
  prisma: {},
}));

jest.mock("@/lib/zuper-catalog", () => ({
  resolveZuperCategoryUid: jest.fn(async (cat: string) => `uid-for-${cat}`),
}));

jest.mock("@/lib/hubspot", () => ({}));
jest.mock("@/lib/zoho-inventory", () => ({ zohoInventory: {} }));

import type {
  FieldMappingEdge,
  FieldValueSnapshot,
  ExternalSystem,
} from "@/lib/catalog-sync-types";
import {
  buildFieldRows,
  getProjectedValue,
  getImplicitWrites,
  countChanges,
} from "@/components/catalog/SyncModal";

// ── Test helpers ──

function snap(
  system: ExternalSystem | "internal",
  field: string,
  rawValue: string | number | null,
): FieldValueSnapshot {
  return { system, field, rawValue, normalizedValue: rawValue };
}

function edge(
  system: ExternalSystem,
  externalField: string,
  internalField: string,
  opts?: Partial<FieldMappingEdge>,
): FieldMappingEdge {
  return {
    system,
    externalField,
    internalField,
    normalizeWith: "trimmed-string",
    ...opts,
  };
}

const linked: Record<ExternalSystem, boolean> = {
  zoho: true,
  hubspot: true,
  zuper: true,
};

const linkedZohoOnly: Record<ExternalSystem, boolean> = {
  zoho: true,
  hubspot: false,
  zuper: false,
};

// ── buildFieldRows ──

describe("buildFieldRows", () => {
  it("splits rows into attention (diffs) and inSync (matches)", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "rate", "sellPrice"),
      edge("zoho", "sku", "sku"),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", "305"),
      snap("zoho", "rate", "180"),
      snap("internal", "sku", "ABC"),
      snap("zoho", "sku", "ABC"),
    ];

    const { attention, inSync } = buildFieldRows(mappings, snapshots, linked);
    expect(attention).toHaveLength(1);
    expect(attention[0].internalField).toBe("sellPrice");
    expect(inSync).toHaveLength(1);
    expect(inSync[0].internalField).toBe("sku");
  });

  it("marks generator fields with hasGenerator", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "Test Product"),
      snap("zoho", "name", "Test Product"),
    ];

    const { inSync } = buildFieldRows(mappings, snapshots, linked);
    expect(inSync).toHaveLength(1);
    expect(inSync[0].hasGenerator).toBe(true);
    expect(inSync[0].isPushOnly).toBe(true);
  });

  it("marks push-only non-generator fields", () => {
    const mappings: FieldMappingEdge[] = [
      edge("hubspot", "product_category", "category", { direction: "push-only" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "category", "MODULE"),
      snap("hubspot", "product_category", "MODULE"),
    ];

    const { inSync } = buildFieldRows(mappings, snapshots, linked);
    expect(inSync).toHaveLength(1);
    expect(inSync[0].hasGenerator).toBe(false);
    expect(inSync[0].isPushOnly).toBe(true);
  });

  it("groups edges by internal field across systems", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "rate", "sellPrice"),
      edge("hubspot", "price", "sellPrice"),
      edge("zuper", "price", "sellPrice"),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", "305"),
      snap("zoho", "rate", "305"),
      snap("hubspot", "price", "305"),
      snap("zuper", "price", "180"), // differs
    ];

    const { attention } = buildFieldRows(mappings, snapshots, linked);
    expect(attention).toHaveLength(1);
    expect(attention[0].edges).toHaveLength(3);
  });

  it("uses normalized comparison (305 vs 305.0 is in-sync for number fields)", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "rate", "sellPrice", { normalizeWith: "number" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", "305"),
      snap("zoho", "rate", "305.0"),
    ];

    const { attention, inSync } = buildFieldRows(mappings, snapshots, linked);
    // After normalization, 305 and 305.0 are equal
    expect(attention).toHaveLength(0);
    expect(inSync).toHaveLength(1);
    expect(inSync[0].internalField).toBe("sellPrice");
  });

  it("considers only linked systems for diffs", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "rate", "sellPrice"),
      edge("hubspot", "price", "sellPrice"),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", "305"),
      snap("zoho", "rate", "305"),
      // HubSpot not linked — no snapshot
    ];

    const { inSync } = buildFieldRows(mappings, snapshots, linkedZohoOnly);
    // Only Zoho is linked and matches — should be in sync
    expect(inSync).toHaveLength(1);
  });

  it("skips companion duplicate (zohoVendorId)", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "vendor_name", "vendorName", { companion: "vendor_id" }),
      edge("zoho", "vendor_id", "zohoVendorId", { companion: "vendor_name" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "vendorName", "Hyundai"),
      snap("internal", "zohoVendorId", "123"),
      snap("zoho", "vendor_name", "Hyundai"),
      snap("zoho", "vendor_id", "123"),
    ];

    const { inSync, attention } = buildFieldRows(mappings, snapshots, linked);
    // zohoVendorId row should be skipped, only vendorName shows
    const allRows = [...attention, ...inSync];
    const fieldNames = allRows.map((r) => r.internalField);
    expect(fieldNames).toContain("vendorName");
    expect(fieldNames).not.toContain("zohoVendorId");
  });
});

// ── getProjectedValue ──

describe("getProjectedValue", () => {
  const mappings: FieldMappingEdge[] = [
    edge("zoho", "rate", "sellPrice"),
    edge("hubspot", "price", "sellPrice"),
    edge("zuper", "price", "sellPrice"),
  ];
  const snapshots: FieldValueSnapshot[] = [
    snap("internal", "sellPrice", "305"),
    snap("zoho", "rate", "180"),
    snap("hubspot", "price", "300"),
    snap("zuper", "price", "290"),
  ];

  it("returns current value for keep", () => {
    const val = getProjectedValue("keep", "sellPrice", "rate", "zoho", snapshots, mappings);
    expect(val).toBe("180");
  });

  it("returns internal value for internal source", () => {
    const val = getProjectedValue("internal", "sellPrice", "rate", "zoho", snapshots, mappings);
    expect(val).toBe("305");
  });

  it("returns another external system value", () => {
    const val = getProjectedValue("hubspot", "sellPrice", "rate", "zoho", snapshots, mappings);
    expect(val).toBe("300");
  });

  it("returns null when source system has no edge for this field", () => {
    const limitedMappings = [edge("zoho", "rate", "sellPrice")];
    const val = getProjectedValue("hubspot", "sellPrice", "rate", "zoho", snapshots, limitedMappings);
    expect(val).toBeNull();
  });
});

// ── getImplicitWrites ──

describe("getImplicitWrites", () => {
  it("generator fields are NOT implicit (they are explicit rows now)", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "name", "_name", { direction: "push-only", generator: "skuName" }),
      edge("zoho", "rate", "sellPrice"),
    ];
    const selections = { "zoho:rate": "internal" as const };

    const writes = getImplicitWrites(mappings, selections, linked);
    // Generator fields no longer appear in implicit writes
    expect(writes).not.toContain("Name (auto-generated)");
    expect(writes).toHaveLength(0);
  });

  it("includes companion fields when primary is selected", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "vendor_name", "vendorName", { companion: "vendor_id" }),
      edge("zoho", "vendor_id", "zohoVendorId", { companion: "vendor_name" }),
    ];
    const selections = { "zoho:vendor_name": "internal" as const };

    const writes = getImplicitWrites(mappings, selections, linked);
    expect(writes.some((w) => w.includes("companion"))).toBe(true);
  });

  it("returns empty when no implicit writes exist", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "rate", "sellPrice"),
    ];
    const selections = { "zoho:rate": "internal" as const };

    const writes = getImplicitWrites(mappings, selections, linked);
    expect(writes).toHaveLength(0);
  });

  it("returns empty for generator-only mappings with active systems", () => {
    const mappings: FieldMappingEdge[] = [
      edge("zoho", "name", "_name", { direction: "push-only", generator: "skuName" }),
      edge("hubspot", "name", "_name", { direction: "push-only", generator: "skuName" }),
      edge("zoho", "rate", "sellPrice"),
      edge("hubspot", "price", "sellPrice"),
    ];
    const selections = {
      "zoho:rate": "internal" as const,
      "hubspot:price": "internal" as const,
    };

    const writes = getImplicitWrites(mappings, selections, linked);
    // Generator fields are now explicit rows, not implicit writes
    const nameEntries = writes.filter((w) => w.startsWith("Name"));
    expect(nameEntries).toHaveLength(0);
  });
});

// ── countChanges ──

describe("countChanges", () => {
  it("counts non-keep selections", () => {
    const selections = {
      "zoho:rate": "internal" as const,
      "hubspot:price": "keep" as const,
      "zuper:price": "zoho" as const,
      "internal:sellPrice": "zoho" as const,
    };

    const { fields, systems } = countChanges(selections);
    expect(fields).toBe(3);
    expect(systems.size).toBe(3); // zoho, zuper, internal
  });

  it("returns zero for all-keep selections", () => {
    const selections = {
      "zoho:rate": "keep" as const,
      "hubspot:price": "keep" as const,
    };

    const { fields, systems } = countChanges(selections);
    expect(fields).toBe(0);
    expect(systems.size).toBe(0);
  });

  it("handles empty selections", () => {
    const { fields, systems } = countChanges({});
    expect(fields).toBe(0);
    expect(systems.size).toBe(0);
  });
});
