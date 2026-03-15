import { catalogFormReducer, initialFormState, type CatalogFormState } from "@/lib/catalog-form-state";

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
