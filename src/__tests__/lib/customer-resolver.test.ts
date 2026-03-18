// Mock @/lib/db to prevent Prisma import.meta from breaking Jest
jest.mock("@/lib/db", () => ({
  getCachedZuperJobsByDealIds: jest.fn().mockResolvedValue([]),
}));

import {
  normalizeAddress,
  deriveDisplayName,
  groupSearchHits,
  filterExpandedContactsByAddress,
  parseGroupKey,
  type RawSearchHit,
} from "@/lib/customer-resolver";

describe("normalizeAddress", () => {
  it("normalizes a standard address to lowercase street|zip format", () => {
    expect(normalizeAddress("123 Main St", "80202")).toBe("123 main street|80202");
  });

  it("expands common abbreviations", () => {
    expect(normalizeAddress("456 Oak Ave", "80301")).toBe("456 oak avenue|80301");
    expect(normalizeAddress("789 Pine Dr", "80401")).toBe("789 pine drive|80401");
    expect(normalizeAddress("100 Elm Blvd", "80501")).toBe("100 elm boulevard|80501");
    expect(normalizeAddress("200 Cedar Ln", "80601")).toBe("200 cedar lane|80601");
    expect(normalizeAddress("300 Birch Ct", "80701")).toBe("300 birch court|80701");
    expect(normalizeAddress("400 Maple Rd", "80801")).toBe("400 maple road|80801");
  });

  it("normalizes directionals", () => {
    expect(normalizeAddress("123 N Main St", "80202")).toBe("123 north main street|80202");
    expect(normalizeAddress("456 S Oak Ave", "80301")).toBe("456 south oak avenue|80301");
    expect(normalizeAddress("789 E Pine Dr", "80401")).toBe("789 east pine drive|80401");
    expect(normalizeAddress("100 W Elm Blvd", "80501")).toBe("100 west elm boulevard|80501");
  });

  it("strips periods and extra whitespace", () => {
    expect(normalizeAddress("123 Main St.", "80202")).toBe("123 main street|80202");
    expect(normalizeAddress("  456   Oak   Ave  ", "80301")).toBe("456 oak avenue|80301");
  });

  it("takes only first 5 digits of zip", () => {
    expect(normalizeAddress("123 Main St", "80202-1234")).toBe("123 main street|80202");
  });

  it("returns null for missing street", () => {
    expect(normalizeAddress("", "80202")).toBeNull();
    expect(normalizeAddress(null as unknown as string, "80202")).toBeNull();
  });

  it("returns null for missing zip", () => {
    expect(normalizeAddress("123 Main St", "")).toBeNull();
    expect(normalizeAddress("123 Main St", null as unknown as string)).toBeNull();
  });
});

describe("deriveDisplayName", () => {
  it("uses company name when present", () => {
    expect(deriveDisplayName("Acme Solar LLC", [], "123 Main St")).toBe("Acme Solar LLC");
  });

  it("skips generic company names", () => {
    expect(deriveDisplayName("Unknown Company", [{ lastName: "Smith" }], "123 Main St"))
      .toBe("Smith Residence");
  });

  it("skips empty company name", () => {
    expect(deriveDisplayName("", [{ lastName: "Jones" }], "456 Oak Ave"))
      .toBe("Jones Residence");
  });

  it("uses first contact's last name when no company", () => {
    expect(deriveDisplayName(null, [{ lastName: "Garcia" }, { lastName: "Lopez" }], "789 Pine Dr"))
      .toBe("Garcia Residence");
  });

  it("falls back to address when no company or last name", () => {
    expect(deriveDisplayName(null, [{ lastName: null }, { lastName: "" }], "789 Pine Dr"))
      .toBe("789 Pine Dr");
  });

  it("falls back to address when contacts array is empty", () => {
    expect(deriveDisplayName(null, [], "789 Pine Dr")).toBe("789 Pine Dr");
  });
});

