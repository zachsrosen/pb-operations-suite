import { catalogFormReducer, initialFormState, isBlank, validateRequiredSpecFields, validateCatalogForm, type CatalogFormState } from "@/lib/catalog-form-state";

describe("catalogFormReducer", () => {
  it("returns initial state", () => {
    expect(initialFormState.category).toBe("");
    expect(initialFormState.brand).toBe("");
    expect(initialFormState.systems).toEqual(new Set(["INTERNAL"]));
    expect(initialFormState.specValues).toEqual({});
  });

  it("handles SET_FIELD for string fields", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "SET_FIELD",
      field: "brand",
      value: "Hanwha",
    });
    expect(state.brand).toBe("Hanwha");
  });

  it("handles SET_CATEGORY and resets specValues", () => {
    const withSpecs = { ...initialFormState, specValues: { wattage: 400 } };
    const state = catalogFormReducer(withSpecs, {
      type: "SET_CATEGORY",
      category: "INVERTER",
    });
    expect(state.category).toBe("INVERTER");
    expect(state.specValues).toEqual({});
  });

  it("handles TOGGLE_SYSTEM", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "TOGGLE_SYSTEM",
      system: "HUBSPOT",
    });
    expect(state.systems.has("HUBSPOT")).toBe(true);
    // Toggle off
    const state2 = catalogFormReducer(state, {
      type: "TOGGLE_SYSTEM",
      system: "HUBSPOT",
    });
    expect(state2.systems.has("HUBSPOT")).toBe(false);
    // INTERNAL cannot be toggled off
    const state3 = catalogFormReducer(initialFormState, {
      type: "TOGGLE_SYSTEM",
      system: "INTERNAL",
    });
    expect(state3.systems.has("INTERNAL")).toBe(true);
  });

  it("handles PREFILL_FROM_PRODUCT for clone", () => {
    const product = {
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      unitSpec: "400",
      unitLabel: "W",
      unitCost: "150",
      sellPrice: "200",
      hardToProcure: false,
      specValues: { wattage: 400 },
    };
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: product,
      source: "clone",
    });
    expect(state.brand).toBe("Hanwha");
    expect(state.model).toBe("Q.PEAK 400");
    expect(state.sku).toBe(""); // cleared on clone
    expect(state.vendorPartNumber).toBe(""); // cleared on clone
    expect(state.prefillSource).toBe("clone");
    expect(state.prefillFields).toContain("brand");
    // P2: spec keys tracked individually, not as "specValues" blob
    expect(state.prefillFields).toContain("spec.wattage");
    expect(state.prefillFields).not.toContain("specValues");
  });

  it("handles PREFILL_FROM_PRODUCT for datasheet", () => {
    const extracted = {
      category: "BATTERY",
      brand: "Tesla",
      model: "Powerwall 3",
      description: "Home battery",
      specValues: { capacityKwh: 13.5 },
    };
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: extracted,
      source: "datasheet",
    });
    expect(state.prefillSource).toBe("datasheet");
    expect(state.prefillFields).toContain("brand");
    expect(state.prefillFields).not.toContain("sku"); // wasn't provided
    // P2: individual spec key tracked (only category-valid keys are kept)
    expect(state.prefillFields).toContain("spec.capacityKwh");
  });

  it("clears stale state when re-prefilling (P1)", () => {
    // First prefill sets photoUrl and unitLabel
    const first = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: { brand: "Tesla", model: "Powerwall 3", photoUrl: "https://example.com/pw3.jpg", unitLabel: "kWh" },
      source: "clone",
    });
    expect(first.photoUrl).toBe("https://example.com/pw3.jpg");
    expect(first.unitLabel).toBe("kWh");

    // Second prefill omits photoUrl and unitLabel — they must not persist
    const second = catalogFormReducer(first, {
      type: "PREFILL_FROM_PRODUCT",
      data: { brand: "Enphase", model: "IQ Battery 5P" },
      source: "datasheet",
    });
    expect(second.brand).toBe("Enphase");
    expect(second.photoUrl).toBe(""); // reset, not leaked from first prefill
    expect(second.unitLabel).toBe(""); // reset, not leaked from first prefill
  });

  it("handles CLEAR_PREFILL_FIELD", () => {
    const prefilled = {
      ...initialFormState,
      brand: "Hanwha",
      prefillSource: "clone" as const,
      prefillFields: new Set(["brand", "model"]),
    };
    const state = catalogFormReducer(prefilled, {
      type: "CLEAR_PREFILL_FIELD",
      field: "brand",
    });
    expect(state.prefillFields.has("brand")).toBe(false);
    expect(state.prefillFields.has("model")).toBe(true);
  });

  it("handles RESET", () => {
    const dirty = { ...initialFormState, brand: "Hanwha", model: "Q.PEAK" };
    const state = catalogFormReducer(dirty, { type: "RESET" });
    expect(state).toEqual(initialFormState);
  });

  it("produces correct payload from a completed wizard flow", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "MODULE" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Hanwha" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "model", value: "Q.PEAK 400" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "description", value: "400W Module" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitCost", value: "150" });
    state = catalogFormReducer(state, { type: "SET_SPEC", key: "wattage", value: 400 });
    state = catalogFormReducer(state, { type: "TOGGLE_SYSTEM", system: "HUBSPOT" });

    expect(state.category).toBe("MODULE");
    expect(state.brand).toBe("Hanwha");
    expect(state.model).toBe("Q.PEAK 400");
    expect(state.specValues).toEqual({ wattage: 400 });
    expect(state.systems.has("INTERNAL")).toBe(true);
    expect(state.systems.has("HUBSPOT")).toBe(true);
    expect(state.unitCost).toBe("150");
  });

  it("SET_CATEGORY resets specValues but preserves other fields", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Enphase" });
    state = catalogFormReducer(state, { type: "SET_SPEC", key: "wattage", value: 400 });
    state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "INVERTER" });
    expect(state.specValues).toEqual({});
    expect(state.brand).toBe("Enphase");
  });

  it("SET_FIELD works for photoUrl and photoFileName", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "photoUrl", value: "https://blob/photo.jpg" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "photoFileName", value: "photo.jpg" });
    expect(state.photoUrl).toBe("https://blob/photo.jpg");
    expect(state.photoFileName).toBe("photo.jpg");
  });
});

