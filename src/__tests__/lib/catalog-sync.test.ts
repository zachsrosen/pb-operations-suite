const mockGetZuperPartById = jest.fn();
const mockUpdateZuperPart = jest.fn();
const mockCreateOrUpdateZuperPart = jest.fn();
const mockBuildZuperCustomFieldsFromMetadata = jest.fn();
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

jest.mock("@/lib/zuper-catalog", () => ({
  getZuperPartById: (...args: unknown[]) => mockGetZuperPartById(...args),
  updateZuperPart: (...args: unknown[]) => mockUpdateZuperPart(...args),
  createOrUpdateZuperPart: (...args: unknown[]) => mockCreateOrUpdateZuperPart(...args),
  buildZuperCustomFieldsFromMetadata: (...args: unknown[]) =>
    mockBuildZuperCustomFieldsFromMetadata(...args),
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
}));

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
    // Default: no spec-derived custom fields. Matches current state where
    // catalog-fields.ts has no zuperCustomField keys populated.
    mockBuildZuperCustomFieldsFromMetadata.mockReturnValue(undefined);
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

  it("forwards spec-derived customFields to createOrUpdateZuperPart on create (M3.4)", async () => {
    // Simulate FieldDef.zuperCustomField being populated for this category
    mockBuildZuperCustomFieldsFromMetadata.mockReturnValue({
      pb_battery_capacity_kwh: 13.5,
      pb_battery_chemistry: "LFP",
    });

    const skuWithSpec: SkuRecord = {
      ...sku,
      id: "sku_with_spec",
      zuperItemId: null,
      batterySpec: { capacityKwh: 13.5, chemistry: "LFP" },
    };

    mockCreateOrUpdateZuperPart.mockResolvedValue({
      zuperItemId: "zuper_created_cf",
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
    // Helper should have been invoked with category + spec data
    expect(mockBuildZuperCustomFieldsFromMetadata).toHaveBeenCalledWith(
      "BATTERY",
      expect.objectContaining({ capacityKwh: 13.5, chemistry: "LFP" }),
    );
    // And its return value threaded into the create call
    expect(mockCreateOrUpdateZuperPart).toHaveBeenCalledWith(
      expect.objectContaining({
        customFields: {
          pb_battery_capacity_kwh: 13.5,
          pb_battery_chemistry: "LFP",
        },
      }),
    );
  });

  it("passes undefined customFields when no zuperCustomField mappings populated (current state)", async () => {
    // Default mock returns undefined → matches pre-activation state
    const skuFresh: SkuRecord = { ...sku, id: "sku_no_cf", zuperItemId: null };

    mockCreateOrUpdateZuperPart.mockResolvedValue({
      zuperItemId: "zuper_no_cf",
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
      expect.objectContaining({ customFields: undefined }),
    );
  });
});
