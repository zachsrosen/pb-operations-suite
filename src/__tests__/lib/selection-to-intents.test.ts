// src/__tests__/lib/selection-to-intents.test.ts

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
  selectionToIntents,
  expandCompanions,
  computeSmartDefaults,
  getDropdownOptions,
  type CellSelection,
} from "@/lib/selection-to-intents";
import type { ExternalSystem, FieldMappingEdge, FieldValueSnapshot } from "@/lib/catalog-sync-types";

// ── Helper: build a snapshot entry ──
function snap(
  system: ExternalSystem | "internal",
  field: string,
  rawValue: string | number | null,
): FieldValueSnapshot {
  return { system, field, rawValue, normalizedValue: rawValue };
}

// ── Helper: build a mapping edge ──
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

const PRICE_EDGES: FieldMappingEdge[] = [
  edge("zoho", "rate", "sellPrice", { normalizeWith: "number" }),
  edge("hubspot", "price", "sellPrice", { normalizeWith: "number" }),
  edge("zuper", "price", "sellPrice", { normalizeWith: "number" }),
];

describe("selectionToIntents", () => {
  it("generates push intent for external cell picking Internal", () => {
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "internal" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.hubspot.price).toEqual({
      direction: "push",
      mode: "manual",
      updateInternalOnPull: false,
    });
  });

  it("generates pull intent with updateInternalOnPull for Internal cell picking external", () => {
    const selections: CellSelection[] = [
      { system: "zoho", externalField: "rate", source: "zoho", isInternalColumn: true },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.zoho.rate).toEqual({
      direction: "pull",
      mode: "manual",
      updateInternalOnPull: true,
    });
  });

  it("generates relay: pull from source + push to target", () => {
    // HubSpot cell picks Zoho's value
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "zoho" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    // Pull from Zoho (relay, no internal persist)
    expect(result.zoho.rate).toEqual({
      direction: "pull",
      mode: "manual",
      updateInternalOnPull: false,
    });
    // Push to HubSpot
    expect(result.hubspot.price).toEqual({
      direction: "push",
      mode: "manual",
      updateInternalOnPull: false,
    });
  });

  it("deduplicates: Internal pull wins over relay pull for same field", () => {
    const selections: CellSelection[] = [
      // Internal picks Zoho (persist)
      { system: "zoho", externalField: "rate", source: "zoho", isInternalColumn: true },
      // HubSpot also picks Zoho (relay)
      { system: "hubspot", externalField: "price", source: "zoho" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    // Pull intent should have updateInternalOnPull: true (Internal column wins)
    expect(result.zoho.rate.updateInternalOnPull).toBe(true);
    // HubSpot still gets a push
    expect(result.hubspot.price.direction).toBe("push");
  });

  it("skips 'keep' selections", () => {
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "price", source: "keep" },
    ];
    const result = selectionToIntents(selections, PRICE_EDGES);
    expect(result.hubspot.price).toBeUndefined();
  });

  it("generates no entries for empty selections", () => {
    const result = selectionToIntents([], PRICE_EDGES);
    expect(Object.keys(result.zoho)).toHaveLength(0);
    expect(Object.keys(result.hubspot)).toHaveLength(0);
    expect(Object.keys(result.zuper)).toHaveLength(0);
  });

  it('handles "auto-generated" source — produces push intent on target system', () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "hs_name", source: "auto-generated" },
    ];
    const result = selectionToIntents(selections, generatorEdges);
    expect(result.hubspot["hs_name"]).toEqual({
      direction: "push",
      mode: "manual",
      updateInternalOnPull: false,
    });
  });

  it('"auto-generated" never creates pull intents', () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
      edge("zuper", "zuper_name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const selections: CellSelection[] = [
      { system: "hubspot", externalField: "hs_name", source: "auto-generated" },
      { system: "zuper", externalField: "zuper_name", source: "auto-generated" },
    ];
    const result = selectionToIntents(selections, generatorEdges);

    // Only push intents
    expect(result.hubspot["hs_name"]?.direction).toBe("push");
    expect(result.zuper["zuper_name"]?.direction).toBe("push");

    // No pull intents anywhere, no updateInternalOnPull
    for (const sys of ["zoho", "hubspot", "zuper"] as ExternalSystem[]) {
      for (const intent of Object.values(result[sys])) {
        expect(intent.direction).not.toBe("pull");
        expect(intent.updateInternalOnPull).toBe(false);
      }
    }
  });
});

