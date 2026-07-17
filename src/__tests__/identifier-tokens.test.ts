import { extractIdentifierTokens } from "@/lib/gmail-shared-inbox";

/**
 * The identifier fields are hand-entered. PROJ-9810's utility_application__
 * was "06405260 (PSPS) J STEPHEN POLLOCK" — quoted whole, it matched zero
 * emails; the bare number matched 7 (verified live 2026-07-17). These pin
 * the extraction so pollution can't silently kill correspondence matching.
 */
describe("extractIdentifierTokens", () => {
  it("passes a clean single token through unchanged (alphanumeric kept)", () => {
    expect(extractIdentifierTokens("SBP-179859")).toEqual(["SBP-179859"]);
    expect(extractIdentifierTokens("B2404681")).toEqual(["B2404681"]);
    expect(extractIdentifierTokens("06405260")).toEqual(["06405260"]);
  });

  it("extracts the app number from the PROJ-9810 polluted value", () => {
    expect(
      extractIdentifierTokens("06405260 (PSPS) J STEPHEN POLLOCK"),
    ).toEqual(["06405260"]);
  });

  it("does not extract short digit runs (street numbers, dates)", () => {
    // "1091" (street number) and "2026" must not become search identifiers.
    expect(extractIdentifierTokens("app for 1091 S Foothill, filed 2026")).toEqual([]);
  });

  it("dedupes and handles multiple long runs", () => {
    expect(
      extractIdentifierTokens("06405260 old ref 06405260 alt 12345678"),
    ).toEqual(["06405260", "12345678"]);
  });

  it("returns empty for blank/null", () => {
    expect(extractIdentifierTokens(null)).toEqual([]);
    expect(extractIdentifierTokens("  ")).toEqual([]);
  });
});
