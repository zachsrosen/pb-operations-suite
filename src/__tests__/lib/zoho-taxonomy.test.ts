import { getZohoGroupName, hasVerifiedZohoMapping, ZOHO_CATEGORY_MAP } from "@/lib/zoho-taxonomy";

describe("zoho-taxonomy", () => {
  describe("getZohoGroupName", () => {
    it("returns exact Zoho name for confirmed categories", () => {
      expect(getZohoGroupName("MODULE")).toBe("Module");
      expect(getZohoGroupName("INVERTER")).toBe("Inverter");
    });

    it("returns exact Zoho name for likely categories", () => {
      expect(getZohoGroupName("TESLA_SYSTEM_COMPONENTS")).toBe("Tesla");
      expect(getZohoGroupName("ELECTRICAL_BOS")).toBe("Electrical Component");
      expect(getZohoGroupName("RAPID_SHUTDOWN")).toBe("Electrical Component");
    });

    it("returns undefined for unresolved categories", () => {
      const unresolvedCategories = [
        "BATTERY",
        "BATTERY_EXPANSION",
        "EV_CHARGER",
        "OPTIMIZER",
        "MONITORING",
        "GATEWAY",
        "RACKING",
        "D_AND_R",
        "SERVICE",
        "ADDER_SERVICES",
        "PROJECT_MILESTONES",
      ];

      for (const cat of unresolvedCategories) {
        expect(getZohoGroupName(cat)).toBeUndefined();
      }
    });

    it("returns undefined and warns for completely unknown categories", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(getZohoGroupName("DOES_NOT_EXIST")).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown category")
      );
      warnSpy.mockRestore();
    });

    it("logs a warning for unresolved categories", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      getZohoGroupName("BATTERY");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("unresolved")
      );
      warnSpy.mockRestore();
    });

    it("does not log a warning for confirmed/likely categories", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      getZohoGroupName("MODULE");
      getZohoGroupName("INVERTER");
      getZohoGroupName("TESLA_SYSTEM_COMPONENTS");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("hasVerifiedZohoMapping", () => {
    it("returns true for confirmed and likely categories", () => {
      expect(hasVerifiedZohoMapping("MODULE")).toBe(true);
      expect(hasVerifiedZohoMapping("INVERTER")).toBe(true);
      expect(hasVerifiedZohoMapping("ELECTRICAL_BOS")).toBe(true);
    });

    it("returns false for unresolved categories", () => {
      expect(hasVerifiedZohoMapping("BATTERY")).toBe(false);
      expect(hasVerifiedZohoMapping("SERVICE")).toBe(false);
    });

    it("returns false for unknown categories", () => {
      expect(hasVerifiedZohoMapping("DOES_NOT_EXIST")).toBe(false);
    });
  });

  describe("ZOHO_CATEGORY_MAP completeness", () => {
    it("has an entry for every expected internal category", () => {
      const expectedCategories = [
        "MODULE", "INVERTER", "BATTERY", "BATTERY_EXPANSION",
        "EV_CHARGER", "RACKING", "ELECTRICAL_BOS", "MONITORING",
        "RAPID_SHUTDOWN", "OPTIMIZER", "GATEWAY", "D_AND_R",
        "SERVICE", "ADDER_SERVICES", "TESLA_SYSTEM_COMPONENTS",
        "PROJECT_MILESTONES",
      ];

      for (const cat of expectedCategories) {
        expect(ZOHO_CATEGORY_MAP).toHaveProperty(cat);
      }
    });

    it("every entry has a valid status", () => {
      const validStatuses = ["confirmed", "likely", "unresolved"];
      for (const [key, mapping] of Object.entries(ZOHO_CATEGORY_MAP)) {
        expect(validStatuses).toContain(mapping.status);
        // unresolved entries must have undefined groupName
        if (mapping.status === "unresolved") {
          expect(mapping.groupName).toBeUndefined();
        }
        // confirmed/likely entries must have a non-empty groupName
        if (mapping.status === "confirmed" || mapping.status === "likely") {
          expect(typeof mapping.groupName).toBe("string");
          expect((mapping.groupName as string).length).toBeGreaterThan(0);
        }
      }
    });
  });
});
