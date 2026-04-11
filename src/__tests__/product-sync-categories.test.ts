import {
  resolveZohoCategoryName,
  resolveHubSpotCategory,
  resolveZuperCategory,
} from "@/lib/product-sync-categories";

describe("product-sync-categories", () => {
  describe("resolveZohoCategoryName", () => {
    it("maps Module to MODULE", () => {
      expect(resolveZohoCategoryName("Module")).toBe("MODULE");
    });

    it("maps Inverter to INVERTER", () => {
      expect(resolveZohoCategoryName("Inverter")).toBe("INVERTER");
    });

    it("maps Tesla to TESLA_SYSTEM_COMPONENTS", () => {
      expect(resolveZohoCategoryName("Tesla")).toBe("TESLA_SYSTEM_COMPONENTS");
    });

    it("maps all electrical sub-categories to ELECTRICAL_BOS", () => {
      const electrical = [
        "Electrical Component", "Breaker", "Wire", "PVC", "Load Center",
        "Coupling", "Nipple", "Fuse", "Locknut", "Bushing", "Strap",
        "Fastener", "Screw", "Clamp - Electrical",
      ];
      for (const cat of electrical) {
        expect(resolveZohoCategoryName(cat)).toBe("ELECTRICAL_BOS");
      }
    });

    it("maps Clamp - Solar to RACKING", () => {
      expect(resolveZohoCategoryName("Clamp - Solar")).toBe("RACKING");
    });

    it("maps Service to SERVICE", () => {
      expect(resolveZohoCategoryName("Service")).toBe("SERVICE");
    });

    it("returns 'skip' for Non-inventory", () => {
      expect(resolveZohoCategoryName("Non-inventory")).toBe("skip");
    });

    it("returns null for unresolvable categories", () => {
      expect(resolveZohoCategoryName("Solar Component")).toBeNull();
      expect(resolveZohoCategoryName("Other")).toBeNull();
      expect(resolveZohoCategoryName("H2")).toBeNull();
      expect(resolveZohoCategoryName(undefined)).toBeNull();
      expect(resolveZohoCategoryName("")).toBeNull();
    });
  });

  describe("resolveHubSpotCategory", () => {
    it("maps HubSpot product_category values to enum", () => {
      expect(resolveHubSpotCategory("Module")).toBe("MODULE");
      expect(resolveHubSpotCategory("Battery")).toBe("BATTERY");
      expect(resolveHubSpotCategory("Mounting Hardware")).toBe("RACKING");
      expect(resolveHubSpotCategory("Relay Device")).toBe("MONITORING");
    });

    it("returns null for unknown values", () => {
      expect(resolveHubSpotCategory("Unknown Category")).toBeNull();
      expect(resolveHubSpotCategory(undefined)).toBeNull();
    });
  });

  describe("resolveZuperCategory", () => {
    it("maps unambiguous Zuper category names to enum", () => {
      expect(resolveZuperCategory("Module")).toBe("MODULE");
      expect(resolveZuperCategory("Battery")).toBe("BATTERY");
      expect(resolveZuperCategory("Mounting Hardware")).toBe("RACKING");
      expect(resolveZuperCategory("Inverter")).toBe("INVERTER");
      expect(resolveZuperCategory("EV Charger")).toBe("EV_CHARGER");
      expect(resolveZuperCategory("D&R")).toBe("D_AND_R");
    });

    it("returns null for ambiguous Zuper categories (shared by multiple internal categories)", () => {
      expect(resolveZuperCategory("Electrical Hardwire")).toBeNull();
      expect(resolveZuperCategory("Relay Device")).toBeNull();
      expect(resolveZuperCategory("Service")).toBeNull();
    });

    it("returns null for unknown values", () => {
      expect(resolveZuperCategory("Weird Category")).toBeNull();
      expect(resolveZuperCategory(undefined)).toBeNull();
    });
  });
});
