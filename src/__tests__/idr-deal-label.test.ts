import { describe, it, expect } from "@jest/globals";
import { parseDealLabel } from "@/app/dashboards/idr-meeting/deal-label";

describe("parseDealLabel", () => {
  it("parses the Project-pipeline format", () => {
    expect(parseDealLabel("PROJ-1234 | Smith, John | 123 Main St")).toEqual({
      projNum: "PROJ-1234",
      fullName: "John Smith",
    });
  });

  it("parses the Service/D&R format with a leading pipeline tag", () => {
    expect(parseDealLabel("SVC | PROJ-3956 | Farrell, William | 5008 Eagan Cir, Longmont, CO 80503")).toEqual({
      projNum: "PROJ-3956",
      fullName: "William Farrell",
    });
  });

  it("keeps a plain first-last name as-is", () => {
    expect(parseDealLabel("PROJ-42 | Jane Doe")).toEqual({
      projNum: "PROJ-42",
      fullName: "Jane Doe",
    });
  });

  it("handles a Service label whose name has no comma", () => {
    expect(parseDealLabel("SVC | PROJ-77 | Acme Roofing LLC | 9 Elm")).toEqual({
      projNum: "PROJ-77",
      fullName: "Acme Roofing LLC",
    });
  });

  it("uses the leading segment for non-standard deals with no PROJ number", () => {
    // Real one-off/Test-pipeline format: customer leads, address follows.
    // Must not render the address as the customer name.
    expect(parseDealLabel("Barnett, Ted | 1731 S Welch Cir, Lakewood, CO 80228")).toEqual({
      projNum: null,
      fullName: "Ted Barnett",
    });
  });

  it("falls back when there is no PROJ number", () => {
    expect(parseDealLabel("Walk-in Customer | Somebody, Else")).toEqual({
      projNum: null,
      fullName: "Else Somebody",
    });
  });

  it("does not crash on a bare name", () => {
    expect(parseDealLabel("Just A Name")).toEqual({
      projNum: null,
      fullName: "Just A Name",
    });
  });
});
