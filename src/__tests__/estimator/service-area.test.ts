import { resolveLocationFromZip, isInServiceArea } from "@/lib/estimator/service-area";

describe("service-area", () => {
  it("resolves DTC for central Denver (Xcel territory)", () => {
    expect(resolveLocationFromZip("80202")).toBe("DTC");
  });

  it("resolves WESTY for Westminster", () => {
    expect(resolveLocationFromZip("80031")).toBe("WESTY");
  });

  it("resolves PBLO for the Colorado Springs metro", () => {
    expect(resolveLocationFromZip("80918")).toBe("PBLO");
  });

  it("resolves PBLO for Pueblo (810 prefix)", () => {
    expect(resolveLocationFromZip("81001")).toBe("PBLO");
  });

  it("resolves PBLO for the 811 band (Alamosa — included per service-area decision)", () => {
    expect(resolveLocationFromZip("81101")).toBe("PBLO");
  });

  it("resolves CA for SLO (PG&E)", () => {
    expect(resolveLocationFromZip("93401")).toBe("CA");
  });

  it("resolves CAMARILLO for Camarillo (SCE)", () => {
    expect(resolveLocationFromZip("93010")).toBe("CAMARILLO");
  });

  it("returns null for unknown zip", () => {
    expect(resolveLocationFromZip("99999")).toBeNull();
    expect(isInServiceArea("99999")).toBe(false);
  });

  it("trims zip+4 to first 5 chars", () => {
    expect(resolveLocationFromZip("80202-1234")).toBe("DTC");
    expect(resolveLocationFromZip("  80918  ")).toBe("PBLO");
  });
});
