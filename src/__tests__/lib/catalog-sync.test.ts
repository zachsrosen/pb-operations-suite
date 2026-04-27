const mockGetZuperPartById = jest.fn();
const mockUpdateZuperPart = jest.fn();
const mockCreateOrUpdateZuperPart = jest.fn();
const mockBuildZuperSpecMetaData = jest.fn();
const mockBuildZuperProductCustomFields = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        internalProduct: {
          findUnique: (...args: unknown[]) => mockFindUnique(...args),
          updateMany: (...args: unknown[]) => mockUpdateMany(...args),
        },
      }),
  },
}));

jest.mock("@/lib/zuper-catalog", () => {
  const actual = jest.requireActual("@/lib/zuper-catalog");
  return {
    ...actual,
    getZuperPartById: (...args: unknown[]) => mockGetZuperPartById(...args),
    updateZuperPart: (...args: unknown[]) => mockUpdateZuperPart(...args),
    createOrUpdateZuperPart: (...args: unknown[]) => mockCreateOrUpdateZuperPart(...args),
    buildZuperSpecMetaData: (...args: unknown[]) => mockBuildZuperSpecMetaData(...args),
    buildZuperProductCustomFields: (...args: unknown[]) =>
      mockBuildZuperProductCustomFields(...args),
    getZuperHubSpotProductFieldKey: jest.fn(() => "hubspot_product_id"),
    getZuperHubSpotProductFieldLabel: jest.fn(() => "HubSpot Product ID"),
    readZuperCustomFieldValue: jest.fn((customFields: unknown, key: string, additionalLabels?: string[]) => {
      const matchTerms = [key, ...(additionalLabels || [])];
      // Shape 1: flat object
      if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
        for (const term of matchTerms) {
          const value = (customFields as Record<string, unknown>)[term];
          if (typeof value === "string" && value.trim()) return value;
        }
      }
      // Shape 2: array of { label, value, name? }
      if (Array.isArray(customFields)) {
        for (const entry of customFields) {
          if (!entry || typeof entry !== "object") continue;
          const rec = entry as Record<string, unknown>;
          const name = typeof rec.name === "string" ? rec.name : undefined;
          const label = typeof rec.label === "string" ? rec.label : undefined;
          for (const term of matchTerms) {
            if (name === term || label === term) {
              return typeof rec.value === "string" ? rec.value : null;
            }
          }
        }
      }
      return null;
    }),
  };
});

import { executeZuperSync, previewSyncToLinkedSystems, type SyncPreview, type SkuRecord } from "@/lib/catalog-sync";