describe("expandCompanions", () => {
  const VENDOR_EDGES: FieldMappingEdge[] = [
    edge("zoho", "vendor_name", "vendorName", { companion: "vendor_id" }),
    edge("zoho", "vendor_id", "zohoVendorId", { companion: "vendor_name" }),
  ];

  it("expands companion field when primary is selected", () => {
    const selections: CellSelection[] = [
      { system: "zoho", externalField: "vendor_name", source: "internal" },
    ];
    const expanded = expandCompanions(selections, VENDOR_EDGES);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]).toEqual({
      system: "zoho",
      externalField: "vendor_id",
      source: "internal",
      isInternalColumn: undefined,
    });
  });

  it("does not duplicate when companion already selected", () => {
    const selections: CellSelection[] = [
      { system: "zoho", externalField: "vendor_name", source: "internal" },
      { system: "zoho", externalField: "vendor_id", source: "internal" },
    ];
    const expanded = expandCompanions(selections, VENDOR_EDGES);
    expect(expanded).toHaveLength(2);
  });

  it("skips companion expansion for keep selections", () => {
    const selections: CellSelection[] = [
      { system: "zoho", externalField: "vendor_name", source: "keep" },
    ];
    const expanded = expandCompanions(selections, VENDOR_EDGES);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].externalField).toBe("vendor_name");
    expect(expanded[0].source).toBe("keep");
  });
});

describe("computeSmartDefaults", () => {
  it("defaults to Internal when external is empty and internal has value", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 305),
      snap("hubspot", "price", null),
      snap("zuper", "price", null),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: true, zuper: true,
    });
    // Zoho matches → keep
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
    // HubSpot empty, internal has value → internal
    expect(defaults.find((d) => d.system === "hubspot")?.source).toBe("internal");
    // Zuper empty → internal
    expect(defaults.find((d) => d.system === "zuper")?.source).toBe("internal");
  });

  it("defaults to keep when values differ (user decides)", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 180),
      snap("hubspot", "price", 305),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: true, zuper: false,
    });
    // Values differ → keep (user must decide)
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
  });

  it("defaults to keep when internal is empty (don't pull by default)", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", null),
      snap("zoho", "rate", 180),
    ];
    const defaults = computeSmartDefaults(PRICE_EDGES, snapshots, {
      zoho: true, hubspot: false, zuper: false,
    });
    expect(defaults.find((d) => d.system === "zoho")?.source).toBe("keep");
  });

  it("generator rows default to auto-generated when value differs", () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "REC Alpha 400W"),
      snap("hubspot", "hs_name", "REC Alpha 400"),
    ];
    const defaults = computeSmartDefaults(generatorEdges, snapshots, {
      zoho: false, hubspot: true, zuper: false,
    });
    const d = defaults.find((d) => d.system === "hubspot" && d.externalField === "hs_name");
    expect(d).toBeDefined();
    expect(d!.source).toBe("auto-generated");
  });

  it("generator rows default to keep when values match", () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "REC Alpha 400W"),
      snap("hubspot", "hs_name", "REC Alpha 400W"),
    ];
    const defaults = computeSmartDefaults(generatorEdges, snapshots, {
      zoho: false, hubspot: true, zuper: false,
    });
    const d = defaults.find((d) => d.system === "hubspot" && d.externalField === "hs_name");
    expect(d).toBeDefined();
    expect(d!.source).toBe("keep");
  });
});

