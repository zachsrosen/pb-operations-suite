// addrKey + matchProjectToDeal are pure; mock the Prisma client so importing
// the module (which transitively pulls @/lib/db) doesn't break jest parsing.
jest.mock("@/lib/db", () => ({ prisma: null }));

import { addrKey, matchProjectToDeal, type ParsedProject } from "@/lib/pe-scraper-sync";

const proj = (over: Partial<ParsedProject>): ParsedProject => ({
  customerName: "",
  projNumber: "",
  stage: "",
  m1Status: null,
  m2Status: null,
  epcCost: null,
  documents: [],
  ...over,
});

describe("addrKey", () => {
  it("normalizes street + zip into a stable key", () => {
    expect(addrKey("1762 Dusty Boot Dr.", "80026")).toBe("addr:1762 dusty boot dr|80026");
    // punctuation/case/whitespace are normalized to the same key
    expect(addrKey("1762  DUSTY  boot   dr", "80026-1234")).toBe("addr:1762 dusty boot dr|80026");
  });

  it("returns null without a numbered street or a 5-digit zip", () => {
    expect(addrKey("Dusty Boot Dr", "80026")).toBeNull(); // no leading number
    expect(addrKey("1762 Dusty Boot Dr", "800")).toBeNull(); // short zip
    expect(addrKey("", "80026")).toBeNull();
    expect(addrKey("1762 Dusty Boot Dr", null)).toBeNull();
  });
});

describe("matchProjectToDeal — address strategy", () => {
  it("matches by site address even when the customer name differs (co-owner)", () => {
    // Deal is named "Fritch" but the portal customer is "Lyons" — name match
    // would fail / mis-match, address resolves it correctly.
    const dealMap = new Map<string, string>([
      ["proj-8999 | fritch, jeanne | 1710 utah st, golden, co 80401", "8999"],
      ["addr:1710 utah st|80401", "8999"],
    ]);
    const p = proj({ customerName: "Ella Lyons", projNumber: "CO2601-LYON2", street: "1710 Utah St", zip: "80401" });
    expect(matchProjectToDeal(p, dealMap)).toBe("8999");
  });

  it("address beats a coincidental name collision", () => {
    const dealMap = new Map<string, string>([
      ["proj-1 | smith, bob | 5 elm st 11111", "WRONG"], // name 'smith' would collide
      ["addr:99 oak ave|22222", "RIGHT"],
    ]);
    const p = proj({ customerName: "Jane Smith", projNumber: "CO2602-SMIT1", street: "99 Oak Ave", zip: "22222" });
    expect(matchProjectToDeal(p, dealMap)).toBe("RIGHT");
  });

  it("falls back to name match when there's no address key", () => {
    const dealMap = new Map<string, string>([["proj-5 | jones, amy | 1 a st 30303", "5"]]);
    const p = proj({ customerName: "Amy Jones", projNumber: "PROJ-5" });
    expect(matchProjectToDeal(p, dealMap)).toBe("5");
  });
});
