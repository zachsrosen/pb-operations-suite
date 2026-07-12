const mockJobFindMany = jest.fn();
const mockDealFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    zuperJobCache: { findMany: (...a: unknown[]) => mockJobFindMany(...a) },
    deal: { findMany: (...a: unknown[]) => mockDealFindMany(...a) },
  },
}));

import { earliestInstallAvailability } from "@/lib/install-availability";

function job(
  dealId: string,
  category: string,
  start: string,
  end: string
) {
  return {
    hubspotDealId: dealId,
    jobCategory: category,
    scheduledStart: new Date(`${start}T14:00:00Z`),
    scheduledEnd: new Date(`${end}T22:00:00Z`),
  };
}

describe("earliestInstallAvailability", () => {
  beforeEach(() => {
    mockJobFindMany.mockReset();
    mockDealFindMany.mockReset();
  });

  it("returns the first business day under capacity per location", async () => {
    // Colorado Springs capacity = 1/day. Mon 7/13 + Tue 7/14 are occupied,
    // so the first open business day from Monday 2026-07-13 is Wed 2026-07-15.
    mockJobFindMany.mockResolvedValue([
      job("d1", "Construction - Solar", "2026-07-13", "2026-07-14"),
    ]);
    mockDealFindMany.mockResolvedValue([
      { hubspotDealId: "d1", pbLocation: "Colorado Springs" },
    ]);

    const result = await earliestInstallAvailability(
      ["Colorado Springs", "Westminster"],
      { today: "2026-07-12" } // Sunday → walk starts Monday 7/13
    );

    expect(result.get("Colorado Springs")).toBe("2026-07-15");
    // Westminster (capacity 2) has nothing scheduled → first business day.
    expect(result.get("Westminster")).toBe("2026-07-13");
  });

  it("counts split PV+ESS jobs on the same deal as ONE install", async () => {
    // Same deal has separate Solar and Battery Zuper tasks on the same days —
    // Westminster capacity is 2, so one deal occupying Mon leaves Mon open.
    mockJobFindMany.mockResolvedValue([
      job("d1", "Construction - Solar", "2026-07-13", "2026-07-13"),
      job("d1", "Construction - Battery", "2026-07-13", "2026-07-13"),
    ]);
    mockDealFindMany.mockResolvedValue([
      { hubspotDealId: "d1", pbLocation: "Westminster" },
    ]);

    const result = await earliestInstallAvailability(["Westminster"], {
      today: "2026-07-12",
    });
    expect(result.get("Westminster")).toBe("2026-07-13");
  });

  it("returns null availability on lookup failure instead of throwing", async () => {
    mockJobFindMany.mockRejectedValue(new Error("db down"));
    const result = await earliestInstallAvailability(["Westminster"], {
      today: "2026-07-12",
    });
    expect(result.get("Westminster")).toBeNull();
  });
});
