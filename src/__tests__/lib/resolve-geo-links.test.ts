import { resolvePbLocationFromAddress } from "@/lib/locations";

describe("resolvePbLocationFromAddress", () => {
  it("maps Boulder (80301) to Westminster", () => {
    expect(resolvePbLocationFromAddress("80301", "CO")).toBe("Westminster");
  });
  it("maps Colorado Springs zip to Colorado Springs", () => {
    expect(resolvePbLocationFromAddress("80903", "CO")).toBe("Colorado Springs");
  });
  it("maps a Centennial zip to Centennial", () => {
    expect(resolvePbLocationFromAddress("80112", "CO")).toBe("Centennial");
  });
  it("maps Camarillo zips to Camarillo", () => {
    expect(resolvePbLocationFromAddress("93010", "CA")).toBe("Camarillo");
  });
  it("maps SLO zips to San Luis Obispo", () => {
    expect(resolvePbLocationFromAddress("93401", "CA")).toBe("San Luis Obispo");
  });
  it("returns null for unknown zip+state", () => {
    expect(resolvePbLocationFromAddress("10001", "NY")).toBeNull();
  });
});
