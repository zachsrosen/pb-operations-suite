jest.mock("@/lib/db", () => ({
  prisma: { systemConfig: { findUnique: jest.fn(), upsert: jest.fn() } },
}));

import { getUserDmSpaces, recordUserDmSpace } from "@/lib/tech-ops-bot-proactive";

const { prisma } = jest.requireMock("@/lib/db") as {
  prisma: { systemConfig: { findUnique: jest.Mock; upsert: jest.Mock } };
};

beforeEach(() => jest.clearAllMocks());

describe("user DM space map", () => {
  it("merges new entries into the map, lowercasing emails", async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify({ "existing@photonbrothers.com": "spaces/aaa" }),
    });
    await recordUserDmSpace("Peter.Zaun@photonbrothers.com", "spaces/bbb");
    const upsert = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(upsert.where.key).toBe("techops_bot_user_dm_spaces");
    expect(JSON.parse(upsert.update.value)).toEqual({
      "existing@photonbrothers.com": "spaces/aaa",
      "peter.zaun@photonbrothers.com": "spaces/bbb",
    });
  });

  it("skips the write when the space is already recorded", async () => {
    prisma.systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify({ "peter.zaun@photonbrothers.com": "spaces/bbb" }),
    });
    await recordUserDmSpace("peter.zaun@photonbrothers.com", "spaces/bbb");
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns {} on missing or corrupt config", async () => {
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    expect(await getUserDmSpaces()).toEqual({});
    prisma.systemConfig.findUnique.mockResolvedValue({ value: "not-json" });
    expect(await getUserDmSpaces()).toEqual({});
  });
});
