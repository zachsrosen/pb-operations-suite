import { normalizeVendorName, matchVendorName } from "@/lib/vendor-normalize";

describe("normalizeVendorName", () => {
  it("lowercases", () => {
    expect(normalizeVendorName("RELL POWER")).toBe("rell power");
  });

  it("trims whitespace", () => {
    expect(normalizeVendorName("  Rell Power  ")).toBe("rell power");
  });

  it("strips Inc suffix", () => {
    expect(normalizeVendorName("SolarEdge Technologies Inc")).toBe("solaredge technologies");
  });

  it("strips LLC suffix", () => {
    expect(normalizeVendorName("BayWa r.e. LLC")).toBe("baywa r.e.");
  });

  it("strips Corp suffix", () => {
    expect(normalizeVendorName("Enphase Corp")).toBe("enphase");
  });

  it("strips Ltd suffix", () => {
    expect(normalizeVendorName("Jinko Solar Ltd")).toBe("jinko solar");
  });

  it("strips Co suffix", () => {
    expect(normalizeVendorName("Tesla Energy Co")).toBe("tesla energy");
  });

  it("strips suffix with trailing period", () => {
    expect(normalizeVendorName("SolarEdge Technologies Inc.")).toBe("solaredge technologies");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeVendorName("")).toBe("");
    expect(normalizeVendorName("  ")).toBe("");
  });
});

describe("matchVendorName", () => {
  const vendors = [
    { zohoVendorId: "v1", name: "Rell Power" },
    { zohoVendorId: "v2", name: "SolarEdge Technologies" },
    { zohoVendorId: "v3", name: "BayWa r.e." },
  ];

  it("returns exact match", () => {
    expect(matchVendorName("Rell Power", vendors)).toEqual({
      zohoVendorId: "v1",
      name: "Rell Power",
    });
  });

  it("returns normalized match (case)", () => {
    expect(matchVendorName("rell power", vendors)).toEqual({
      zohoVendorId: "v1",
      name: "Rell Power",
    });
  });

  it("returns normalized match (suffix stripped)", () => {
    expect(matchVendorName("SolarEdge Technologies Inc", vendors)).toEqual({
      zohoVendorId: "v2",
      name: "SolarEdge Technologies",
    });
  });

  it("returns null for no match", () => {
    expect(matchVendorName("Unknown Vendor", vendors)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchVendorName("", vendors)).toBeNull();
  });
});
