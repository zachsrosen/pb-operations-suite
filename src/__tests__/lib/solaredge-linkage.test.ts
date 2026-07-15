import { extractProjNumber } from "@/lib/solaredge-linkage";

describe("extractProjNumber", () => {
  it.each([
    ["PROJ-2166 Kevin Bruer", "PROJ-2166"],
    ["PROJ-1426 Ohlberg, Gordon", "PROJ-1426"],
    ["PROJ 1230 - Rudolph 4440", "PROJ-1230"], // space form
    ["Proj-979 StorQuest Denver", "PROJ-979"], // lowercase
    ["SVC | PROJ-10030 | Polley, Stephan", "PROJ-10030"], // embedded
    ["PROJ-0221 Trailing zeros", "PROJ-221"], // strips leading zeros
  ])("extracts %s -> %s", (name, expected) => {
    expect(extractProjNumber(name)).toBe(expected);
  });

  it("returns null when there is no PROJ number", () => {
    expect(extractProjNumber("Elisabeth Ravert")).toBeNull();
    expect(extractProjNumber("Doug Dunham")).toBeNull();
    expect(extractProjNumber("")).toBeNull();
    expect(extractProjNumber(null)).toBeNull();
    expect(extractProjNumber(undefined)).toBeNull();
  });
});

import { computeSolarEdgePortalUrl, parseSolarEdgeDate } from "@/lib/solaredge";

describe("computeSolarEdgePortalUrl", () => {
  it("builds the per-site portal URL", () => {
    expect(computeSolarEdgePortalUrl(123456)).toBe(
      "https://monitoring.solaredge.com/solaredge-web/p/site/123456"
    );
  });
});

describe("parseSolarEdgeDate", () => {
  it("parses YYYY-MM-DD to ISO", () => {
    expect(parseSolarEdgeDate("2022-04-26")).toBe(new Date("2022-04-26").toISOString());
  });
  it("returns null for empty/invalid", () => {
    expect(parseSolarEdgeDate(null)).toBeNull();
    expect(parseSolarEdgeDate("")).toBeNull();
    expect(parseSolarEdgeDate("nope")).toBeNull();
  });
});
