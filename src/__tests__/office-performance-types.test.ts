import { LOCATION_SLUG_TO_CANONICAL, CANONICAL_TO_LOCATION_SLUG, CANONICAL_LOCATIONS } from "@/lib/locations";

describe("Office Performance Location Slugs", () => {
  it("maps all 5 slugs to canonical locations", () => {
    expect(Object.keys(LOCATION_SLUG_TO_CANONICAL)).toHaveLength(5);
    expect(LOCATION_SLUG_TO_CANONICAL["westminster"]).toBe("Westminster");
    expect(LOCATION_SLUG_TO_CANONICAL["centennial"]).toBe("Centennial");
    expect(LOCATION_SLUG_TO_CANONICAL["colorado-springs"]).toBe("Colorado Springs");
    expect(LOCATION_SLUG_TO_CANONICAL["san-luis-obispo"]).toBe("San Luis Obispo");
    expect(LOCATION_SLUG_TO_CANONICAL["camarillo"]).toBe("Camarillo");
  });

  it("maps all canonical locations back to slugs", () => {
    expect(Object.keys(CANONICAL_TO_LOCATION_SLUG)).toHaveLength(5);
    expect(CANONICAL_TO_LOCATION_SLUG["Westminster"]).toBe("westminster");
    expect(CANONICAL_TO_LOCATION_SLUG["Colorado Springs"]).toBe("colorado-springs");
  });

  it("covers every canonical location", () => {
    for (const loc of CANONICAL_LOCATIONS) {
      expect(CANONICAL_TO_LOCATION_SLUG[loc]).toBeDefined();
    }
  });

  it("round-trips slug → canonical → slug", () => {
    for (const [slug, canonical] of Object.entries(LOCATION_SLUG_TO_CANONICAL)) {
      expect(CANONICAL_TO_LOCATION_SLUG[canonical as keyof typeof CANONICAL_TO_LOCATION_SLUG]).toBe(slug);
    }
  });
});
