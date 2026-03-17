import { normalizeAddress, deriveDisplayName } from "@/lib/customer-resolver";

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