describe("isBlank", () => {
  it("returns true for undefined, null, empty string, whitespace", () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank("\t\n")).toBe(true);
  });

  it("returns false for 0, false, and non-empty strings", () => {
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
    expect(isBlank("hello")).toBe(false);
    expect(isBlank(42)).toBe(false);
  });
});

describe("validateRequiredSpecFields", () => {
  it("returns no errors for MODULE with wattage filled", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 400 });
    expect(errors).toEqual([]);
  });

  it("returns error for MODULE with wattage missing", () => {
    const errors = validateRequiredSpecFields("MODULE", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.wattage");
    expect(errors[0].section).toBe("details");
  });

  it("returns error for MODULE with wattage blank string", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.wattage");
  });

  it("passes for MODULE with wattage = 0 (zero is not blank)", () => {
    const errors = validateRequiredSpecFields("MODULE", { wattage: 0 });
    expect(errors).toEqual([]);
  });

  it("returns no errors for RACKING (no required fields)", () => {
    const errors = validateRequiredSpecFields("RACKING", {});
    expect(errors).toEqual([]);
  });

  it("returns no errors for blank/unknown category", () => {
    const errors = validateRequiredSpecFields("", {});
    expect(errors).toEqual([]);
    const errors2 = validateRequiredSpecFields("DOES_NOT_EXIST", {});
    expect(errors2).toEqual([]);
  });

  it("returns error for BATTERY capacityKwh missing", () => {
    const errors = validateRequiredSpecFields("BATTERY", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.capacityKwh");
  });

  it("returns error for BATTERY_EXPANSION capacityKwh missing (shared fields)", () => {
    const errors = validateRequiredSpecFields("BATTERY_EXPANSION", {});
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("spec.capacityKwh");
  });

  it("ignores non-spec keys like _photoUrl in metadata", () => {
    const errors = validateRequiredSpecFields("MODULE", { _photoUrl: "https://example.com/photo.jpg", wattage: 400 });
    expect(errors).toEqual([]);
  });

  it("skips required fields hidden by showWhen conditions", () => {
    const getCategoryFields = jest.requireActual("@/lib/catalog-fields").getCategoryFields;
    const mockGetCategoryFields = jest.spyOn(
      require("@/lib/catalog-fields"), "getCategoryFields"
    ).mockImplementation((cat: string) => {
      if (cat === "TEST_SHOW_WHEN") {
        return [
          { key: "toggleField", label: "Toggle", type: "toggle" },
          { key: "conditionalField", label: "Conditional", type: "number", required: true, showWhen: { field: "toggleField", value: true } },
        ];
      }
      return getCategoryFields(cat);
    });

    // showWhen NOT met — conditionalField is required but hidden, so no error
    const errors1 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: false });
    expect(errors1).toEqual([]);

    // showWhen IS met — conditionalField is visible and required, so error
    const errors2 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: true });
    expect(errors2).toHaveLength(1);
    expect(errors2[0].field).toBe("spec.conditionalField");

    // showWhen IS met and field is filled — no error
    const errors3 = validateRequiredSpecFields("TEST_SHOW_WHEN", { toggleField: true, conditionalField: 42 });
    expect(errors3).toEqual([]);

    mockGetCategoryFields.mockRestore();
  });
});

