import { bucketStage, topByKey } from "@/lib/production-issues-aggregations";

describe("bucketStage", () => {
  it.each([
    ["PTO'd", "pto"],
    ["PTO Received", "pto"],
    ["Permission to Operate", "pto"],
    ["Complete", "pto"],
    ["Operating", "pto"],
    ["Service Ticket Open", "service"],
    ["In Progress", "service"],
    ["Open", "service"],
    ["Site Survey", "active"],
    ["Ready to Build", "active"],
    ["Design", "active"],
    ["Permitting", "active"],
    ["Interconnection Submitted", "active"],
    ["Construction", "active"],
    ["Inspection", "active"],
    ["Install Scheduled", "active"],
    ["RTB - Blocked", "active"],
    ["Closed Lost", "other"],
    ["Some Weird Stage", "other"],
    ["", "other"],
  ])("maps %s → %s", (input, expected) => {
    expect(bucketStage(input)).toBe(expected);
  });

  it("treats null/undefined as 'other'", () => {
    expect(bucketStage(null)).toBe("other");
    expect(bucketStage(undefined)).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(bucketStage("pto")).toBe("pto");
    expect(bucketStage("PTO")).toBe("pto");
    expect(bucketStage("construction")).toBe("active");
  });
});

describe("topByKey", () => {
  const rows = [
    { owner: "Alice" },
    { owner: "Alice" },
    { owner: "Bob" },
    { owner: "Bob" },
    { owner: "Bob" },
    { owner: "" },
    { owner: undefined },
  ] as { owner?: string }[];

  it("counts and sorts descending", () => {
    const result = topByKey(rows, (r) => r.owner, 10);
    expect(result).toEqual([
      { key: "Bob", count: 3 },
      { key: "Alice", count: 2 },
      { key: "Unassigned", count: 2 },
    ]);
  });

  it("limits output length", () => {
    const result = topByKey(rows, (r) => r.owner, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: "Bob", count: 3 });
  });

  it("breaks ties by key natural order", () => {
    const tied = [{ k: "b" }, { k: "a" }, { k: "c" }];
    const result = topByKey(tied, (r) => r.k, 10);
    expect(result.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("collapses missing keys into Unassigned", () => {
    const only = [{ k: "" }, { k: null }, { k: undefined }] as { k?: string | null }[];
    const result = topByKey(only, (r) => r.k, 10);
    expect(result).toEqual([{ key: "Unassigned", count: 3 }]);
  });
});
