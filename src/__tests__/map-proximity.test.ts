// src/__tests__/map-proximity.test.ts
import { haversineMiles, nearbyMarkers, closestCrews } from "@/lib/map-proximity";
import type { JobMarker, CrewPin } from "@/lib/map-types";

const denver = { lat: 39.7392, lng: -104.9903 };
const boulder = { lat: 40.0150, lng: -105.2705 };
const coloradoSprings = { lat: 38.8339, lng: -104.8214 };

function makeMarker(id: string, lat: number, lng: number): JobMarker {
  return {
    id,
    kind: "install",
    scheduled: false,
    lat,
    lng,
    address: { street: "", city: "", state: "CO", zip: "" },
    title: id,
  };
}

function makeCrew(id: string, lat: number, lng: number): CrewPin {
  return {
    id,
    name: id,
    shopId: "dtc",
    currentLat: lat,
    currentLng: lng,
    routeStops: [],
    working: true,
  };
}

describe("haversineMiles", () => {
  it("is 0 for the same point", () => {
    expect(haversineMiles(denver, denver)).toBeCloseTo(0, 2);
  });

  it("denver → boulder is ~24–27 miles", () => {
    const d = haversineMiles(denver, boulder);
    expect(d).toBeGreaterThan(24);
    expect(d).toBeLessThan(28);
  });

  it("denver → CO springs is ~62–66 miles", () => {
    const d = haversineMiles(denver, coloradoSprings);
    expect(d).toBeGreaterThan(62);
    expect(d).toBeLessThan(66);
  });
});

describe("nearbyMarkers", () => {
  const origin = denver;
  const markers = [
    makeMarker("near-1", 39.7400, -104.9900),   // ~0.1 mi
    makeMarker("boulder", boulder.lat, boulder.lng), // ~26 mi
    makeMarker("cos", coloradoSprings.lat, coloradoSprings.lng), // ~64 mi
    makeMarker("also-near", 39.7450, -104.9800), // <1 mi
  ];

  it("respects maxMiles", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 10 });
    expect(result.map(r => r.id).sort()).toEqual(["also-near", "near-1"]);
  });

  it("respects limit", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 100, limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("near-1");
    expect(result[1].id).toBe("also-near");
  });

  it("excludes excludeId", () => {
    const result = nearbyMarkers(origin, markers, {
      maxMiles: 100,
      excludeId: "near-1",
    });
    expect(result.map(r => r.id)).not.toContain("near-1");
  });

  it("returns markers with distanceMiles attached", () => {
    const result = nearbyMarkers(origin, markers, { maxMiles: 5 });
    expect(result[0]).toHaveProperty("distanceMiles");
    expect(typeof result[0].distanceMiles).toBe("number");
  });
});

describe("closestCrews", () => {
  it("sorts by distance ascending", () => {
    const origin = denver;
    const crews = [
      makeCrew("far", coloradoSprings.lat, coloradoSprings.lng),
      makeCrew("close", 39.7400, -104.9900),
      makeCrew("mid", boulder.lat, boulder.lng),
    ];
    const result = closestCrews(origin, crews, { maxMiles: 100 });
    expect(result.map(r => r.id)).toEqual(["close", "mid", "far"]);
  });

  it("skips crews without currentLat/currentLng", () => {
    const origin = denver;
    const crews: CrewPin[] = [
      makeCrew("has-loc", 39.7400, -104.9900),
      {
        id: "no-loc",
        name: "No Loc",
        shopId: "dtc",
        routeStops: [],
        working: false,
      },
    ];
    const result = closestCrews(origin, crews, { maxMiles: 100 });
    expect(result.map(r => r.id)).toEqual(["has-loc"]);
  });
});