describe("catalog-sync Zuper", () => {
  const sku: SkuRecord = {
    id: "sku_1",
    category: "BATTERY",
    brand: "Tesla",
    model: "1707000-21-K",
    name: "Tesla Powerwall 3",
    description: "Powerwall 3",
    sku: "1707000-21-K",
    vendorName: "Tesla",
    vendorPartNumber: "1707000-21-K",
    unitSpec: 13.5,
    unitLabel: "kWh",
    unitCost: 9000,
    sellPrice: 12000,
    hardToProcure: false,
    length: null,
    width: null,
    weight: null,
    zohoItemId: null,
    zohoVendorId: null,
    hubspotProductId: "1591770479",
    zuperItemId: "zuper_1",
    batterySpec: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no pre-existing external ID (create path not blocked by race guard)
    mockFindUnique.mockResolvedValue({ zuperItemId: null });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    // Default: no spec-derived meta_data and no cross-link IDs.
    mockBuildZuperSpecMetaData.mockReturnValue(undefined);
    mockBuildZuperProductCustomFields.mockReturnValue(null);
  });

  it("parses product_* prefixed fields from Zuper API response", async () => {
    mockGetZuperPartById.mockResolvedValue({
      product_uid: "zuper_1",
      product_name: "Tesla 1707000-21-K",
      product_id: "1707000-21-K",
      product_description: "Powerwall 3",
      product_category: { category_name: "Battery" },
      specification: null,
      meta_data: [],
    });

    const previews = await previewSyncToLinkedSystems(sku, ["zuper"]);

    expect(previews).toHaveLength(1);
    expect(previews[0].system).toBe("zuper");
    // With correct field mapping, name/sku/description/category all match —
    // only specification differs (null vs generated value)
    const changedFields = previews[0].changes.map((c) => c.field);
    expect(changedFields).not.toContain("name");
    expect(changedFields).not.toContain("sku");
    expect(changedFields).not.toContain("description");
    expect(changedFields).not.toContain("category");
  });

  it("detects diffs when Zuper fields differ from internal product", async () => {
    mockGetZuperPartById.mockResolvedValue({
      product_uid: "zuper_1",
      product_name: "Tesla OLD-MODEL",
      product_id: "OLD-MODEL",
      product_description: "Old description",
      product_category: { category_name: "Battery" },
      specification: null,
      meta_data: [],
    });

    const previews = await previewSyncToLinkedSystems(sku, ["zuper"]);

    expect(previews).toHaveLength(1);
    const changedFields = previews[0].changes.map((c) => c.field);
    expect(changedFields).toContain("name");
    expect(changedFields).toContain("sku");
    expect(changedFields).toContain("description");

    const nameDiff = previews[0].changes.find((c) => c.field === "name");
    expect(nameDiff?.currentValue).toBe("Tesla OLD-MODEL");
    expect(nameDiff?.proposedValue).toBe("Tesla 1707000-21-K");
  });

  it("reports no changes when Zuper is fully in sync", async () => {
    mockGetZuperPartById.mockResolvedValue({
      product_uid: "zuper_1",
      product_name: "Tesla 1707000-21-K",
      product_id: "1707000-21-K",
      product_description: "Powerwall 3",
      product_category: { category_name: "Battery" },
      specification: null,
      meta_data: [
        { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
      ],
    });

    const previews = await previewSyncToLinkedSystems(sku, ["zuper"]);

    expect(previews).toHaveLength(1);
    // Standard fields all match — custom field support not yet in preview
    const changedFields = previews[0].changes.map((c) => c.field);
    expect(changedFields).not.toContain("name");
    expect(changedFields).not.toContain("sku");
    expect(changedFields).not.toContain("description");
    expect(changedFields).not.toContain("category");
  });

  it("nests dotted custom_fields keys on update", async () => {
    const preview: SyncPreview = {
      system: "zuper",
      externalId: "zuper_1",
      linked: true,
      action: "update",
      noChanges: false,
      changes: [
        {
          field: "custom_fields.hubspot_product_id",
          currentValue: null,
          proposedValue: "1591770479",
        },
      ],
    };
    mockUpdateZuperPart.mockResolvedValue({
      status: "updated",
      zuperItemId: "zuper_1",
      message: "updated",
    });

    const result = await executeZuperSync(sku, preview);

    expect(mockUpdateZuperPart).toHaveBeenCalledWith("zuper_1", {
      custom_fields: { hubspot_product_id: "1591770479" },
    });
    expect(result.status).toBe("updated");
  });

  it("nests dotted keys alongside top-level fields on mixed updates", async () => {
    const preview: SyncPreview = {
      system: "zuper",
      externalId: "zuper_1",
      linked: true,
      action: "update",
      noChanges: false,
      changes: [
        {
          field: "name",
          currentValue: "Tesla Old Name",
          proposedValue: "Tesla 1707000-21-K",
        },
        {
          field: "description",
          currentValue: "Old description",
          proposedValue: "Powerwall 3",
        },
        {
          field: "custom_fields.hubspot_product_id",
          currentValue: null,
          proposedValue: "1591770479",
        },
      ],
    };
    mockUpdateZuperPart.mockResolvedValue({
      status: "updated",
      zuperItemId: "zuper_1",
      message: "updated",
    });

    const result = await executeZuperSync(sku, preview);

    expect(mockUpdateZuperPart).toHaveBeenCalledWith("zuper_1", {
      product_name: "Tesla 1707000-21-K",
      product_description: "Powerwall 3",
      custom_fields: { hubspot_product_id: "1591770479" },
    });
    expect(result.status).toBe("updated");
  });

  it("M3.4: routes spec-label change into merged meta_data on update, preserving cross-link entries", async () => {
    // Arrange — Zuper currently has a HubSpot Product ID entry plus a stale
    // Battery Capacity entry. The update should merge the new capacity in
    // by label and keep the cross-link entry untouched.
    mockGetZuperPartById.mockResolvedValue({
      product_uid: "zuper_1",
      meta_data: [
        { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
        { label: "Battery Capacity (kWh)", value: 10, type: "NUMBER" },
      ],
    });
    mockUpdateZuperPart.mockResolvedValue({
      status: "updated",
      zuperItemId: "zuper_1",
      message: "updated",
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "zuper_1",
      linked: true,
      action: "update",
      noChanges: false,
      changes: [
        // Spec label as emitted by the M3.3 mapping registry
        { field: "Battery Capacity (kWh)", currentValue: "10", proposedValue: "13.5" },
        // A non-spec change should still flow through top-level mapping
        { field: "name", currentValue: "Tesla Old", proposedValue: "Tesla 1707000-21-K" },
      ],
    };

    const result = await executeZuperSync(sku, preview);

    expect(result.status).toBe("updated");
    expect(mockGetZuperPartById).toHaveBeenCalledWith("zuper_1");
    expect(mockUpdateZuperPart).toHaveBeenCalledTimes(1);
    const [, fieldsArg] = mockUpdateZuperPart.mock.calls[0];
    // Top-level mapping still runs for non-spec changes
    expect(fieldsArg.product_name).toBe("Tesla 1707000-21-K");
    // Spec label is NOT written as a top-level field
    expect(fieldsArg["Battery Capacity (kWh)"]).toBeUndefined();
    // meta_data is the FULL merged array
    expect(fieldsArg.meta_data).toEqual([
      { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
      expect.objectContaining({
        label: "Battery Capacity (kWh)",
        value: 13.5,
        type: "NUMBER",
      }),
    ]);
  });

  it("M3.4: appends spec entry to meta_data when label is not yet present", async () => {
    mockGetZuperPartById.mockResolvedValue({
      product_uid: "zuper_1",
      meta_data: [
        { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
      ],
    });
    mockUpdateZuperPart.mockResolvedValue({
      status: "updated",
      zuperItemId: "zuper_1",
      message: "updated",
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "zuper_1",
      linked: true,
      action: "update",
      noChanges: false,
      changes: [
        { field: "Battery Chemistry", currentValue: null, proposedValue: "LFP" },
      ],
    };

    await executeZuperSync(sku, preview);

    const [, fieldsArg] = mockUpdateZuperPart.mock.calls[0];
    expect(fieldsArg.meta_data).toEqual([
      { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
      expect.objectContaining({
        label: "Battery Chemistry",
        value: "LFP",
        type: "DROPDOWN",
      }),
    ]);
  });

  it("M3.4: skips meta_data fetch when there are no spec-label changes", async () => {
    mockUpdateZuperPart.mockResolvedValue({
      status: "updated",
      zuperItemId: "zuper_1",
      message: "updated",
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "zuper_1",
      linked: true,
      action: "update",
      noChanges: false,
      changes: [
        { field: "name", currentValue: "Old", proposedValue: "New" },
      ],
    };

    await executeZuperSync(sku, preview);

    expect(mockGetZuperPartById).not.toHaveBeenCalled();
    const [, fieldsArg] = mockUpdateZuperPart.mock.calls[0];
    expect(fieldsArg.meta_data).toBeUndefined();
  });

  it("passes dimensions to createOrUpdateZuperPart on create", async () => {
    const skuWithDims: SkuRecord = {
      ...sku,
      id: "sku_dims",
      zuperItemId: null,
      length: 78,
      width: 39,
      weight: 50,
    };

    mockCreateOrUpdateZuperPart.mockResolvedValue({
      zuperItemId: "zuper_created_dims",
      created: true,
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "",
      linked: false,
      action: "create",
      noChanges: false,
      changes: [],
    };

    const result = await executeZuperSync(skuWithDims, preview);

    expect(result.status).toBe("created");
    expect(result.externalId).toBe("zuper_created_dims");

    expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledWith(
      expect.objectContaining({
        length: 78,
        width: 39,
        weight: 50,
      })
    );
  });

  it("forwards spec-derived customMetaData to createOrUpdateZuperPart on create (M3.4 activated)", async () => {
    // Simulate FieldDef.zuperCustomField labels resolving to meta_data entries
    mockBuildZuperSpecMetaData.mockReturnValue([
      { label: "Battery Capacity (kWh)", value: 13.5, type: "NUMBER" },
      { label: "Battery Chemistry", value: "LFP", type: "DROPDOWN" },
    ]);
    mockBuildZuperProductCustomFields.mockReturnValue({
      hubspot_product_id: "1591770479",
      internal_product_id: "sku_with_spec",
    });

    const skuWithSpec: SkuRecord = {
      ...sku,
      id: "sku_with_spec",
      zuperItemId: null,
      batterySpec: { capacityKwh: 13.5, chemistry: "LFP" },
    };

    mockCreateOrUpdateZuperPart.mockResolvedValue({
      zuperItemId: "zuper_created_md",
      created: true,
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "",
      linked: false,
      action: "create",
      noChanges: false,
      changes: [],
    };

    const result = await executeZuperSync(skuWithSpec, preview);

    expect(result.status).toBe("created");
    // Spec helper invoked with category + spec data
    expect(mockBuildZuperSpecMetaData).toHaveBeenCalledWith(
      "BATTERY",
      expect.objectContaining({ capacityKwh: 13.5, chemistry: "LFP" }),
    );
    // Cross-link ID helper invoked with the available IDs at create time
    expect(mockBuildZuperProductCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        internalProductId: "sku_with_spec",
        hubspotProductId: "1591770479",
      }),
    );
    // Both threaded into the create call: spec values via customMetaData,
    // cross-link IDs via customFields (snake_case keys).
    expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledWith(
      expect.objectContaining({
        customMetaData: [
          { label: "Battery Capacity (kWh)", value: 13.5, type: "NUMBER" },
          { label: "Battery Chemistry", value: "LFP", type: "DROPDOWN" },
        ],
        customFields: {
          hubspot_product_id: "1591770479",
          internal_product_id: "sku_with_spec",
        },
      }),
    );
  });

  it("passes undefined customMetaData when no zuperCustomField mappings resolve", async () => {
    // Default mocks: spec helper returns undefined, cross-link helper returns null
    const skuFresh: SkuRecord = {
      ...sku,
      id: "sku_no_md",
      zuperItemId: null,
      hubspotProductId: null,
      zohoItemId: null,
    };

    mockCreateOrUpdateZuperPart.mockResolvedValue({
      zuperItemId: "zuper_no_md",
      created: true,
    });

    const preview: SyncPreview = {
      system: "zuper",
      externalId: "",
      linked: false,
      action: "create",
      noChanges: false,
      changes: [],
    };

    await executeZuperSync(skuFresh, preview);

    expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledWith(
      expect.objectContaining({
        customMetaData: undefined,
        customFields: undefined,
      }),
    );
  });
});
