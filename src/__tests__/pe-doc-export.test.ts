import { parseDealName, cleanPeNote, rowsToCsv, rowsToText, type PeExportRow } from "@/lib/pe-doc-export";

const row = (over: Partial<PeExportRow> = {}): PeExportRow => ({
  proj: "PROJ-9495", deal: "PROJ-9495 | Hylsky, Kenneth | 700 Cheyenne Dr, Fort Collins, CO",
  location: "DTC", stage: "PTO", team: "Accounting", doc: "Conditional Progress Lien Waiver",
  status: "Action Required", reason: "", hubspotUrl: "https://app.hubspot.com/contacts/1/deal/9",
  portalUrl: "https://raceway.participate.energy/projects/abc", driveUrl: "", ...over,
});

describe("parseDealName", () => {
  it("splits PROJ + name", () => {
    expect(parseDealName("PROJ-9495 | Hylsky, Kenneth | 700 Cheyenne Dr")).toEqual({ proj: "PROJ-9495", name: "Hylsky, Kenneth" });
  });
  it("handles names with no PROJ/address", () => {
    expect(parseDealName("Acme Co")).toEqual({ proj: "", name: "Acme Co" });
  });
});

describe("cleanPeNote", () => {
  it("keeps the H-code reason", () => {
    expect(cleanPeNote("Synced from PE API (CO2601) | v2 | milestone: Inspection Complete | [H123] INCOR-LIEN-SALESTAX: IC includes sales tax.")).toBe("[H123] INCOR-LIEN-SALESTAX: IC includes sales tax.");
  });
  it("returns empty for a bare sync line (no reviewer text)", () => {
    expect(cleanPeNote("Synced from PE API (CO2601) | v2 | milestone: Inspection Complete")).toBe("");
  });
  it("returns empty for null/responded-only", () => {
    expect(cleanPeNote(null)).toBe("");
    expect(cleanPeNote("Synced from PE portal scraper (PROJ-1) | Responded: 2026-05-28T18:41:33Z")).toBe("");
  });
  it("returns empty for the NOT_REQUIRED/status stub (no 'milestone:' colon) — was leaking 'not uploaded'", () => {
    expect(cleanPeNote("Synced from PE API (CA2601-DIEP1) | not uploaded | milestone")).toBe("");
    expect(cleanPeNote("Synced from PE API (CO2603-SMIT21) | approved | milestone")).toBe("");
  });
});

describe("rowsToCsv", () => {
  it("emits a header + CRLF rows and escapes commas/quotes", () => {
    const csv = rowsToCsv([row({ reason: 'has, comma and "quote"' })]);
    const [head, line] = csv.split("\r\n");
    expect(head.startsWith("Project,Deal,Location")).toBe(true);
    expect(line).toContain('"has, comma and ""quote"""');
  });
  it("empty rows -> header only", () => {
    expect(rowsToCsv([]).split("\r\n")).toHaveLength(1);
  });
});

describe("rowsToText", () => {
  it("groups by deal with docs and links, counts deals", () => {
    const txt = rowsToText([
      row({ doc: "Conditional Progress Lien Waiver", reason: "[H123] sales tax" }),
      row({ doc: "Conditional Waiver — Final Payment" }),
    ], "PE — Accounting");
    expect(txt).toContain("PE — Accounting (1 deal)");
    expect(txt).toContain("• Hylsky, Kenneth (PROJ-9495) — PTO · DTC");
    expect(txt).toContain("- Conditional Progress Lien Waiver: Action Required — [H123] sales tax");
    expect(txt).toContain("- Conditional Waiver — Final Payment: Action Required");
    expect(txt).toContain("HubSpot: https://app.hubspot.com/contacts/1/deal/9");
  });
  it("counts distinct deals", () => {
    const txt = rowsToText([row(), row({ deal: "PROJ-2 | Smith, Jo | x", proj: "PROJ-2" })], "T");
    expect(txt).toContain("T (2 deals)");
  });
});
