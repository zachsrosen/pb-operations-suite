import { runBackfill } from "../../scripts/backfill-shit-show-flags";

jest.mock("@/lib/db", () => ({
  prisma: {
    idrMeetingItem: { findMany: jest.fn() },
    shitShowBackfillRun: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));
jest.mock("@/lib/shit-show/hubspot-flag", () => ({
  setShitShowFlag: jest.fn(),
}));

import { prisma } from "@/lib/db";
import { setShitShowFlag } from "@/lib/shit-show/hubspot-flag";

const mockFindMany = prisma.idrMeetingItem.findMany as jest.Mock;
const mockCreate = prisma.shitShowBackfillRun.create as jest.Mock;
const mockUpdate = prisma.shitShowBackfillRun.update as jest.Mock;
const mockFindFirst = prisma.shitShowBackfillRun.findFirst as jest.Mock;
const mockSetFlag = setShitShowFlag as jest.MockedFunction<typeof setShitShowFlag>;

describe("backfill shit-show flags", () => {
  beforeEach(() => jest.clearAllMocks());

  it("dedupes flagged items by dealId, picks latest non-null reason", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "run-1" });
    mockFindMany.mockResolvedValue([
      // sorted by updatedAt desc by the query — first occurrence per dealId wins
      { dealId: "d1", shitShowReason: "newer reason", updatedAt: new Date("2026-04-15") },
      { dealId: "d2", shitShowReason: null, updatedAt: new Date("2026-04-10") },
      { dealId: "d1", shitShowReason: "old reason", updatedAt: new Date("2026-04-01") },
    ]);
    mockSetFlag.mockResolvedValue();

    await runBackfill();

    expect(mockSetFlag).toHaveBeenCalledTimes(2);
    expect(mockSetFlag).toHaveBeenCalledWith("d1", true, "newer reason");
    expect(mockSetFlag).toHaveBeenCalledWith("d2", true, "");
  });

  it("resumes from existing RUNNING row instead of creating a new one", async () => {
    mockFindFirst.mockResolvedValue({ id: "run-prev", processed: 5 });
    mockFindMany.mockResolvedValue([]);

    await runBackfill();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-prev" } }),
    );
  });

  it("records errors per failed deal without aborting the run", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "run-1" });
    mockFindMany.mockResolvedValue([
      { dealId: "d1", shitShowReason: "r1", updatedAt: new Date() },
      { dealId: "d2", shitShowReason: "r2", updatedAt: new Date() },
    ]);
    mockSetFlag
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("HubSpot 500"));

    await runBackfill();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processed: 1,
          errors: 1,
          status: "COMPLETED",
        }),
      }),
    );
  });
});
