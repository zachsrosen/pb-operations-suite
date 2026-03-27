import {
  trimDealName,
  getStatusDisplayName,
  sortDealRows,
} from "@/lib/daily-focus/format";

describe("trimDealName", () => {
  test("strips address from standard project deal", () => {
    expect(trimDealName("PROJ-9502 | McCammon, ROY | 4743 Mosca Pl, CO 81019"))
      .toBe("PROJ-9502 | McCammon, ROY");
  });

  test("keeps 3 segments for D&R deals", () => {
    expect(trimDealName("D&R | PROJ-5736 | Goltz, James | 123 Main St, CO"))
      .toBe("D&R | PROJ-5736 | Goltz, James");
  });

  test("keeps 3 segments for SVC deals", () => {
    expect(trimDealName("SVC | PROJ-8964 | McElheron | 456 Oak Ave"))
      .toBe("SVC | PROJ-8964 | McElheron");
  });

  test("returns full name when fewer segments", () => {
    expect(trimDealName("PROJ-1234 | Smith")).toBe("PROJ-1234 | Smith");
  });
});

describe("getStatusDisplayName", () => {
  test("maps permit display names", () => {
    expect(getStatusDisplayName("Returned from Design", "permitting_status"))
      .toBe("Revision Ready To Resubmit");
  });

  test("maps IC display names", () => {
    expect(getStatusDisplayName("Signature Acquired By Customer", "interconnection_status"))
      .toBe("Ready To Submit");
  });

  test("maps PTO display names", () => {
    expect(getStatusDisplayName("Inspection Passed - Ready for Utility", "pto_status"))
      .toBe("Inspection Passed - Ready for PTO Submission");
  });

  test("maps DA layout_status 'Ready'", () => {
    expect(getStatusDisplayName("Ready", "layout_status"))
      .toBe("Review In Progress");
  });

  test("maps design_status 'DA Approved'", () => {
    expect(getStatusDisplayName("DA Approved", "design_status"))
      .toBe("Final Design Review");
  });

  test("passes through unmapped statuses", () => {
    expect(getStatusDisplayName("Some New Status", "permitting_status"))
      .toBe("Some New Status");
  });
});

describe("sortDealRows", () => {
  test("sorts by PROJ number ascending", () => {
    const rows = [
      { dealname: "PROJ-200 | B" },
      { dealname: "PROJ-50 | A" },
      { dealname: "PROJ-1000 | C" },
    ];
    const sorted = sortDealRows(rows);
    expect(sorted.map(r => r.dealname)).toEqual([
      "PROJ-50 | A",
      "PROJ-200 | B",
      "PROJ-1000 | C",
    ]);
  });

  test("non-PROJ deals sort alphabetically after PROJ deals", () => {
    const rows = [
      { dealname: "Zebra Corp" },
      { dealname: "PROJ-100 | Smith" },
      { dealname: "Alpha LLC" },
    ];
    const sorted = sortDealRows(rows);
    expect(sorted.map(r => r.dealname)).toEqual([
      "PROJ-100 | Smith",
      "Alpha LLC",
      "Zebra Corp",
    ]);
  });
});
