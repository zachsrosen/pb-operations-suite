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

  it("passes an Xcel IA number through unchanged", () => {
    // Chatter notification emails cite ONLY this id (IA160801), never the
    // case number, so it must survive extraction to reach the Gmail query.
    expect(extractIdentifierTokens("IA214386")).toEqual(["IA214386"]);
    expect(extractIdentifierTokens("IA160801")).toEqual(["IA160801"]);
  });

  it("keeps every token of a clean list whole (dual-application projects)", () => {
    // A project with separate PV + ESS Xcel applications stores both IA
    // numbers in one field. Each must keep its IA prefix — Gmail's
    // "213490" phrase does not match "IA213490" in an email body.
    expect(extractIdentifierTokens("IA213490, IA216791")).toEqual([
      "IA213490",
      "IA216791",
    ]);
    expect(extractIdentifierTokens("IA213490,IA216791")).toEqual([
      "IA213490",
      "IA216791",
    ]);
    expect(extractIdentifierTokens("SBP-179859 SBP-179860")).toEqual([
      "SBP-179859",
      "SBP-179860",
    ]);
  });

  it("strips a trailing comma from a single value", () => {
    expect(extractIdentifierTokens("06405260,")).toEqual(["06405260"]);
  });
});
