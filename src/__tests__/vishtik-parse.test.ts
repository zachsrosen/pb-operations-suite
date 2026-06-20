// src/__tests__/vishtik-parse.test.ts
import { parseProjNumber, detailUrl } from "@/lib/vishtik";

describe("parseProjNumber", () => {
  it("extracts PROJ token from standard name", () => {
    expect(parseProjNumber("PROJ-9689 | Xu, Sarah")).toBe("PROJ-9689");
  });
  it("extracts PROJ token with D&R prefix", () => {
    expect(parseProjNumber("D&R | PROJ-8455 | Pine, Tim")).toBe("PROJ-8455");
  });
  it("returns null when no PROJ token", () => {
    expect(parseProjNumber("D&R | Mongait, Peter")).toBeNull();
  });
});

describe("detailUrl", () => {
  it("builds the Vishtik detail URL", () => {
    expect(detailUrl("6947")).toBe(
      "https://project.vishtik.com/Project/Project/Project-Details?id=6947",
    );
  });
});
