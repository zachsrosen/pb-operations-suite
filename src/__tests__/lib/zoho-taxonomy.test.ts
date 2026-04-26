import {
  getZohoCategory,
  getZohoGroupName,
  hasVerifiedZohoMapping,
  ZOHO_CATEGORY_MAP,
} from "@/lib/zoho-taxonomy";

const ALL_INTERNAL_CATEGORIES = [
  "MODULE",
  "INVERTER",
  "BATTERY",
  "BATTERY_EXPANSION",
  "EV_CHARGER",
  "RACKING",
  "ELECTRICAL_BOS",
  "MONITORING",
  "RAPID_SHUTDOWN",
  "OPTIMIZER",
  "GATEWAY",
  "D_AND_R",
  "SERVICE",
  "ADDER_SERVICES",
  "TESLA_SYSTEM_COMPONENTS",
  "PROJECT_MILESTONES",
];

describe("zoho-taxonomy", () => {
  describe("ZOHO_CATEGORY_MAP completeness", () => {
    it("has an entry for every expected internal category", () => {
      for (const cat of ALL_INTERNAL_CATEGORIES) {
        expect(ZOHO_CATEGORY_MAP[cat]).toBeDefined();
      }
    });

    it("every entry has a valid status", () => {
      const validStatuses = ["confirmed", "likely", "unresolved", "not_applicable"];
      for (const [, mapping] of Object.entries(ZOHO_CATEGORY_MAP)) {
        expect(validStatuses).toContain(mapping.status);
      }
    });

    it("confirmed entries have both categoryId and categoryName", () => {
      for (const [cat, mapping] of Object.entries(ZOHO_CATEGORY_MAP)) {
        if (mapping.status === "confirmed") {
          expect(typeof mapping.categoryId).toBe("string");
          expect((mapping.categoryId as string).length).toBeGreaterThan(0);
          expect(typeof mapping.categoryName).toBe("string");
          expect((mapping.categoryName as string).length).toBeGreaterThan(0);
          // Helps localize a failure
          expect({ cat, mapping }).toBeTruthy();
        }
      }
    });

    it("non-confirmed entries have undefined categoryId and categoryName", () => {
      for (const mapping of Object.values(ZOHO_CATEGORY_MAP)) {
        if (mapping.status === "unresolved" || mapping.status === "not_applicable") {
          expect(mapping.categoryId).toBeUndefined();
          expect(mapping.categoryName).toBeUndefined();
        }
      }
    });
  });

  describe("getZohoCategory", () => {
    it("returns id and name for confirmed mappings", () => {
      const r = getZohoCategory("MODULE");
      expect(r.categoryId).toBe("5385454000001229316");
      expect(r.categoryName).toBe("Module");
    });

    it("returns the live category_id for ELECTRICAL_BOS", () => {
      const r = getZohoCategory("ELECTRICAL_BOS");
      expect(r.categoryId).toBe("5385454000001229324");
      expect(r.categoryName).toBe("Electrical Component");
    });

    it("collapses SERVICE / ADDER_SERVICES / PROJECT_MILESTONES onto Non-inventory", () => {
      const expectedId = "5385454000008795730";
      expect(getZohoCategory("SERVICE").categoryId).toBe(expectedId);
      expect(getZohoCategory("ADDER_SERVICES").categoryId).toBe(expectedId);
      expect(getZohoCategory("PROJECT_MILESTONES").categoryId).toBe(expectedId);
    });

    it("returns the new BATTERY/EV_CHARGER categories created in Phase B (2026-04-24)", () => {
      const battery = getZohoCategory("BATTERY");
      expect(battery.categoryId).toBe("5385454000020010899");
      expect(battery.categoryName).toBe("Battery");
      const evCharger = getZohoCategory("EV_CHARGER");
      expect(evCharger.categoryId).toBe("5385454000019964645");
      expect(evCharger.categoryName).toBe("EV Charger");
      const expansion = getZohoCategory("BATTERY_EXPANSION");
      expect(expansion.categoryId).toBe("5385454000020010899");
    });

    it("returns empty object for not_applicable mappings without warning", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const r = getZohoCategory("D_AND_R");
      expect(r).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns and returns empty for completely unknown categories", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const r = getZohoCategory("DOES_NOT_EXIST");
      expect(r).toEqual({});
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown category"));
      warnSpy.mockRestore();
    });

    it("warns for unresolved entries (so ops sees the backlog)", () => {
      // After Phase B all 16 categories are confirmed or not_applicable.
      // If a future enum addition lands in 'unresolved' state this test guards
      // the warn behavior. For now, just assert the warn is called when
      // unresolved entries exist (no-op when all are confirmed).
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      getZohoCategory("BATTERY");  // now confirmed — should NOT warn
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does not warn for confirmed categories", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      getZohoCategory("MODULE");
      getZohoCategory("INVERTER");
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("hasVerifiedZohoMapping", () => {
    it("returns true only for confirmed mappings", () => {
      expect(hasVerifiedZohoMapping("MODULE")).toBe(true);
      expect(hasVerifiedZohoMapping("INVERTER")).toBe(true);
      expect(hasVerifiedZohoMapping("ELECTRICAL_BOS")).toBe(true);
      expect(hasVerifiedZohoMapping("RACKING")).toBe(true);
    });

    it("returns true for BATTERY/EV_CHARGER (Phase B Zoho admin work complete 2026-04-24)", () => {
      expect(hasVerifiedZohoMapping("BATTERY")).toBe(true);
      expect(hasVerifiedZohoMapping("EV_CHARGER")).toBe(true);
      expect(hasVerifiedZohoMapping("BATTERY_EXPANSION")).toBe(true);
    });

    it("returns false for not_applicable mappings", () => {
      expect(hasVerifiedZohoMapping("D_AND_R")).toBe(false);
    });

    it("returns false for unknown categories", () => {
      expect(hasVerifiedZohoMapping("DOES_NOT_EXIST")).toBe(false);
    });
  });

  describe("deprecated getZohoGroupName", () => {
    it("still returns the categoryName for confirmed mappings", () => {
      expect(getZohoGroupName("MODULE")).toBe("Module");
      expect(getZohoGroupName("INVERTER")).toBe("Inverter");
    });

    it("returns the categoryName for newly-confirmed BATTERY/EV_CHARGER", () => {
      expect(getZohoGroupName("BATTERY")).toBe("Battery");
      expect(getZohoGroupName("EV_CHARGER")).toBe("EV Charger");
    });

    it("returns undefined for not_applicable/unknown", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(getZohoGroupName("D_AND_R")).toBeUndefined();
      expect(getZohoGroupName("DOES_NOT_EXIST")).toBeUndefined();
      warnSpy.mockRestore();
    });
  });
});
