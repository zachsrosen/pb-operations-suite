/**
 * Tests for bom-po-create.ts — vendor grouping, merging, reference number.
 */

const mockFindItemIdByName = jest.fn();
const mockCreatePurchaseOrder = jest.fn();

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    isConfigured: () => true,
    findItemIdByName: (...args: unknown[]) => mockFindItemIdByName(...args),
    createPurchaseOrder: (...args: unknown[]) => mockCreatePurchaseOrder(...args),
  },
}));

jest.mock("@/lib/bom-search-terms", () => ({
  buildBomSearchTerms: (input: { brand?: string | null; model?: string | null; description?: string | null }) => {
    const name = input.model
      ? input.brand ? `${input.brand} ${input.model}` : input.model
      : input.description;
    return name ? [name] : [];
  },
}));

const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
  logActivity: jest.fn(async () => {}),
}));

import {
  buildReferenceNumber,
  mergeUnassignedIntoVendor,
  resolvePoVendorGroups,
  type BomData,
  type PoGroupingResult,
} from "@/lib/bom-po-create";

function makeBomData(items: BomData["items"]) {
  return {
    project: { address: "123 Solar St" },
    items,
  } satisfies BomData;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolvePoVendorGroups", () => {
  it("groups items by vendor_id from Zoho match", async () => {
    mockFindItemIdByName
      .mockResolvedValueOnce({
        item_id: "z1", zohoName: "QCell 400W", zohoSku: "QC-400",
        vendor_id: "v-qcell", vendor_name: "QCells",
      })
      .mockResolvedValueOnce({
        item_id: "z2", zohoName: "Enphase IQ8+", zohoSku: "EN-IQ8",
        vendor_id: "v-enphase", vendor_name: "Enphase",
      })
      .mockResolvedValueOnce({
        item_id: "z3", zohoName: "QCell 500W", zohoSku: "QC-500",
        vendor_id: "v-qcell", vendor_name: "QCells",
      });

    const result: PoGroupingResult = await resolvePoVendorGroups(makeBomData([
      { category: "MODULE", brand: "QCell", model: "Q.PEAK-400", description: "400W module", qty: 32 },
      { category: "INVERTER", brand: "Enphase", model: "IQ8+", description: "Microinverter", qty: 32 },
      { category: "MODULE", brand: "QCell", model: "Q.PEAK-500", description: "500W module", qty: 10 },
    ]));

    expect(result.vendorGroups).toHaveLength(2);
    expect(result.vendorGroups.find((group) => group.vendorId === "v-qcell")?.items).toHaveLength(2);
    expect(result.vendorGroups.find((group) => group.vendorId === "v-enphase")?.items).toHaveLength(1);
    expect(result.unassignedItems).toHaveLength(0);
  });

  it("puts items with no Zoho match into unassigned with reason 'no_zoho_match'", async () => {
    mockFindItemIdByName.mockResolvedValue(null);

    const result = await resolvePoVendorGroups(makeBomData([
      { category: "MODULE", brand: "Unknown", model: "XYZ-999", description: "Mystery panel", qty: 10 },
    ]));

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].reason).toBe("no_zoho_match");
  });

  it("puts items matched but with no vendor into unassigned with reason 'no_vendor'", async () => {
    mockFindItemIdByName.mockResolvedValue({
      item_id: "z1",
      zohoName: "Generic Wire",
      zohoSku: "GW-1",
      vendor_id: undefined,
      vendor_name: undefined,
    });

    const result = await resolvePoVendorGroups(makeBomData([
      { category: "ELECTRICAL_BOS", brand: null, model: null, description: "Generic Wire", qty: 5 },
    ]));

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].reason).toBe("no_vendor");
    expect(result.unassignedItems[0].zohoItemId).toBe("z1");
  });

  it("skips items with zero or negative quantity", async () => {
    const result = await resolvePoVendorGroups(makeBomData([
      { category: "MODULE", brand: "A", model: "B", description: "C", qty: 0 },
      { category: "MODULE", brand: "A", model: "D", description: "E", qty: -5 },
    ]));

    expect(result.vendorGroups).toHaveLength(0);
    expect(result.unassignedItems).toHaveLength(0);
    expect(mockFindItemIdByName).not.toHaveBeenCalled();
  });
});

describe("mergeUnassignedIntoVendor", () => {
  it("merges items with zohoItemId into an existing vendor group", () => {
    const input: PoGroupingResult = {
      vendorGroups: [
        {
          vendorId: "v1",
          vendorName: "Vendor 1",
          items: [
            { bomName: "Panel", zohoName: "Panel", zohoItemId: "z1", quantity: 10, description: "Solar panel" },
          ],
        },
      ],
      unassignedItems: [
        { name: "Wire", quantity: 5, description: "Wire", zohoItemId: "z2", zohoName: "Wire", reason: "no_vendor" },
      ],
    };

    const result = mergeUnassignedIntoVendor(input, "v1", "Vendor 1");

    expect(result.vendorGroups).toHaveLength(1);
    expect(result.vendorGroups[0].items).toHaveLength(2);
    expect(result.unassignedItems).toHaveLength(0);
    expect(input.vendorGroups[0].items).toHaveLength(1);
  });

  it("creates a new vendor group when vendorId is not in existing groups", () => {
    const input: PoGroupingResult = {
      vendorGroups: [
        {
          vendorId: "v1",
          vendorName: "Vendor 1",
          items: [
            { bomName: "Panel", zohoName: "Panel", zohoItemId: "z1", quantity: 10, description: "Solar panel" },
          ],
        },
      ],
      unassignedItems: [
        { name: "Wire", quantity: 5, description: "Wire", zohoItemId: "z2", zohoName: "Wire", reason: "no_vendor" },
        { name: "Mystery", quantity: 1, description: "Mystery", reason: "no_zoho_match" },
      ],
    };

    const result = mergeUnassignedIntoVendor(input, "v-new", "New Vendor");

    expect(result.vendorGroups).toHaveLength(2);
    expect(result.vendorGroups.find((group) => group.vendorId === "v-new")?.items).toHaveLength(1);
    expect(result.unassignedItems).toHaveLength(1);
    expect(result.unassignedItems[0].name).toBe("Mystery");
  });
});

describe("buildReferenceNumber", () => {
  it("extracts PROJ-{id} from full deal name and builds reference", () => {
    const result = buildReferenceNumber("PROJ-1234 Smith - 123 Solar St", 2, "QCells");
    expect(result).toBe("PROJ-1234 V2 — QCells");
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("truncates vendor name with ellipsis when too long", () => {
    const result = buildReferenceNumber("PROJ-7832 Very Long Deal Name Here", 1, "SunPower Solar Equipment Wholesale Distribution Inc");
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toMatch(/^PROJ-7832 V1 — /);
    expect(result).toMatch(/…$/);
  });

  it("falls back to first 20 chars of dealName when no PROJ- match", () => {
    const result = buildReferenceNumber("Custom Deal Name Without Project ID", 1, "QCells");
    expect(result).toMatch(/^Custom Deal Name Wit/);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("preserves D&R pipeline prefix before PROJ-XXXX", () => {
    const result = buildReferenceNumber("D&R | PROJ-5736 | Goltz, James | 123 Main St, CO", 2, "QCells");
    expect(result).toBe("D&R | PROJ-5736 V2 — QCells");
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("preserves SVC pipeline prefix before PROJ-XXXX", () => {
    const result = buildReferenceNumber("SVC | PROJ-8964 | McElheron | 456 Oak Ave", 1, "Tesla");
    expect(result).toBe("SVC | PROJ-8964 V1 — Tesla");
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
