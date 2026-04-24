import { OFFICES, getOfficeByPbLocation, getOfficeById, officeLatLng } from "@/lib/map-offices";

describe("map-offices", () => {
  it("lists exactly the five PB shops with valid coords", () => {
    expect(OFFICES).toHaveLength(5);
    for (const o of OFFICES) {
      expect(o.id).toBeTruthy();
      expect(o.label).toBeTruthy();
      expect(o.address).toBeTruthy();
      // Continental US bounds — catches coordinate swaps / bad typos.
      expect(o.lat).toBeGreaterThan(24);
      expect(o.lat).toBeLessThan(50);
      expect(o.lng).toBeLessThan(-66);
      expect(o.lng).toBeGreaterThan(-125);
    }
  });

  it("getOfficeByPbLocation resolves canonical names", () => {
    expect(getOfficeByPbLocation("Centennial")?.id).toBe("dtc");
    expect(getOfficeByPbLocation("Westminster")?.id).toBe("westminster");
    expect(getOfficeByPbLocation("Colorado Springs")?.id).toBe("cosp");
    expect(getOfficeByPbLocation("San Luis Obispo")?.id).toBe("slo");
    expect(getOfficeByPbLocation("Camarillo")?.id).toBe("camarillo");
  });

  it("getOfficeByPbLocation is case-insensitive", () => {
    expect(getOfficeByPbLocation("westminster")?.id).toBe("westminster");
    expect(getOfficeByPbLocation("CAMARILLO")?.id).toBe("camarillo");
  });

  it("getOfficeByPbLocation accepts 'dtc' as alias for Centennial", () => {
    expect(getOfficeByPbLocation("dtc")?.id).toBe("dtc");
  });

  it("getOfficeByPbLocation returns null for unknown / empty", () => {
    expect(getOfficeByPbLocation(null)).toBeNull();
    expect(getOfficeByPbLocation(undefined)).toBeNull();
    expect(getOfficeByPbLocation("")).toBeNull();
    expect(getOfficeByPbLocation("Chicago")).toBeNull();
  });

  it("getOfficeById returns the matching office or null", () => {
    expect(getOfficeById("dtc")?.pbLocation).toBe("Centennial");
    expect(getOfficeById("slo")?.pbLocation).toBe("San Luis Obispo");
    expect(getOfficeById("nonexistent")).toBeNull();
  });

  it("officeLatLng extracts { lat, lng }", () => {
    const o = OFFICES[0];
    expect(officeLatLng(o)).toEqual({ lat: o.lat, lng: o.lng });
  });
});