describe("getDropdownOptions", () => {
  it("filters out sources matching current value", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 305),
      snap("hubspot", "price", 180),
    ];
    const options = getDropdownOptions(
      "hubspot", "price", "sellPrice",
      PRICE_EDGES, snapshots,
      { zoho: true, hubspot: true, zuper: false },
      null, // no locked source from Internal column
    );
    // "Internal" available (305 ≠ 180)
    expect(options.some((o) => o.value === "internal")).toBe(true);
    // "Zoho" available (305 ≠ 180, same value as internal but different source)
    expect(options.some((o) => o.value === "zoho")).toBe(true);
    // "Keep" always available
    expect(options.some((o) => o.value === "keep")).toBe(true);
    // Zuper not linked → not an option
    expect(options.some((o) => o.value === "zuper")).toBe(false);
  });

  it("filters external sources that conflict with Internal column pull", () => {
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", null),
      snap("zoho", "rate", 180),
      snap("hubspot", "price", 305),
    ];
    // Internal column already picked "zoho" for this field
    const options = getDropdownOptions(
      "hubspot", "price", "sellPrice",
      PRICE_EDGES, snapshots,
      { zoho: true, hubspot: true, zuper: false },
      "zoho", // locked source from Internal column
    );
    // Can pick Keep, Internal, or Zoho (same source as Internal → no conflict)
    expect(options.some((o) => o.value === "keep")).toBe(true);
    expect(options.some((o) => o.value === "internal")).toBe(true);
    expect(options.some((o) => o.value === "zoho")).toBe(true);
  });

  it("filters external sources that conflict with another external cell relay", () => {
    // Scenario: HubSpot cell already picked Zoho as relay source.
    // Now Zuper cell should only see Keep, Internal, or Zoho — NOT HubSpot.
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "sellPrice", 305),
      snap("zoho", "rate", 180),
      snap("hubspot", "price", 300),
      snap("zuper", "price", 290),
    ];
    // The locked source is "zoho" (from another external cell's relay, not Internal column)
    const options = getDropdownOptions(
      "zuper", "price", "sellPrice",
      PRICE_EDGES, snapshots,
      { zoho: true, hubspot: true, zuper: true },
      "zoho", // locked because HubSpot cell already chose Zoho relay
    );
    // Zuper can pick Keep, Internal, or Zoho (same source)
    expect(options.some((o) => o.value === "keep")).toBe(true);
    expect(options.some((o) => o.value === "internal")).toBe(true);
    expect(options.some((o) => o.value === "zoho")).toBe(true);
    // HubSpot should NOT be available (conflicts with locked Zoho source)
    expect(options.some((o) => o.value === "hubspot")).toBe(false);
  });

  it("with hasGenerator: true — includes Keep and Auto-generated, not Internal", () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
      edge("zoho", "name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "REC Alpha 400W"),
      snap("hubspot", "hs_name", "REC Alpha 400"),
      snap("zoho", "name", "REC Alpha 400W"),
    ];
    const options = getDropdownOptions(
      "hubspot", "hs_name", "_name",
      generatorEdges, snapshots,
      { zoho: true, hubspot: true, zuper: false },
      null,
      true,
    );

    const values = options.map((o) => o.value);
    expect(values).toContain("keep");
    expect(values).toContain("auto-generated");
    expect(values).not.toContain("internal");
    // Linked external systems still included for relay
    expect(values).toContain("zoho");
  });

  it("with hasGenerator: true — Auto-generated label includes value and suffix", () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("hubspot", "hs_name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "REC Alpha 400W"),
      snap("hubspot", "hs_name", "REC Alpha 400"),
    ];
    const options = getDropdownOptions(
      "hubspot", "hs_name", "_name",
      generatorEdges, snapshots,
      { zoho: false, hubspot: true, zuper: false },
      null,
      true,
    );
    const autoOpt = options.find((o) => o.value === "auto-generated");
    expect(autoOpt).toBeDefined();
    expect(autoOpt!.label).toContain("(Auto-generated)");
    expect(autoOpt!.label).toContain("REC Alpha 400W");
    expect(autoOpt!.projectedValue).toBe("REC Alpha 400W");
  });

  it("with hasGenerator: true — disabled when auto-generated value matches current", () => {
    const generatorEdges: FieldMappingEdge[] = [
      edge("zoho", "name", "_name", { direction: "push-only", generator: "skuName" }),
    ];
    const snapshots: FieldValueSnapshot[] = [
      snap("internal", "_name", "REC Alpha 400W"),
      snap("zoho", "name", "REC Alpha 400W"),
    ];
    const options = getDropdownOptions(
      "zoho", "name", "_name",
      generatorEdges, snapshots,
      { zoho: true, hubspot: false, zuper: false },
      null,
      true,
    );
    const autoOpt = options.find((o) => o.value === "auto-generated");
    expect(autoOpt!.disabled).toBe(true);
  });
});
