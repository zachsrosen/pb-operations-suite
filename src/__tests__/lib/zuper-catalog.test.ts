import {
  buildZuperCustomFieldsFromMetadata,
  buildZuperProductCustomFields,
  buildZuperSpecMetaData,
  createOrUpdateZuperPart,
  getZuperHubSpotProductFieldKey,
  getZuperHubSpotProductFieldLabel,
  readZuperCustomFieldValue,
  _resetCategoryCache,
} from "@/lib/zuper-catalog";
import { CATEGORY_CONFIGS } from "@/lib/catalog-fields";

type MockFetch = jest.MockedFunction<typeof fetch>;

function makeResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

/** Response for the /product_categories fetch that the resolver makes. */
const CATEGORY_RESPONSE = makeResponse({
  data: [
    { product_category_name: "General", product_category_uid: "de36210d-534a-48cb-980d-1bb1eb2f8201" },
    { product_category_name: "Solar Panel", product_category_uid: "aaaaaaaa-0000-0000-0000-000000000001" },
    { product_category_name: "Inverter", product_category_uid: "e21286e7-33a1-4e19-8981-790fb1c16d56" },
  ],
});

describe("zuper-catalog", () => {
  const originalEnv = process.env;
  let mockFetch: MockFetch;

  beforeEach(() => {
    jest.resetModules();
    _resetCategoryCache();
    process.env = {
      ...originalEnv,
      ZUPER_API_KEY: "test-zuper-key",
      ZUPER_API_URL: "https://zuper.example.com/api",
    };
    mockFetch = jest.fn() as MockFetch;
    global.fetch = mockFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns an existing Zuper item ID when lookup by SKU matches", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        type: "success",
        data: [
          {
            item_uid: "zuper_existing_1",
            sku: "REC400",
            name: "REC REC-400AA",
          },
        ],
      })
    );

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      category: "Module",
    });

    expect(result).toEqual({ zuperItemId: "zuper_existing_1", created: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("REC400");
  });

  it("retries create with core payload when optional payload is rejected", async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      // Category lookup for product creation
      if (url.includes("/product_categories")) {
        return CATEGORY_RESPONSE;
      }

      if (method === "GET") {
        return makeResponse({ type: "success", data: [] });
      }

      const body = String(init?.body || "");
      if (method === "POST" && url.includes("/product") && body.includes("category_name")) {
        return makeResponse({ type: "error", message: "Invalid category field" }, false, 400);
      }
      if (method === "POST" && url.includes("/product")) {
        return makeResponse({
          type: "success",
          item: { item_uid: "zuper_created_1" },
        });
      }

      return makeResponse({ type: "error", message: "Unhandled endpoint" }, false, 404);
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      description: "400W module",
      category: "Module",
      vendorName: "BayWa",
      unitLabel: "W",
      sellPrice: 180,
      unitCost: 120,
      specification: "400W Mono",
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_1", created: true });

    const postCalls = mockFetch.mock.calls.filter((call) => {
      const init = call[1];
      return String(init?.method || "GET").toUpperCase() === "POST";
    });
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("stops create fallbacks after first success-without-ID and resolves via re-search", async () => {
    let postCount = 0;
    mockFetch.mockImplementation(async (_input, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        if (postCount === 0) return makeResponse({ type: "success", data: [] });
        return makeResponse({
          type: "success",
          data: [{ item_uid: "zuper_created_research", sku: "REC400", name: "REC REC-400AA" }],
        });
      }

      postCount += 1;
      if (postCount === 1) {
        return makeResponse({ type: "success", message: "created" });
      }
      return makeResponse({ type: "error", message: "unexpected extra create call" }, false, 500);
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      sku: "REC400",
      category: "Module",
      sellPrice: 180,
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_research", created: true });
    expect(postCount).toBe(1);
  });

  it("does not name-match categoryless record when a category is required", async () => {
    let postCount = 0;
    mockFetch.mockImplementation(async (_input, init) => {
      const method = String(init?.method || "GET").toUpperCase();
      if (method === "GET") {
        return makeResponse({
          type: "success",
          data: [{ item_uid: "zuper_name_only", name: "REC REC-400AA" }],
        });
      }
      postCount += 1;
      return makeResponse({
        type: "success",
        item: { item_uid: "zuper_created_category_guard" },
      });
    });

    const result = await createOrUpdateZuperPart({
      brand: "REC",
      model: "REC-400AA",
      category: "Module",
    });

    expect(result).toEqual({ zuperItemId: "zuper_created_category_guard", created: true });
    expect(postCount).toBeGreaterThanOrEqual(1);
  });

  it("includes length, width, and weight in the optional payload sent to Zuper", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();

      if (url.includes("/product_categories")) {
        return CATEGORY_RESPONSE;
      }
      if (method === "GET") {
        return makeResponse({ type: "success", data: [] });
      }
      if (method === "POST" && url.includes("/product")) {
        capturedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return makeResponse({
          type: "success",
          item: { item_uid: "zuper_dims_1" },
        });
      }
      return makeResponse({ type: "error", message: "Unhandled endpoint" }, false, 404);
    });

    const result = await createOrUpdateZuperPart({
      brand: "Silfab",
      model: "SIL-380-BK",
      sku: "SIL380",
      category: "Module",
      length: 78,
      width: 39,
      weight: 50,
    });

    expect(result).toEqual({ zuperItemId: "zuper_dims_1", created: true });
    expect(capturedBody).not.toBeNull();

    // For the /product endpoint the body is wrapped as { product: { ... } };
    // for other endpoints it may be flat or wrapped differently.
    // Flatten one level to find dimensions regardless of wrapping shape.
    const inner =
      capturedBody!["product"] ??
      capturedBody!["item"] ??
      capturedBody!["part"] ??
      capturedBody;
    const innerRecord = inner as Record<string, unknown>;
    expect(innerRecord["length"]).toBe(78);
    expect(innerRecord["width"]).toBe(39);
    expect(innerRecord["weight"]).toBe(50);
  });

  it("omits dimension fields from payload when values are null or non-finite", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method || "GET").toUpperCase();
      if (url.includes("/product_categories")) return CATEGORY_RESPONSE;
      if (method === "GET") return makeResponse({ type: "success", data: [] });
      if (method === "POST" && url.includes("/product")) {
        capturedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return makeResponse({ type: "success", item: { item_uid: "zuper_nodims_1" } });
      }
      return makeResponse({ type: "error" }, false, 404);
    });

    await createOrUpdateZuperPart({
      brand: "Silfab",
      model: "SIL-380-BK",
      sku: "SIL380",
      category: "Module",
      length: null,
      width: undefined,
      weight: NaN,
    });

    expect(capturedBody).not.toBeNull();
    // Check both top-level and any nested product/item wrapper
    const innerOmit =
      capturedBody!["product"] ??
      capturedBody!["item"] ??
      capturedBody!["part"] ??
      capturedBody;
    const innerOmitRecord = innerOmit as Record<string, unknown>;
    expect(innerOmitRecord).not.toHaveProperty("length");
    expect(innerOmitRecord).not.toHaveProperty("width");
    expect(innerOmitRecord).not.toHaveProperty("weight");
  });

  it("throws when ZUPER_API_KEY is not configured", async () => {
    delete process.env.ZUPER_API_KEY;

    await expect(
      createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
      })
    ).rejects.toThrow(/ZUPER_API_KEY/i);
  });

  it("returns the shared HubSpot product custom field metadata", () => {
    expect(getZuperHubSpotProductFieldKey()).toBe("hubspot_product_id");
    expect(getZuperHubSpotProductFieldLabel()).toBe("HubSpot Product ID");
    expect(buildZuperProductCustomFields({ hubspotProductId: "1591770479" })).toEqual({
      hubspot_product_id: "1591770479",
    });
    expect(buildZuperProductCustomFields({ hubspotProductId: "   " })).toBeNull();
  });

  it("reads HubSpot product IDs from object-style Zuper custom fields", () => {
    expect(
      readZuperCustomFieldValue(
        { hubspot_product_id: "1591770479" },
        getZuperHubSpotProductFieldKey(),
        [getZuperHubSpotProductFieldLabel()]
      )
    ).toBe("1591770479");
  });

  it("reads HubSpot product IDs from array-style Zuper custom fields", () => {
    expect(
      readZuperCustomFieldValue(
        [
          { label: "HubSpot Product ID", value: "1591770479", type: "SINGLE_LINE" },
        ],
        getZuperHubSpotProductFieldKey(),
        [getZuperHubSpotProductFieldLabel()]
      )
    ).toBe("1591770479");
  });

  describe("customFields plumbing (M3.4)", () => {
    /** Capture the create payload sent to Zuper for assertion. */
    function setupCreateCapture(): { getBody: () => Record<string, unknown> | null } {
      let captured: Record<string, unknown> | null = null;
      mockFetch.mockImplementation(async (input, init) => {
        const url = String(input);
        const method = String(init?.method || "GET").toUpperCase();
        if (url.includes("/product_categories")) return CATEGORY_RESPONSE;
        if (method === "GET") return makeResponse({ type: "success", data: [] });
        if (method === "POST" && url.includes("/product")) {
          captured = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
          return makeResponse({
            type: "success",
            item: { item_uid: "zuper_cf_1" },
          });
        }
        return makeResponse({ type: "error" }, false, 404);
      });
      return { getBody: () => captured };
    }

    function getInner(body: Record<string, unknown>): Record<string, unknown> {
      return (body["product"] ?? body["item"] ?? body["part"] ?? body) as Record<string, unknown>;
    }

    it("includes custom_fields in the create payload when customFields is non-empty", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
        customFields: { pb_module_wattage: 400, pb_module_cell_type: "TOPCon" },
      });

      const body = cap.getBody();
      expect(body).not.toBeNull();
      const inner = getInner(body!);
      expect(inner["custom_fields"]).toEqual({
        pb_module_wattage: 400,
        pb_module_cell_type: "TOPCon",
      });
    });

    it("omits custom_fields when customFields is undefined", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
      });

      const body = cap.getBody();
      expect(body).not.toBeNull();
      const inner = getInner(body!);
      expect(inner).not.toHaveProperty("custom_fields");
    });

    it("omits custom_fields when customFields is an empty object", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
        customFields: {},
      });

      const body = cap.getBody();
      expect(body).not.toBeNull();
      const inner = getInner(body!);
      expect(inner).not.toHaveProperty("custom_fields");
    });
  });

  describe("buildZuperCustomFieldsFromMetadata (deprecated)", () => {
    it("always returns undefined — spec writes go through buildZuperSpecMetaData now", () => {
      expect(buildZuperCustomFieldsFromMetadata("MODULE", null)).toBeUndefined();
      expect(
        buildZuperCustomFieldsFromMetadata("MODULE", { wattage: 400, cellType: "TOPCon" }),
      ).toBeUndefined();
    });
  });

  describe("buildZuperSpecMetaData", () => {
    it("returns undefined for null metadata", () => {
      expect(buildZuperSpecMetaData("MODULE", null)).toBeUndefined();
    });

    it("emits meta_data entries with label/value/type for FieldDefs that have zuperCustomField", () => {
      // MODULE fields have real zuperCustomField labels populated post-Phase B.
      const out = buildZuperSpecMetaData("MODULE", {
        wattage: 400,
        cellType: "TOPCon",
        // imp has no zuperCustomField — should be skipped
        imp: 9.5,
      });

      expect(out).toBeDefined();
      const wattageEntry = out!.find((e) => e.label === "Module Wattage (W)");
      expect(wattageEntry).toMatchObject({
        label: "Module Wattage (W)",
        value: 400,
        type: "NUMBER",
        hide_field: false,
        hide_to_fe: false,
        module_name: "PRODUCT",
      });

      const cellEntry = out!.find((e) => e.label === "Module Cell Type");
      expect(cellEntry).toMatchObject({
        label: "Module Cell Type",
        value: "TOPCon",
        type: "DROPDOWN",
      });
      // DROPDOWN includes options derived from FieldDef.options
      expect(cellEntry?.options).toEqual([
        { label: "Mono PERC", value: "Mono PERC" },
        { label: "TOPCon", value: "TOPCon" },
        { label: "HJT", value: "HJT" },
        { label: "Poly", value: "Poly" },
        { label: "Thin Film", value: "Thin Film" },
      ]);

      // imp shouldn't appear
      expect(out!.find((e) => e.label.toLowerCase().includes("imp"))).toBeUndefined();
    });

    it("skips empty/null/undefined values", () => {
      const out = buildZuperSpecMetaData("MODULE", {
        wattage: null,
        cellType: "",
        voc: undefined,
      });
      expect(out).toBeUndefined();
    });

    it("returns undefined when category has no zuperCustomField mappings", () => {
      // ELECTRICAL_BOS has fields but none have zuperCustomField populated.
      expect(
        buildZuperSpecMetaData("ELECTRICAL_BOS", {
          componentType: "Wire",
          gaugeSize: "10AWG",
        }),
      ).toBeUndefined();
    });

    it("infers type from FieldDef.type", () => {
      const original = CATEGORY_CONFIGS.MODULE.fields;
      try {
        CATEGORY_CONFIGS.MODULE.fields = [
          { key: "n", label: "N", type: "number", zuperCustomField: "N Label" },
          { key: "d", label: "D", type: "dropdown", options: ["A", "B"], zuperCustomField: "D Label" },
          { key: "t", label: "T", type: "text", zuperCustomField: "T Label" },
          { key: "b", label: "B", type: "toggle", zuperCustomField: "B Label" },
        ];

        const out = buildZuperSpecMetaData("MODULE", {
          n: 1,
          d: "A",
          t: "hello",
          b: true,
        });

        expect(out).toBeDefined();
        expect(out!.find((e) => e.label === "N Label")?.type).toBe("NUMBER");
        expect(out!.find((e) => e.label === "D Label")?.type).toBe("DROPDOWN");
        expect(out!.find((e) => e.label === "T Label")?.type).toBe("SINGLE_LINE");
        expect(out!.find((e) => e.label === "B Label")?.type).toBe("BOOLEAN");
      } finally {
        CATEGORY_CONFIGS.MODULE.fields = original;
      }
    });
  });

  describe("customMetaData plumbing — Phase B (M3.4 activation)", () => {
    function setupCreateCapture(): { getBody: () => Record<string, unknown> | null } {
      let captured: Record<string, unknown> | null = null;
      mockFetch.mockImplementation(async (input, init) => {
        const url = String(input);
        const method = String(init?.method || "GET").toUpperCase();
        if (url.includes("/product_categories")) return CATEGORY_RESPONSE;
        if (method === "GET") return makeResponse({ type: "success", data: [] });
        if (method === "POST" && url.includes("/product")) {
          captured = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
          return makeResponse({
            type: "success",
            item: { item_uid: "zuper_md_1" },
          });
        }
        return makeResponse({ type: "error" }, false, 404);
      });
      return { getBody: () => captured };
    }

    function getInner(body: Record<string, unknown>): Record<string, unknown> {
      return (body["product"] ?? body["item"] ?? body["part"] ?? body) as Record<string, unknown>;
    }

    it("forwards customMetaData entries to the create payload as meta_data array", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
        customMetaData: [
          {
            label: "Module Wattage (W)",
            value: 400,
            type: "NUMBER",
            hide_field: false,
            hide_to_fe: false,
            module_name: "PRODUCT",
          },
          {
            label: "Module Cell Type",
            value: "TOPCon",
            type: "DROPDOWN",
            hide_field: false,
            hide_to_fe: false,
            module_name: "PRODUCT",
            options: [
              { label: "Mono PERC", value: "Mono PERC" },
              { label: "TOPCon", value: "TOPCon" },
            ],
          },
        ],
      });

      const body = cap.getBody();
      expect(body).not.toBeNull();
      const inner = getInner(body!);
      expect(inner["meta_data"]).toEqual([
        expect.objectContaining({
          label: "Module Wattage (W)",
          value: 400,
          type: "NUMBER",
        }),
        expect.objectContaining({
          label: "Module Cell Type",
          value: "TOPCon",
          type: "DROPDOWN",
          options: expect.arrayContaining([
            { label: "TOPCon", value: "TOPCon" },
          ]),
        }),
      ]);
    });

    it("omits meta_data when customMetaData is undefined", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
      });

      const body = cap.getBody();
      const inner = getInner(body!);
      expect(inner).not.toHaveProperty("meta_data");
    });

    it("omits meta_data when customMetaData is an empty array", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
        customMetaData: [],
      });

      const body = cap.getBody();
      const inner = getInner(body!);
      expect(inner).not.toHaveProperty("meta_data");
    });

    it("sends both custom_fields (cross-link IDs) and meta_data (specs) when both present", async () => {
      const cap = setupCreateCapture();

      await createOrUpdateZuperPart({
        brand: "REC",
        model: "REC-400AA",
        sku: "REC400",
        category: "Module",
        customFields: { hubspot_product_id: "1591770479", internal_product_id: "ip_1" },
        customMetaData: [
          {
            label: "Module Wattage (W)",
            value: 400,
            type: "NUMBER",
          },
        ],
      });

      const body = cap.getBody();
      const inner = getInner(body!);
      expect(inner["custom_fields"]).toEqual({
        hubspot_product_id: "1591770479",
        internal_product_id: "ip_1",
      });
      expect(inner["meta_data"]).toEqual([
        expect.objectContaining({ label: "Module Wattage (W)", value: 400 }),
      ]);
    });
  });
});
