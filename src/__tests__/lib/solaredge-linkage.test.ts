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
