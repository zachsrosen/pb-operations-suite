// @db-required — requires prisma migrate dev to be applied before running
import { prisma } from "@/lib/db";
import { submitTriageRun } from "@/lib/adders/triage-submit";

jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn(),
}));

import { updateDealProperty } from "@/lib/hubspot";

const mockUpdate = updateDealProperty as jest.MockedFunction<
  typeof updateDealProperty
>;

const USER_ID = "triage_submit_user";

async function cleanup() {
  await prisma.triageRun.deleteMany({ where: { runBy: USER_ID } });
}

async function makeRun(overrides: Partial<{
  dealId: string | null;
  selectedAdders: unknown;
  photos: unknown;
}> = {}) {
  return prisma.triageRun.create({
    data: {
      runBy: USER_ID,
      dealId: overrides.dealId === undefined ? "hs_deal_1" : overrides.dealId ?? null,
      answers: {},
      recommendedAdders: [],
      selectedAdders:
        overrides.selectedAdders ?? [
          { code: "MPU_200A", name: "MPU 200A", qty: 1, unitPrice: 2500, amount: 2500 },
        ],
      photos: overrides.photos ?? [],
    },
  });
}

describe("submitTriageRun", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
  });
  afterEach(cleanup);

  test("happy path — writes deal property and marks submitted", async () => {
    mockUpdate.mockResolvedValueOnce(true);
    const run = await makeRun();

    const result = await submitTriageRun(run.id);

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      "hs_deal_1",
      expect.objectContaining({ pb_triage_adders: expect.any(String) })
    );
    const writtenJson = mockUpdate.mock.calls[0][1].pb_triage_adders as string;
    expect(JSON.parse(writtenJson)).toEqual([
      { code: "MPU_200A", name: "MPU 200A", qty: 1, unitPrice: 2500, amount: 2500 },
    ]);

    const reloaded = await prisma.triageRun.findUnique({
      where: { id: run.id },
    });
    expect(reloaded?.submitted).toBe(true);
    expect(reloaded?.submittedAt).not.toBeNull();
    expect(reloaded?.hubspotLineItemIds).toBeTruthy();
  });

  test("returns 400 when run has no dealId", async () => {
    const run = await makeRun({ dealId: null });
    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/dealId/);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("returns 400 when photosRequired adder has no matching photo", async () => {
    const run = await makeRun({
      selectedAdders: [
        {
          code: "TRENCH_LF",
          name: "Trench LF",
          qty: 10,
          unitPrice: 50,
          amount: 500,
          photosRequired: true,
        },
      ],
      photos: [],
    });
    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/TRENCH_LF/);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("accepts when photo is present for required adder (matched by code)", async () => {
    mockUpdate.mockResolvedValueOnce(true);
    const run = await makeRun({
      selectedAdders: [
        { code: "TRENCH_LF", qty: 10, unitPrice: 50, amount: 500, photosRequired: true },
      ],
      photos: [{ code: "TRENCH_LF", url: "/api/.../trench.jpg" }],
    });
    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(true);
  });

  test("returns 502 on HubSpot failure and leaves run unsubmitted", async () => {
    mockUpdate.mockResolvedValueOnce(false);
    const run = await makeRun();

    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
    }

    const reloaded = await prisma.triageRun.findUnique({
      where: { id: run.id },
    });
    expect(reloaded?.submitted).toBe(false);
    expect(reloaded?.submittedAt).toBeNull();
  });

  test("returns 400 when selectedAdders empty", async () => {
    const run = await makeRun({ selectedAdders: [] });
    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("re-submit overwrites the deal property (idempotent)", async () => {
    mockUpdate.mockResolvedValue(true);
    const run = await makeRun();
    await submitTriageRun(run.id);
    // Manually un-submit to simulate re-submit allowance (in practice, run
    // would be reopened via a separate flow). We just verify the DB update
    // happens each call.
    await prisma.triageRun.update({
      where: { id: run.id },
      data: { submitted: false, submittedAt: null },
    });
    const result = await submitTriageRun(run.id);
    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });
});