describe("validateCatalogForm", () => {
  function makeState(overrides: Partial<CatalogFormState> = {}): CatalogFormState {
    return { ...initialFormState, ...overrides };
  }

  it("returns valid for a complete MODULE submission", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: { wattage: 400 },
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns errors for missing top-level required fields", () => {
    const result = validateCatalogForm(makeState({
      category: "",
      brand: "",
      model: "",
      description: "",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("category");
    expect(fields).toContain("brand");
    expect(fields).toContain("model");
    expect(fields).toContain("description");
  });

  it("rejects whitespace-only top-level fields", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "  ",
      model: "\t",
      description: "\n",
      specValues: { wattage: 400 },
    }));
    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("brand");
    expect(fields).toContain("model");
    expect(fields).toContain("description");
  });

  it("returns spec errors for MODULE missing wattage", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: {},
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "spec.wattage")).toBe(true);
  });

  it("returns valid for RACKING with no spec fields", () => {
    const result = validateCatalogForm(makeState({
      category: "RACKING",
      brand: "IronRidge",
      model: "XR100",
      description: "Roof mount",
    }));
    expect(result.valid).toBe(true);
  });

  it("returns warning (not error) for sell < cost", () => {
    const result = validateCatalogForm(makeState({
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      specValues: { wattage: 400 },
      unitCost: "200",
      sellPrice: "150",
    }));
    expect(result.valid).toBe(true); // warning, not error
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].field).toBe("sellPrice");
  });

  it("blank category skips spec checks, returns only top-level error", () => {
    const result = validateCatalogForm(makeState({
      category: "",
      brand: "Test",
      model: "Test",
      description: "Test",
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].field).toBe("category");
  });
});

describe("SET_VENDOR action", () => {
  it("sets both vendorName and zohoVendorId atomically", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "SET_VENDOR",
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    });
    expect(state.vendorName).toBe("Rell Power");
    expect(state.zohoVendorId).toBe("v123");
  });

  it("clears both when called with empty values", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_VENDOR",
      vendorName: "",
      zohoVendorId: "",
    });
    expect(state.vendorName).toBe("");
    expect(state.zohoVendorId).toBe("");
  });
});

describe("SET_FIELD vendorName clears zohoVendorId", () => {
  it("clears zohoVendorId when vendorName is set via SET_FIELD", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_FIELD",
      field: "vendorName",
      value: "Something else",
    });
    expect(state.vendorName).toBe("Something else");
    expect(state.zohoVendorId).toBe("");
  });

  it("does not clear zohoVendorId when other fields set via SET_FIELD", () => {
    const withVendor = {
      ...initialFormState,
      vendorName: "Rell Power",
      zohoVendorId: "v123",
    };
    const state = catalogFormReducer(withVendor, {
      type: "SET_FIELD",
      field: "brand",
      value: "NewBrand",
    });
    expect(state.zohoVendorId).toBe("v123");
  });
});

describe("PREFILL_FROM_PRODUCT with zohoVendorId", () => {
  it("copies zohoVendorId when present (valid pair)", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        brand: "Tesla",
        vendorName: "Rell Power",
        zohoVendorId: "v123",
      },
      source: "clone",
    });
    expect(state.vendorName).toBe("Rell Power");
    expect(state.zohoVendorId).toBe("v123");
  });

  it("sets vendorHint and clears vendorName when source has vendorName but no zohoVendorId (legacy)", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        brand: "Tesla",
        vendorName: "Rell Power",
      },
      source: "clone",
    });
    expect(state.vendorName).toBe("");
    expect(state.zohoVendorId).toBe("");
    expect(state.vendorHint).toBe("Rell Power");
    expect(state.prefillFields.has("vendorName")).toBe(false);
  });

  it("passes through vendorHint from datasheet extract", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      data: {
        category: "MODULE",
        vendorHint: "SolarEdge Inc",
      },
      source: "datasheet",
    });
    expect(state.vendorHint).toBe("SolarEdge Inc");
  });
});
