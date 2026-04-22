// @db-required — requires prisma migrate dev to be applied before running
import { prisma } from "@/lib/db";
import {
  canEditTriageRun,
  createTriageRun,
  getTriageRun,
  updateTriageRun,
} from "@/lib/adders/triage-runs";

const USER_A = "user_a";
const USER_B = "user_b";

async function cleanup(runBy: string) {
  await prisma.triageRun.deleteMany({ where: { runBy } });
}

describe("TriageRun CRUD", () => {
  afterEach(async () => {
    await cleanup(USER_A);
    await cleanup(USER_B);
  });

  test("createTriageRun → getTriageRun round-trip", async () => {
    const run = await createTriageRun(
      { dealId: "hs_123", answers: { a1: 150 } },
      { userId: USER_A }
    );
    const fetched = await getTriageRun(run.id);
    expect(fetched?.runBy).toBe(USER_A);
    expect(fetched?.dealId).toBe("hs_123");
    expect(fetched?.answers).toEqual({ a1: 150 });
    expect(fetched?.submitted).toBe(false);
  });

  test("updateTriageRun merges partial fields", async () => {
    const run = await createTriageRun({ answers: {} }, { userId: USER_A });
    const updated = await updateTriageRun(run.id, {
      answers: { a1: 200 },
      selectedAdders: [{ code: "MPU_200A", qty: 1 }],
    });
    expect(updated.answers).toEqual({ a1: 200 });
    expect(updated.selectedAdders).toEqual([{ code: "MPU_200A", qty: 1 }]);
  });

  test("updateTriageRun rejects submitted runs", async () => {
    const run = await createTriageRun({}, { userId: USER_A });
    await prisma.triageRun.update({
      where: { id: run.id },
      data: { submitted: true, submittedAt: new Date() },
    });
    await expect(
      updateTriageRun(run.id, { notes: "too late" })
    ).rejects.toThrow(/cannot update submitted/);
  });
});

describe("canEditTriageRun", () => {
  test("owner can edit own run", () => {
    expect(canEditTriageRun({ runBy: USER_A }, USER_A, ["SALES"])).toBe(true);
  });
  test("ADMIN can edit anyone's run", () => {
    expect(canEditTriageRun({ runBy: USER_A }, USER_B, ["ADMIN"])).toBe(true);
  });
  test("OWNER can edit anyone's run", () => {
    expect(canEditTriageRun({ runBy: USER_A }, USER_B, ["OWNER"])).toBe(true);
  });
  test("other users cannot edit", () => {
    expect(canEditTriageRun({ runBy: USER_A }, USER_B, ["SALES"])).toBe(false);
  });
});
