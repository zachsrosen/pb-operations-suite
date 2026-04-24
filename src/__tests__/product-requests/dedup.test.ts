import { findEquipmentDuplicate, findAdderDuplicate } from "@/lib/product-requests/dedup";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: { findFirst: jest.fn() },
    pendingCatalogPush: { findFirst: jest.fn() },
    adder: { findFirst: jest.fn() },
    adderRequest: { findFirst: jest.fn() },
  },
}));

type MockedPrisma = {
  internalProduct: { findFirst: jest.Mock };
  pendingCatalogPush: { findFirst: jest.Mock };
  adder: { findFirst: jest.Mock };
  adderRequest: { findFirst: jest.Mock };
};
const p = prisma as unknown as MockedPrisma;

describe("findEquipmentDuplicate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no matches exist", async () => {
    p.internalProduct.findFirst.mockResolvedValue(null);
    p.pendingCatalogPush.findFirst.mockResolvedValue(null);
    expect(await findEquipmentDuplicate("REC", "Alpha 400")).toBeNull();
  });

  it("detects InternalProduct hit first", async () => {
    p.internalProduct.findFirst.mockResolvedValue({ id: "ip_1" });
    expect(await findEquipmentDuplicate("REC", "Alpha 400")).toEqual({
      source: "INTERNAL_PRODUCT",
      id: "ip_1",
    });
    expect(p.pendingCatalogPush.findFirst).not.toHaveBeenCalled();
  });

  it("falls through to pending push", async () => {
    p.internalProduct.findFirst.mockResolvedValue(null);
    p.pendingCatalogPush.findFirst.mockResolvedValue({ id: "pp_1" });
    expect(await findEquipmentDuplicate("REC", "Alpha 400")).toEqual({
      source: "PENDING_PUSH",
      id: "pp_1",
    });
  });

  it("normalizes case + whitespace", async () => {
    p.internalProduct.findFirst.mockResolvedValue({ id: "ip_1" });
    await findEquipmentDuplicate("  REC  ", "ALPHA 400");
    expect(p.internalProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brand: { equals: "rec", mode: "insensitive" },
          model: { equals: "alpha 400", mode: "insensitive" },
        }),
      }),
    );
  });
});

describe("findAdderDuplicate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no matches exist", async () => {
    p.adder.findFirst.mockResolvedValue(null);
    p.adderRequest.findFirst.mockResolvedValue(null);
    expect(await findAdderDuplicate("MPU 200A")).toBeNull();
  });

  it("detects existing Adder", async () => {
    p.adder.findFirst.mockResolvedValue({ id: "a_1" });
    expect(await findAdderDuplicate("MPU 200A")).toEqual({
      source: "ADDER",
      id: "a_1",
    });
  });

  it("falls through to pending AdderRequest", async () => {
    p.adder.findFirst.mockResolvedValue(null);
    p.adderRequest.findFirst.mockResolvedValue({ id: "ar_1" });
    expect(await findAdderDuplicate("MPU 200A")).toEqual({
      source: "ADDER_REQUEST",
      id: "ar_1",
    });
  });
});
