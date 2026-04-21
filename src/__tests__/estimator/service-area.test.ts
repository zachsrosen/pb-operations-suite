import { resolveLocationFromZip, isInServiceArea } from "@/lib/estimator/service-area";

describe("service-area", () => {
  it("resolves DTC for a central Denver zip", () => {
    expect(resolveLocationFromZip("80202")).toBe("DTC");
  });

  it("resolves WESTY for a Westminster zip", () => {
    expect(resolveLocationFromZip("80031")).toBe("WESTY");
  });

  it("resolves COSP for a Colorado Springs zip", () => {
    expect(resolveLocationFromZip("80920")).toBe("COSP");
  });

  it("resolves CA for an SF zip", () => {
    expect(resolveLocationFromZip("94110")).toBe("CA");
  });

  it("resolves CAMARILLO for a Ventura County zip", () => {
    expect(resolveLocationFromZip("93010")).toBe("CAMARILLO");
  });

  it("returns null for an unknown zip", () => {
    expect(resolveLocationFromZip("99999")).toBeNull();
  });

  it("trims and truncates to first 5 chars (zip+4 tolerated)", () => {
    expect(resolveLocationFromZip("80202-1234")).toBe("DTC");
    expect(resolveLocationFromZip("  80202  ")).toBe("DTC");
  });

  it("isInServiceArea returns boolean", () => {
    expect(isInServiceArea("80202")).toBe(true);
    expect(isInServiceArea("99999")).toBe(false);
  });
});
