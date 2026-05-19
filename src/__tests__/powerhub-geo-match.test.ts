import {
  haversineDistanceM,
  confidenceForDistance,
  findNearestProperty,
  filterByBoundingBox,
  GEO_THRESHOLDS,
} from "../lib/powerhub-geo-match";

describe("haversineDistanceM", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineDistanceM(40, -105, 40, -105)).toBe(0);
  });

  it("computes Brotherton-Tesla example (~1.16m)", () => {
    // Real verified pair from the discovery probe (2026-05-19)
    // HubSpot property: 128 Hermosa Dr, Pismo Beach
    // Tesla site:      STE20230810-00404
    const d = haversineDistanceM(
      35.1716958,
      -120.6972111, // HubSpot
      35.17170333862305,
      -120.69721984863281, // Tesla
    );
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(3);
  });

  it("scales correctly for ~100m east-west at temperate latitude", () => {
    // 1 degree of longitude at 40°N is ~85km, so 0.001 deg lng ≈ 85m
    const d = haversineDistanceM(40, -105, 40, -105 + 0.001);
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(90);
  });
});

describe("confidenceForDistance", () => {
  it("returns HIGH for ≤25m", () => {
    expect(confidenceForDistance(0)).toBe("HIGH");
    expect(confidenceForDistance(25)).toBe("HIGH");
  });

  it("returns MEDIUM for >25m and ≤50m", () => {
    expect(confidenceForDistance(25.01)).toBe("MEDIUM");
    expect(confidenceForDistance(50)).toBe("MEDIUM");
  });

  it("returns LOW for >50m and ≤100m", () => {
    expect(confidenceForDistance(50.01)).toBe("LOW");
    expect(confidenceForDistance(100)).toBe("LOW");
  });

  it("returns null beyond LOW threshold", () => {
    expect(confidenceForDistance(100.01)).toBeNull();
    expect(confidenceForDistance(1000)).toBeNull();
  });

  it("threshold constants are well-ordered", () => {
    expect(GEO_THRESHOLDS.HIGH).toBeLessThan(GEO_THRESHOLDS.MEDIUM);
    expect(GEO_THRESHOLDS.MEDIUM).toBeLessThan(GEO_THRESHOLDS.LOW);
  });
});

describe("findNearestProperty", () => {
  const candidates = [
    { id: "P-far", latitude: 40.5, longitude: -105.5 }, // ~50km away
    { id: "P-close", latitude: 40.0001, longitude: -105.0001 }, // ~14m
    { id: "P-medium", latitude: 40.0003, longitude: -105.0003 }, // ~42m
  ];

  it("picks the closest candidate when one is in HIGH range", () => {
    const result = findNearestProperty(40, -105, candidates);
    expect(result).not.toBeNull();
    expect(result!.propertyId).toBe("P-close");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.distanceM).toBeLessThan(25);
  });

  it("returns null when all candidates are beyond the LOW threshold", () => {
    const result = findNearestProperty(35, -120, candidates);
    expect(result).toBeNull();
  });

  it("returns null on empty candidate list", () => {
    expect(findNearestProperty(40, -105, [])).toBeNull();
  });

  it("falls back to MEDIUM when no HIGH candidate exists", () => {
    const onlyMedium = [
      { id: "P-medium", latitude: 40.0003, longitude: -105.0003 },
    ];
    const result = findNearestProperty(40, -105, onlyMedium);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("MEDIUM");
  });
});

describe("filterByBoundingBox", () => {
  const candidates = [
    { id: "near", latitude: 40.0005, longitude: -105.0005 },
    { id: "far-north", latitude: 40.01, longitude: -105 },
    { id: "far-east", latitude: 40, longitude: -104.99 },
    { id: "different-state", latitude: 35, longitude: -120 },
  ];

  it("narrows the candidate set to those within the bounding box", () => {
    const result = filterByBoundingBox(40, -105, candidates);
    const ids = result.map((c) => c.id).sort();
    expect(ids).toEqual(["near"]);
  });

  it("returns empty when no candidates fall in the box", () => {
    const result = filterByBoundingBox(20, -70, candidates);
    expect(result).toEqual([]);
  });

  it("accepts a custom half-extent", () => {
    // Wider half-extent should include more candidates
    const result = filterByBoundingBox(40, -105, candidates, 0.02);
    const ids = result.map((c) => c.id).sort();
    expect(ids).toContain("near");
    expect(ids).toContain("far-north");
    expect(ids).toContain("far-east");
  });
});
