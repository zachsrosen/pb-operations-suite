import { buildBomSearchTerms } from "@/lib/bom-search-terms";

describe("buildBomSearchTerms", () => {
  // ── Basic term ordering ──

  it("returns model → brand+model → description", () => {
    const terms = buildBomSearchTerms({
      brand: "SolarEdge",
      model: "SE7600H",
      description: "7.6kW Inverter",
    });
    expect(terms).toEqual([
      "SE7600H",
      "SolarEdge SE7600H",
      "7.6kW Inverter",
    ]);
  });

  it("uses description as name when model is missing", () => {
    const terms = buildBomSearchTerms({
      brand: "Enphase",
      model: null,
      description: "IQ8 Microinverter",
    });
    // model is null → name falls back to description, so: [null, description, description]
    // after filtering: just description (deduplicated by content but not by reference)
    expect(terms[0]).toBe("IQ8 Microinverter");
  });

  it("omits brand prefix when brand is null", () => {
    const terms = buildBomSearchTerms({
      brand: null,
      model: "SE7600H",
      description: "Inverter",
    });
    // model present, brand null → name = model → [model, model, description]
    expect(terms).toContain("SE7600H");
    expect(terms).toContain("Inverter");
    expect(terms).not.toContain("null SE7600H");
  });

  // ── Normalized alias fallback ──

  it("adds suffix-stripped alias for SolarEdge extended code", () => {
    const terms = buildBomSearchTerms({
      brand: "SolarEdge",
      model: "SE7600H-US000BNU4",
      description: "7.6kW Inverter",
    });
    expect(terms).toContain("SE7600H-US000BNU4");
    expect(terms).toContain("SolarEdge SE7600H-US000BNU4");
    expect(terms).toContain("SE7600H"); // normalized alias
    expect(terms).toContain("SolarEdge SE7600H"); // brand + alias
    expect(terms).toContain("7.6kW Inverter");
  });

  it("adds suffix-stripped alias for market suffix", () => {
    const terms = buildBomSearchTerms({
      brand: "Enphase",
      model: "IQ8A-72-M-US",
      description: "Microinverter",
    });
    expect(terms).toContain("IQ8A-72-M"); // normalized alias
    expect(terms).toContain("Enphase IQ8A-72-M"); // brand + alias
  });

  it("does not add alias when model is unchanged", () => {
    const terms = buildBomSearchTerms({
      brand: "Jinko",
      model: "JKM430N-54HL4-B",
      description: "430W Panel",
    });
    // normalizeModelAlias leaves this unchanged, so no alias terms
    expect(terms).toEqual([
      "JKM430N-54HL4-B",
      "Jinko JKM430N-54HL4-B",
      "430W Panel",
    ]);
  });

  // ── Edge cases ──

  it("filters out short/empty terms", () => {
    const terms = buildBomSearchTerms({
      brand: "X",
      model: null,
      description: "A",
    });
    // "A" is length 1, filtered out; brand-only fallback "X" also length 1
    expect(terms).toEqual([]);
  });

  it("returns empty array when all inputs are null", () => {
    const terms = buildBomSearchTerms({
      brand: null,
      model: null,
      description: null,
    });
    expect(terms).toEqual([]);
  });

  it("handles alias without brand gracefully", () => {
    const terms = buildBomSearchTerms({
      brand: null,
      model: "SE7600H-US",
      description: "Inverter",
    });
    expect(terms).toContain("SE7600H"); // alias still added
    expect(terms).not.toContain("null SE7600H");
  });
});
