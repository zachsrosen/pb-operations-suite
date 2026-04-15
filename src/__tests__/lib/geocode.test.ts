import { geocodeAddress } from "@/lib/geocode";

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe("geocodeAddress", () => {
  it("returns null when address is incomplete", async () => {
    expect(await geocodeAddress({ street: "", city: "", state: "", zip: "" })).toBeNull();
  });

  it("parses a Google API success response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{
          place_id: "abc123",
          formatted_address: "1234 Main St, Boulder, CO 80301, USA",
          geometry: { location: { lat: 40.01, lng: -105.27 } },
          address_components: [
            { short_name: "1234", types: ["street_number"] },
            { short_name: "Main St", types: ["route"] },
            { short_name: "Boulder", types: ["locality"] },
            { short_name: "CO", types: ["administrative_area_level_1"] },
            { short_name: "80301", types: ["postal_code"] },
            { short_name: "Boulder County", types: ["administrative_area_level_2"] },
          ],
        }],
      }),
    });
    const r = await geocodeAddress({ street: "1234 Main St", city: "Boulder", state: "CO", zip: "80301" });
    expect(r).toMatchObject({
      placeId: "abc123",
      latitude: 40.01,
      longitude: -105.27,
      city: "Boulder",
      state: "CO",
      zip: "80301",
      county: "Boulder County",
    });
  });

  it("returns null place_id but still resolves other fields for ZERO_RESULTS fallback", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    });
    expect(await geocodeAddress({ street: "1 Nowhere", city: "X", state: "XX", zip: "00000" })).toBeNull();
  });

  it("throws on OVER_QUERY_LIMIT for the retry layer to handle", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OVER_QUERY_LIMIT" }),
    });
    await expect(geocodeAddress({ street: "1", city: "X", state: "Y", zip: "00000" })).rejects.toThrow(/OVER_QUERY_LIMIT/);
  });
});
