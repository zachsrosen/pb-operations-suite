// src/__tests__/lib/catalog-sync-plan.test.ts

// Mock heavy dependencies that pull in Prisma/ESM modules
jest.mock("@/lib/db", () => ({
  prisma: {},
}));

jest.mock("@/lib/zuper-catalog", () => ({
  resolveZuperCategoryUid: jest.fn(async (cat: string) => `uid-for-${cat}`),
  getZuperPartById: jest.fn(async () => null),
}));

jest.mock("@/lib/hubspot", () => ({
  getHubSpotProductById: jest.fn(async () => null),
}));

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    getItemById: jest.fn(async () => null),
  },
}));

import {
  deriveDefaultIntents,
  derivePlan,
  computePlanHash,
  computeBasePreviewHash,
} from "@/lib/catalog-sync-plan";
import type {
  ExternalSystem,
  FieldIntent,
  FieldValueSnapshot,
} from "@/lib/catalog-sync-types";
import type { SkuRecord } from "@/lib/catalog-sync";

// Minimal SkuRecord for testing
const baseSku: SkuRecord = {
  id: "test-product-1",
  category: "MODULE",
  brand: "Silfab",
  model: "SIL-410-BG",
  name: "Silfab SIL-410-BG",
  description: "410W Solar Panel",
  sku: "SIL410BG",
  vendorName: null,
  vendorPartNumber: null,
  unitSpec: null,
  unitLabel: "pcs",
  unitCost: 200,
  sellPrice: 305,
  hardToProcure: false,
  length: null,
  width: null,
  weight: null,
  zohoItemId: "zoho-123",
  zohoVendorId: null,
  hubspotProductId: "hs-456",
  zuperItemId: "zuper-789",
  moduleSpec: { wattage: 410, efficiency: 20.5, cellType: "Mono PERC" },
  inverterSpec: null,
  batterySpec: null,
  evChargerSpec: null,
  mountingHardwareSpec: null,
  electricalHardwareSpec: null,
  relayDeviceSpec: null,
};

describe("deriveDefaultIntents", () => {
  it("defaults to push/manual for fields with diffs", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents = deriveDefaultIntents(baseSku, snapshots, "MODULE");
    expect(intents.hubspot.price.direction).toBe("push");
    expect(intents.hubspot.price.mode).toBe("manual");
  });

  it("defaults to skip/auto for fields without diffs", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents = deriveDefaultIntents(baseSku, snapshots, "MODULE");
    expect(intents.hubspot.price.direction).toBe("skip");
    expect(intents.hubspot.price.mode).toBe("auto");
  });
});

describe("derivePlan", () => {
  it("produces push operations from push intents", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {},
      hubspot: {
        price: { direction: "push", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    const pushOps = plan.operations.filter((o) => o.kind === "push");
    expect(pushOps.some((o) => o.kind === "push" && o.externalField === "price")).toBe(true);
  });

  it("detects pull conflicts for same internal field with different values", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "6600", normalizedValue: 6600 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].internalField).toBe("sellPrice");
    expect(plan.conflicts[0].contenders).toHaveLength(2);
  });

  it("does not conflict when normalized values are equal", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "305.00", normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    expect(plan.conflicts).toHaveLength(0);
  });

  it("uses zoho precedence for equal-normalized multi-pull raw value", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "305.00", normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    // Zoho wins by precedence
    expect(plan.internalPatch.sellPrice).toBe("305.00");
  });
});

describe("derivePlan — create operations", () => {
  it("includes mapped fields in unlinked system creates", () => {
    // SKU with no zuperItemId → Zuper is unlinked
    const unlinkedSku: SkuRecord = {
      ...baseSku,
      zuperItemId: null,
    };
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "internal", field: "sku", rawValue: "SIL410BG", normalizedValue: "SIL410BG" },
    ];
    // Push at least one field to trigger the create path
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {},
      hubspot: {},
      zuper: {
        sku: { direction: "push", mode: "manual", updateInternalOnPull: true },
      },
    };
    const plan = derivePlan(unlinkedSku, intents, snapshots, "MODULE");
    const createOps = plan.operations.filter((o) => o.kind === "create" && o.system === "zuper");
    expect(createOps).toHaveLength(1);
    const createOp = createOps[0];
    if (createOp.kind !== "create") throw new Error("Expected create op");

    // Standard mapped fields should be present (name is now a normal bidirectional field)
    expect(createOp.fields).toHaveProperty("sku");
    expect(createOp.fields.sku).toBe("SIL410BG");
  });
});

describe("computePlanHash", () => {
  it("is deterministic for same inputs", () => {
    const patch = { sellPrice: 305 as string | number | null };
    const ops = [
      { kind: "push" as const, system: "hubspot" as ExternalSystem, externalField: "price",
        value: 305 as string | number | null, source: "manual" as const },
    ];
    const h1 = computePlanHash("p1", patch, ops);
    const h2 = computePlanHash("p1", patch, ops);
    expect(h1).toBe(h2);
  });

  it("excludes no-op pulls from hash", () => {
    const patch = {};
    const ops1 = [
      { kind: "pull" as const, system: "zoho" as ExternalSystem, externalField: "rate",
        internalField: "sellPrice", value: 305 as string | number | null,
        updateInternal: false, noOp: true, source: "manual" as const },
    ];
    const ops2: typeof ops1 = [];
    expect(computePlanHash("p1", patch, ops1)).toBe(computePlanHash("p1", patch, ops2));
  });
});
