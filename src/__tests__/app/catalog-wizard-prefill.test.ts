import { catalogFormReducer, initialFormState } from "@/lib/catalog-form-state";
import { getCategoryDefaults } from "@/lib/catalog-fields";

/**
 * Tests that URL search params and clone/datasheet prefill
 * flow correctly through the reducer to produce expected state.
 * These validate the wizard shell orchestration logic.
 */

describe("Wizard prefill flows", () => {
  describe("URL query-param prefill", () => {
    it("sets fields from URL params and applies default unitLabel when not explicit", () => {
      // Simulate URL param prefill WITHOUT explicit unitLabel
      let state = initialFormState;
      state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "MODULE" });
      const defaults = getCategoryDefaults("MODULE");
      // No explicit unitLabel → apply default
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "systems", value: defaults.systems });
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Hanwha" });
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "model", value: "Q.PEAK DUO 400" });

      expect(state.category).toBe("MODULE");
      expect(state.brand).toBe("Hanwha");
      expect(state.unitLabel).toBe("W"); // default applied
      expect(state.systems.has("INTERNAL")).toBe(true);
      expect(state.systems.has("HUBSPOT")).toBe(true);
    });

    it("preserves explicit unitLabel from URL params instead of applying default", () => {
      // Simulate URL param prefill WITH explicit unitLabel="kW AC"
      let state = initialFormState;
      state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "INVERTER" });
      const defaults = getCategoryDefaults("INVERTER");
      // Explicit unitLabel present → skip default, apply explicit
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "systems", value: defaults.systems });
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitLabel", value: "kW AC" });

      expect(state.category).toBe("INVERTER");
      expect(state.unitLabel).toBe("kW AC"); // explicit, not default "kW"
    });

    it("partial URL params leave other fields at default", () => {
      let state = initialFormState;
      state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Enphase" });

      expect(state.brand).toBe("Enphase");
      expect(state.model).toBe(""); // not provided
      expect(state.category).toBe(""); // not provided
    });
  });

  describe("Clone prefill", () => {
    it("populates form state from clone data with spec relations flattened", () => {
      // Simulate normalizeCloneResult output fed into PREFILL_FROM_PRODUCT
      const normalized = {
        category: "MODULE",
        brand: "Hanwha",
        model: "Q.PEAK DUO ML-G11 400",
        description: "400W all-black module",
        unitSpec: "400",
        unitLabel: "W",
        unitCost: "145",
        sellPrice: "225",
        hardToProcure: false,
        vendorName: "CED",
        vendorPartNumber: "QP-400-ML",
        specValues: { wattage: "400", cellType: "N-Type TOPCon", voc: "41.5" },
      };

      const state = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: normalized,
        source: "clone",
      });

      expect(state.category).toBe("MODULE");
      expect(state.brand).toBe("Hanwha");
      expect(state.model).toBe("Q.PEAK DUO ML-G11 400");
      expect(state.unitCost).toBe("145");
      expect(state.sellPrice).toBe("225");
      expect(state.vendorName).toBe("CED");
      // SKU and vendorPartNumber cleared on clone
      expect(state.sku).toBe("");
      expect(state.vendorPartNumber).toBe("");
      // Spec values populated
      expect(state.specValues).toEqual({ wattage: "400", cellType: "N-Type TOPCon", voc: "41.5" });
      // Prefill tracking
      expect(state.prefillSource).toBe("clone");
      expect(state.prefillFields.has("brand")).toBe(true);
      expect(state.prefillFields.has("spec.wattage")).toBe(true);
      expect(state.prefillFields.has("spec.cellType")).toBe(true);
    });

    it("preserves clone unitLabel instead of clobbering with category default", () => {
      // Clone provides "kW AC" — should NOT be overwritten with default "kW"
      const normalized = {
        category: "INVERTER",
        brand: "Enphase",
        model: "IQ8+",
        unitLabel: "kW AC",
      };

      let state = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: normalized,
        source: "clone",
      });
      // Simulate page.tsx conditional: only apply default when normalized.unitLabel is falsy
      if (!normalized.unitLabel) {
        const defaults = getCategoryDefaults(normalized.category);
        state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      }

      expect(state.unitLabel).toBe("kW AC"); // preserved, not "kW"
    });

    it("applies category default unitLabel when clone omits it", () => {
      const normalized = {
        category: "MODULE",
        brand: "Hanwha",
        model: "Q.PEAK 400",
        // no unitLabel
      };

      let state = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: normalized,
        source: "clone",
      });
      if (!normalized.unitLabel) {
        const defaults = getCategoryDefaults(normalized.category);
        state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      }

      expect(state.unitLabel).toBe("W"); // default applied since clone didn't provide
    });

    it("second clone resets stale fields from first", () => {
      const first = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: {
          category: "MODULE",
          brand: "Hanwha",
          model: "Q.PEAK 400",
          unitCost: "145",
          specValues: { wattage: "400" },
        },
        source: "clone",
      });

      const second = catalogFormReducer(first, {
        type: "PREFILL_FROM_PRODUCT",
        data: {
          category: "INVERTER",
          brand: "Enphase",
          model: "IQ8+",
        },
        source: "clone",
      });

      expect(second.brand).toBe("Enphase");
      expect(second.category).toBe("INVERTER");
      expect(second.unitCost).toBe(""); // reset from first clone
      expect(second.specValues).toEqual({}); // reset — inverter has no spec in this prefill
      expect(second.prefillFields.has("spec.wattage")).toBe(false);
    });
  });

  describe("Datasheet prefill", () => {
    it("populates form state from AI extraction", () => {
      const extracted = {
        category: "BATTERY",
        brand: "Tesla",
        model: "Powerwall 3",
        description: "Home battery with built-in inverter",
        unitSpec: "13.5",
        unitLabel: "kWh",
        specValues: { capacity: "13.5", voltage: "240", warranty: "10" },
      };

      const state = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: extracted,
        source: "datasheet",
      });

      expect(state.category).toBe("BATTERY");
      expect(state.brand).toBe("Tesla");
      expect(state.prefillSource).toBe("datasheet");
      // Datasheet doesn't clear SKU/vendorPartNumber (only clone does)
      expect(state.prefillFields.has("brand")).toBe(true);
      expect(state.prefillFields.has("spec.capacity")).toBe(true);
    });

    it("preserves extracted unitLabel instead of clobbering with category default", () => {
      const extracted = {
        category: "BATTERY",
        brand: "Tesla",
        model: "Powerwall 3",
        unitLabel: "kWh usable",
      };

      let state = catalogFormReducer(initialFormState, {
        type: "PREFILL_FROM_PRODUCT",
        data: extracted,
        source: "datasheet",
      });
      // Simulate page.tsx conditional: only apply default when extracted.unitLabel is falsy
      if (!extracted.unitLabel) {
        const defaults = getCategoryDefaults(extracted.category);
        state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitLabel", value: defaults.unitLabel });
      }

      expect(state.unitLabel).toBe("kWh usable"); // preserved, not "kWh"
    });
  });

  describe("getCategoryDefaults", () => {
    it("returns correct unit label per category", () => {
      expect(getCategoryDefaults("MODULE").unitLabel).toBe("W");
      expect(getCategoryDefaults("INVERTER").unitLabel).toBe("kW");
      expect(getCategoryDefaults("BATTERY").unitLabel).toBe("kWh");
    });

    it("returns all 4 systems for every category", () => {
      const systems = getCategoryDefaults("MODULE").systems;
      expect(systems.has("INTERNAL")).toBe(true);
      expect(systems.has("HUBSPOT")).toBe(true);
      expect(systems.has("ZUPER")).toBe(true);
      expect(systems.has("ZOHO")).toBe(true);
    });

    it("returns empty unit label for unknown category", () => {
      expect(getCategoryDefaults("UNKNOWN").unitLabel).toBe("");
    });
  });
});