describe("groupSearchHits", () => {
  it("groups contacts by company + normalized address", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: "555-1234",
      },
      {
        type: "contact",
        id: "c2",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        phone: "555-5678",
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe("company:comp1:123 main street|80202");
    expect(groups[0].contactIds).toEqual(["c1", "c2"]);
    expect(groups[0].displayName).toBe("Acme Solar");
  });

  it("separates multi-site company into distinct groups", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Big Corp",
        firstName: "Alice",
        lastName: "A",
        email: null,
        phone: null,
      },
      {
        type: "contact",
        id: "c2",
        companyId: "comp1",
        street: "456 Oak Ave",
        zip: "80301",
        companyName: "Big Corp",
        firstName: "Bob",
        lastName: "B",
        email: null,
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.groupKey).sort()).toEqual([
      "company:comp1:123 main street|80202",
      "company:comp1:456 oak avenue|80301",
    ]);
  });

  it("creates address-only group when no company", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: null,
        street: "789 Pine Dr",
        zip: "80401",
        companyName: null,
        firstName: "Charlie",
        lastName: "Brown",
        email: "charlie@example.com",
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe("addr:789 pine drive|80401");
    expect(groups[0].companyId).toBeNull();
    expect(groups[0].displayName).toBe("Brown Residence");
  });

  it("deduplicates contacts appearing in both contact and company search", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: null,
      },
      {
        type: "company",
        id: "c1",
        companyId: "comp1",
        street: "123 Main St",
        zip: "80202",
        companyName: "Acme Solar",
        firstName: "John",
        lastName: "Smith",
        email: "john@example.com",
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].contactIds).toEqual(["c1"]);
  });

  it("skips hits with no resolvable address", () => {
    const hits: RawSearchHit[] = [
      {
        type: "contact",
        id: "c1",
        companyId: "comp1",
        street: "",
        zip: "",
        companyName: "No Address Corp",
        firstName: "Dan",
        lastName: "D",
        email: null,
        phone: null,
      },
    ];

    const groups = groupSearchHits(hits);
    expect(groups).toHaveLength(0);
  });
});

describe("filterExpandedContactsByAddress", () => {
  it("keeps contacts whose address matches the group key", () => {
    const contacts = [
      { id: "c1", street: "123 Main St", zip: "80202" },
      { id: "c2", street: "456 Oak Ave", zip: "80301" },
      { id: "c3", street: "123 Main St.", zip: "80202-1234" }, // normalizes to same
    ];
    const groupNormalizedAddr = "123 main street|80202";

    const result = filterExpandedContactsByAddress(contacts, groupNormalizedAddr);
    expect(result.map(c => c.id)).toEqual(["c1", "c3"]);
  });

  it("includes contacts with no address (blank = inherit company address)", () => {
    const contacts = [
      { id: "c1", street: "123 Main St", zip: "80202" },
      { id: "c2", street: null, zip: null },           // blank address
      { id: "c3", street: "", zip: "" },                // empty string address
      { id: "c4", street: "456 Oak Ave", zip: "80301" }, // different address
    ];
    const groupNormalizedAddr = "123 main street|80202";

    const result = filterExpandedContactsByAddress(contacts, groupNormalizedAddr);
    expect(result.map(c => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("returns empty array when no contacts match", () => {
    const contacts = [
      { id: "c1", street: "999 Other Rd", zip: "90210" },
    ];
    const result = filterExpandedContactsByAddress(contacts, "123 main street|80202");
    expect(result).toEqual([]);
  });
});

describe("parseGroupKey", () => {
  it("parses a company groupKey", () => {
    const result = parseGroupKey("company:12345:123 main street|80202");
    expect(result).toEqual({
      type: "company",
      companyId: "12345",
      normalizedAddress: "123 main street|80202",
    });
  });

  it("parses an address-only groupKey", () => {
    const result = parseGroupKey("addr:123 main street|80202");
    expect(result).toEqual({
      type: "addr",
      companyId: null,
      normalizedAddress: "123 main street|80202",
    });
  });

  it("returns null for invalid groupKey", () => {
    expect(parseGroupKey("invalid")).toBeNull();
    expect(parseGroupKey("company:")).toBeNull();
    expect(parseGroupKey("addr:")).toBeNull();
    expect(parseGroupKey("company:12345:")).toBeNull();
  });
});
