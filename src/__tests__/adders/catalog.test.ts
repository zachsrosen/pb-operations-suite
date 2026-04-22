// @db-required — requires prisma migrate dev to be applied before running
import { prisma } from "@/lib/db";
import {
  createAdder,
  updateAdder,
  retireAdder,
  listAdders,
  getAdderById,
  listRevisions,
} from "@/lib/adders/catalog";
import type { CreateAdderInput } from "@/lib/adders/zod-schemas";

const SAMPLE: CreateAdderInput = {
  code: "TEST_MPU",
  name: "Test MPU",
  category: "ELECTRICAL",
  type: "FIXED",
  direction: "ADD",
  autoApply: false,
  photosRequired: false,
  unit: "FLAT",
  basePrice: 500,
  baseCost: 300,
};

async function cleanup(code: string) {
  await prisma.adder.deleteMany({ where: { code } });
}

describe("catalog CRUD", () => {
  afterEach(async () => {
    await cleanup("TEST_MPU");
    await cleanup("TEST_MPU2");
  });

  test("createAdder inserts row and writes initial revision", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    expect(a.code).toBe("TEST_MPU");
    expect(a.createdBy).toBe("user-1");
    const revs = await listRevisions(a.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].changeNote).toMatch(/created/i);
  });

  test("createAdder rejects duplicate code", async () => {
    await createAdder(SAMPLE, { userId: "user-1" });
    await expect(createAdder(SAMPLE, { userId: "user-2" })).rejects.toThrow(/unique/i);
  });

  test("updateAdder writes revision with snapshot of prior state", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const updated = await updateAdder(
      a.id,
      { basePrice: 600, changeNote: "price increase" },
      { userId: "user-2" }
    );
    expect(Number(updated.basePrice)).toBe(600);
    const revs = await listRevisions(a.id);
    expect(revs).toHaveLength(2);
    const snapshot = revs[1].snapshot as Record<string, unknown>;
    expect(snapshot.basePrice).toBe("500"); // prior value captured
  });

  test("retireAdder flips active to false and writes revision", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const retired = await retireAdder(a.id, { userId: "user-1", reason: "obsolete" });
    expect(retired.active).toBe(false);
    const revs = await listRevisions(a.id);
    expect(revs.some((r) => (r.changeNote ?? "").match(/retired|obsolete/i))).toBe(true);
  });

  test("listAdders filters by category and active", async () => {
    await createAdder(SAMPLE, { userId: "user-1" });
    await createAdder({ ...SAMPLE, code: "TEST_MPU2", category: "ROOFING" }, { userId: "user-1" });
    const electrical = await listAdders({ category: "ELECTRICAL" });
    expect(electrical.map((x) => x.code)).toContain("TEST_MPU");
    expect(electrical.map((x) => x.code)).not.toContain("TEST_MPU2");
  });

  test("getAdderById returns adder with overrides eager-loaded", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    const fetched = await getAdderById(a.id);
    expect(fetched?.overrides).toEqual([]);
  });

  test("updateAdder replaces shop overrides transactionally when overrides provided", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    // First update — add two overrides
    await updateAdder(
      a.id,
      {
        overrides: [
          { shop: "DTC", priceDelta: 50, active: true },
          { shop: "SLO", priceDelta: 75, active: true },
        ],
      },
      { userId: "user-1" }
    );
    let fetched = await getAdderById(a.id);
    expect(fetched?.overrides).toHaveLength(2);
    expect(fetched?.overrides.map((o) => o.shop).sort()).toEqual(["DTC", "SLO"]);

    // Second update — replace with single override
    await updateAdder(
      a.id,
      {
        overrides: [{ shop: "Camarillo", priceDelta: 100, active: true }],
      },
      { userId: "user-1" }
    );
    fetched = await getAdderById(a.id);
    expect(fetched?.overrides).toHaveLength(1);
    expect(fetched?.overrides[0].shop).toBe("Camarillo");
  });

  test("updateAdder rejects override with invalid shop", async () => {
    const a = await createAdder(SAMPLE, { userId: "user-1" });
    await expect(
      updateAdder(
        a.id,
        { overrides: [{ shop: "Denver", priceDelta: 10, active: true }] },
        { userId: "user-1" }
      )
    ).rejects.toThrow(/invalid shop/i);
  });
});
