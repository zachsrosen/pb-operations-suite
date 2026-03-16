import { normalizeModelAlias } from "@/lib/model-alias";

describe("normalizeModelAlias", () => {
  // ── Edge cases ──

  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeModelAlias(null)).toBe("");
    expect(normalizeModelAlias(undefined)).toBe("");
    expect(normalizeModelAlias("")).toBe("");
    expect(normalizeModelAlias("  ")).toBe("");
  });

  it("trims whitespace from input", () => {
    expect(normalizeModelAlias("  SE7600H  ")).toBe("SE7600H");
  });

  // ── SolarEdge inverter extended ordering codes ──

  it("strips SE7600H-US → SE7600H", () => {
    expect(normalizeModelAlias("SE7600H-US")).toBe("SE7600H");
  });

  it("strips SE7600H-US000BNU4 → SE7600H", () => {
    expect(normalizeModelAlias("SE7600H-US000BNU4")).toBe("SE7600H");
  });

  it("strips SE10000H-USNNR2 → SE10000H", () => {
    expect(normalizeModelAlias("SE10000H-USNNR2")).toBe("SE10000H");
  });

  it("strips SE11400H-US000BEU4 → SE11400H", () => {
    expect(normalizeModelAlias("SE11400H-US000BEU4")).toBe("SE11400H");
  });

  it("strips SE3800H-US → SE3800H", () => {
    expect(normalizeModelAlias("SE3800H-US")).toBe("SE3800H");
  });

  it("leaves bare SE7600H unchanged", () => {
    expect(normalizeModelAlias("SE7600H")).toBe("SE7600H");
  });

  // ── SolarEdge optimizer connector/mounting suffixes ──

  it("strips P505-5R-M4M → P505", () => {
    expect(normalizeModelAlias("P505-5R-M4M")).toBe("P505");
  });

  it("strips S440-1GM4MRX → S440", () => {
    expect(normalizeModelAlias("S440-1GM4MRX")).toBe("S440");
  });

  it("strips S500B-1GM4MRX → S500B (keeps bifacial B)", () => {
    expect(normalizeModelAlias("S500B-1GM4MRX")).toBe("S500B");
  });

  it("strips P601-5RLLMRX → P601", () => {
    expect(normalizeModelAlias("P601-5RLLMRX")).toBe("P601");
  });

  it("leaves bare S440 unchanged", () => {
    expect(normalizeModelAlias("S440")).toBe("S440");
  });

  it("leaves bare P505 unchanged", () => {
    expect(normalizeModelAlias("P505")).toBe("P505");
  });

  // ── Trailing market suffix stripping ──

  it("strips IQ8A-72-M-US → IQ8A-72-M", () => {
    expect(normalizeModelAlias("IQ8A-72-M-US")).toBe("IQ8A-72-M");
  });

  it("strips IQ8PLUS-72-2-US → IQ8PLUS-72-2", () => {
    expect(normalizeModelAlias("IQ8PLUS-72-2-US")).toBe("IQ8PLUS-72-2");
  });

  it("strips SB7.7-1SP-US-41 → SB7.7-1SP", () => {
    expect(normalizeModelAlias("SB7.7-1SP-US-41")).toBe("SB7.7-1SP");
  });

  it("strips AGT-R1V1-US → AGT-R1V1", () => {
    expect(normalizeModelAlias("AGT-R1V1-US")).toBe("AGT-R1V1");
  });

  it("strips -EU suffix", () => {
    expect(normalizeModelAlias("SB7.7-1SP-EU")).toBe("SB7.7-1SP");
  });

  it("strips -AU suffix", () => {
    expect(normalizeModelAlias("SB7.7-1SP-AU")).toBe("SB7.7-1SP");
  });

  // ── Should NOT strip ──

  it("leaves Tesla part numbers unchanged (1707000-21-K)", () => {
    expect(normalizeModelAlias("1707000-21-K")).toBe("1707000-21-K");
  });

  it("leaves IronRidge rail models unchanged (XR-10-168M)", () => {
    expect(normalizeModelAlias("XR-10-168M")).toBe("XR-10-168M");
  });

  it("leaves Jinko panel models unchanged (JKM430N-54HL4-B)", () => {
    expect(normalizeModelAlias("JKM430N-54HL4-B")).toBe("JKM430N-54HL4-B");
  });

  it("leaves Canadian Solar models unchanged (CS6.2-48TM-445H)", () => {
    expect(normalizeModelAlias("CS6.2-48TM-445H")).toBe("CS6.2-48TM-445H");
  });

  it("leaves Trina models unchanged (TSM-NEG19RC.20)", () => {
    expect(normalizeModelAlias("TSM-NEG19RC.20")).toBe("TSM-NEG19RC.20");
  });

  it("leaves LONGi models unchanged (LR5-54HGD-430M)", () => {
    expect(normalizeModelAlias("LR5-54HGD-430M")).toBe("LR5-54HGD-430M");
  });

  it("leaves GE breaker models unchanged (THQL2160)", () => {
    expect(normalizeModelAlias("THQL2160")).toBe("THQL2160");
  });

  it("leaves Eaton disconnect models unchanged (DG222URB)", () => {
    expect(normalizeModelAlias("DG222URB")).toBe("DG222URB");
  });

  it("leaves IMO RSD models unchanged (SI16-PEL64R-2)", () => {
    expect(normalizeModelAlias("SI16-PEL64R-2")).toBe("SI16-PEL64R-2");
  });

  it("leaves Sol-Ark models unchanged (Sol-Ark 15K-2P-N)", () => {
    // -N is not a recognized market suffix
    expect(normalizeModelAlias("Sol-Ark 15K-2P-N")).toBe("Sol-Ark 15K-2P-N");
  });

  it("leaves short models unchanged (MCI-2)", () => {
    expect(normalizeModelAlias("MCI-2")).toBe("MCI-2");
  });

  it("leaves REC models unchanged (REC430AA)", () => {
    expect(normalizeModelAlias("REC430AA")).toBe("REC430AA");
  });

  it("leaves UFO clamp models unchanged (UFO-CL-01-A1)", () => {
    expect(normalizeModelAlias("UFO-CL-01-A1")).toBe("UFO-CL-01-A1");
  });
});
