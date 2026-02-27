import {
  getCategoryFields, getCategoryLabel, getEnumFromLabel,
  getSpecTableName, getHubspotCategoryValue, getHubspotPropertiesFromMetadata, generateZuperSpecification,
  MANUFACTURERS, FORM_CATEGORIES, CATEGORY_CONFIGS,
} from "@/lib/catalog-fields";

describe("catalog-fields", () => {
  describe("getCategoryFields", () => {
    test("MODULE returns 8 fields", () => {
      expect(getCategoryFields("MODULE")).toHaveLength(8);
    });

    test("BATTERY_EXPANSION returns same fields as BATTERY", () => {
      const batteryFields = getCategoryFields("BATTERY");
      const expansionFields = getCategoryFields("BATTERY_EXPANSION");
      expect(expansionFields).toHaveLength(8);
      expect(expansionFields).toBe(batteryFields); // Same reference
    });

    test("OPTIMIZER returns empty array", () => {
      expect(getCategoryFields("OPTIMIZER")).toEqual([]);
    });

    test("unknown category returns empty array", () => {
      expect(getCategoryFields("NONEXISTENT")).toEqual([]);
    });

    test("INVERTER returns 7 fields", () => {
      expect(getCategoryFields("INVERTER")).toHaveLength(7);
    });

    test("EV_CHARGER returns 6 fields", () => {
      expect(getCategoryFields("EV_CHARGER")).toHaveLength(6);
    });

    test("RACKING returns 6 fields", () => {
      expect(getCategoryFields("RACKING")).toHaveLength(6);
    });
  });

  describe("getCategoryLabel", () => {
    test("maps legacy enums to display labels", () => {
      expect(getCategoryLabel("RACKING")).toBe("Mounting Hardware");
      expect(getCategoryLabel("ELECTRICAL_BOS")).toBe("Electrical Hardware");
      expect(getCategoryLabel("MONITORING")).toBe("Relay Device");
      expect(getCategoryLabel("RAPID_SHUTDOWN")).toBe("Rapid Shutdown");
    });

    test("maps standard enums correctly", () => {
      expect(getCategoryLabel("MODULE")).toBe("Module");
      expect(getCategoryLabel("BATTERY")).toBe("Battery");
      expect(getCategoryLabel("INVERTER")).toBe("Inverter");
    });

    test("returns input for unknown category", () => {
      expect(getCategoryLabel("UNKNOWN")).toBe("UNKNOWN");
    });
  });

  describe("getEnumFromLabel", () => {
    test("reverse-maps display labels to enum values", () => {
      expect(getEnumFromLabel("Mounting Hardware")).toBe("RACKING");
      expect(getEnumFromLabel("Electrical Hardware")).toBe("ELECTRICAL_BOS");
      expect(getEnumFromLabel("Relay Device")).toBe("MONITORING");
      expect(getEnumFromLabel("Rapid Shutdown")).toBe("RAPID_SHUTDOWN");
    });

    test("returns undefined for unknown label", () => {
      expect(getEnumFromLabel("Nonexistent")).toBeUndefined();
    });
  });

  describe("getSpecTableName", () => {
    test("returns correct spec table for categories with specs", () => {
      expect(getSpecTableName("MODULE")).toBe("moduleSpec");
      expect(getSpecTableName("INVERTER")).toBe("inverterSpec");
      expect(getSpecTableName("BATTERY")).toBe("batterySpec");
      expect(getSpecTableName("BATTERY_EXPANSION")).toBe("batterySpec");
      expect(getSpecTableName("EV_CHARGER")).toBe("evChargerSpec");
      expect(getSpecTableName("RACKING")).toBe("mountingHardwareSpec");
      expect(getSpecTableName("ELECTRICAL_BOS")).toBe("electricalHardwareSpec");
      expect(getSpecTableName("MONITORING")).toBe("relayDeviceSpec");
    });

    test("returns undefined for categories without spec tables", () => {
      expect(getSpecTableName("OPTIMIZER")).toBeUndefined();
      expect(getSpecTableName("GATEWAY")).toBeUndefined();
      expect(getSpecTableName("SERVICE")).toBeUndefined();
    });
  });

  describe("HubSpot mapping helpers", () => {
    test("getHubspotCategoryValue maps known categories", () => {
      expect(getHubspotCategoryValue("RACKING")).toBe("Mounting Hardware");
      expect(getHubspotCategoryValue("BATTERY_EXPANSION")).toBe("Battery Expansion");
    });

    test("getHubspotCategoryValue returns undefined for unknown category", () => {
      expect(getHubspotCategoryValue("UNKNOWN")).toBeUndefined();
    });

    test("getHubspotPropertiesFromMetadata maps supported hubspotProperty fields only", () => {
      const mapped = getHubspotPropertiesFromMetadata("BATTERY", {
        capacityKwh: 13.5,
        energyStorageCapacity: 13.5,
        chemistry: "LFP", // no hubspotProperty on this field, should be ignored
      });

      expect(mapped).toEqual({
        size__kwh_: 13.5,
        energy_storage_capacity: 13.5,
      });
    });

    test("getHubspotPropertiesFromMetadata ignores nullish/empty values", () => {
      const mapped = getHubspotPropertiesFromMetadata("INVERTER", {
        acOutputKw: "",
        maxDcInput: 8, // no hubspotProperty on this field
      });

      expect(mapped).toEqual({});
    });
  });

  describe("generateZuperSpecification", () => {
    test("MODULE spec", () => {
      expect(generateZuperSpecification("MODULE", { wattage: 410, cellType: "Mono PERC" })).toBe("410W Mono PERC");
    });

    test("BATTERY spec", () => {
      expect(generateZuperSpecification("BATTERY", { capacityKwh: 13.5, chemistry: "LFP" })).toBe("13.5kWh LFP");
    });

    test("BATTERY_EXPANSION spec", () => {
      expect(generateZuperSpecification("BATTERY_EXPANSION", { capacityKwh: 6.5, chemistry: "NMC" })).toBe("6.5kWh NMC");
    });

    test("INVERTER spec", () => {
      expect(generateZuperSpecification("INVERTER", { acOutputKw: 7.6, phase: "Single", inverterType: "String" })).toBe("7.6kW Single String");
    });

    test("EV_CHARGER spec", () => {
      expect(generateZuperSpecification("EV_CHARGER", { powerKw: 11.5, level: "Level 2", connectorType: "NACS" })).toBe("11.5kW Level 2 NACS");
    });

    test("unknown category returns empty string", () => {
      expect(generateZuperSpecification("UNKNOWN", { foo: "bar" })).toBe("");
    });

    test("partial data still works", () => {
      expect(generateZuperSpecification("MODULE", { wattage: 410 })).toBe("410W");
      expect(generateZuperSpecification("MODULE", {})).toBe("");
    });
  });

  describe("constants", () => {
    test("MANUFACTURERS has at least 30 entries", () => {
      expect(MANUFACTURERS.length).toBeGreaterThanOrEqual(30);
    });

    test("FORM_CATEGORIES has 16 entries", () => {
      expect(FORM_CATEGORIES).toHaveLength(16);
    });

    test("FORM_CATEGORIES includes RAPID_SHUTDOWN", () => {
      expect(FORM_CATEGORIES).toContain("RAPID_SHUTDOWN");
    });

    test("all FORM_CATEGORIES have a config entry", () => {
      for (const cat of FORM_CATEGORIES) {
        expect(CATEGORY_CONFIGS[cat]).toBeDefined();
        expect(CATEGORY_CONFIGS[cat].label).toBeTruthy();
        expect(CATEGORY_CONFIGS[cat].enumValue).toBe(cat);
      }
    });

    test("all configs with specTable reference valid relation names", () => {
      const validSpecTables = ["moduleSpec", "inverterSpec", "batterySpec", "evChargerSpec", "mountingHardwareSpec", "electricalHardwareSpec", "relayDeviceSpec"];
      for (const config of Object.values(CATEGORY_CONFIGS)) {
        if (config.specTable) {
          expect(validSpecTables).toContain(config.specTable);
        }
      }
    });
  });
});
