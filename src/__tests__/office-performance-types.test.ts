import { LOCATION_SLUG_TO_CANONICAL, CANONICAL_TO_LOCATION_SLUG, CANONICAL_LOCATIONS } from "@/lib/locations";

describe("Office Performance Location Slugs", () => {
  it("maps all slugs (5 primary + legacy colorado-springs alias) to canonical locations", () => {
    expect(Object.keys(LOCATION_SLUG_TO_CANONICAL)).toHaveLength(6);
    expect(LOCATION_SLUG_TO_CANONICAL["westminster"]).toBe("Westminster");
    expect(LOCATION_SLUG_TO_CANONICAL["centennial"]).toBe("Centennial");
    expect(LOCATION_SLUG_TO_CANONICAL["pueblo"]).toBe("Pueblo");
    // Legacy slug kept so old bookmarks/URLs keep resolving.
    expect(LOCATION_SLUG_TO_CANONICAL["colorado-springs"]).toBe("Pueblo");
    expect(LOCATION_SLUG_TO_CANONICAL["san-luis-obispo"]).toBe("San Luis Obispo");
    expect(LOCATION_SLUG_TO_CANONICAL["camarillo"]).toBe("Camarillo");
  });

  it("maps all canonical locations back to slugs", () => {
    expect(Object.keys(CANONICAL_TO_LOCATION_SLUG)).toHaveLength(5);
    expect(CANONICAL_TO_LOCATION_SLUG["Westminster"]).toBe("westminster");
    expect(CANONICAL_TO_LOCATION_SLUG["Pueblo"]).toBe("pueblo");
  });

  it("covers every canonical location", () => {
    for (const loc of CANONICAL_LOCATIONS) {
      expect(CANONICAL_TO_LOCATION_SLUG[loc]).toBeDefined();
    }
  });

  it("round-trips canonical → slug → canonical", () => {
    for (const [canonical, slug] of Object.entries(CANONICAL_TO_LOCATION_SLUG)) {
      expect(LOCATION_SLUG_TO_CANONICAL[slug]).toBe(canonical);
    }
  });
});
