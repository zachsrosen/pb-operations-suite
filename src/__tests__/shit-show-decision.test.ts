import { applyDecision } from "@/lib/shit-show/decision";

jest.mock("@/lib/db", () => {
  const mockUpdate = jest.fn().mockResolvedValue({});
  const mockCreate = jest.fn().mockResolvedValue({ id: "esc-row-1" });
  return {
    prisma: {
      $transaction: jest.fn(async (cb) =>
        cb({
          shitShowSessionItem: { update: mockUpdate },
          idrEscalationQueue: { create: mockCreate },
        }),
      ),
      shitShowSessionItem: { update: mockUpdate },
    },
    __mocks: { mockUpdate, mockCreate },
  };
});

jest.mock("@/lib/shit-show/hubspot-flag", () => ({
  setShitShowFlag: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/shit-show/hubspot-task", () => ({
  scheduleHubspotEscalationTask: jest.fn().mockResolvedValue(undefined),
}));

import { setShitShowFlag } from "@/lib/shit-show/hubspot-flag";
import { scheduleHubspotEscalationTask } from "@/lib/shit-show/hubspot-task";

const mockSetFlag = setShitShowFlag as jest.MockedFunction<typeof setShitShowFlag>;
const mockEscalate = scheduleHubspotEscalationTask as jest.MockedFunction<
  typeof scheduleHubspotEscalationTask
>;

const baseInput = {
  itemId: "item-1",
  dealId: "deal-1",
  userEmail: "u@x.com",
  dealName: "Test Deal",
  region: "Westy",
};

describe("applyDecision", () => {
  beforeEach(() => jest.clearAllMocks());

  it("RESOLVED clears the HubSpot flag", async () => {
    await applyDecision({ ...baseInput, decision: "RESOLVED", decisionRationale: null });
    expect(mockSetFlag).toHaveBeenCalledWith("deal-1", false);
    expect(mockEscalate).not.toHaveBeenCalled();
  });

  it("STILL_PROBLEM does NOT clear the flag", async () => {
    await applyDecision({
      ...baseInput,
      decision: "STILL_PROBLEM",
      decisionRationale: "still broken",
    });
    expect(mockSetFlag).not.toHaveBeenCalled();
    expect(mockEscalate).not.toHaveBeenCalled();
  });

  it("ESCALATED creates IdrEscalationQueue row + schedules HubSpot task; flag stays", async () => {
    await applyDecision({
      ...baseInput,
      decision: "ESCALATED",
      decisionRationale: "owner pls help",
    });
    expect(mockSetFlag).not.toHaveBeenCalled();
    expect(mockEscalate).toHaveBeenCalledWith({
      sessionItemId: "item-1",
      dealId: "deal-1",
      reason: "owner pls help",
    });
  });

  it("DEFERRED does NOT clear the flag and does not escalate", async () => {
    await applyDecision({
      ...baseInput,
      decision: "DEFERRED",
      decisionRationale: "not today",
    });
    expect(mockSetFlag).not.toHaveBeenCalled();
    expect(mockEscalate).not.toHaveBeenCalled();
  });

  it("rejects when STILL_PROBLEM has no rationale", async () => {
    await expect(
      applyDecision({
        ...baseInput,
        decision: "STILL_PROBLEM",
        decisionRationale: null,
      }),
    ).rejects.toThrow(/rationale required/i);
  });

  it("rejects when ESCALATED has whitespace-only rationale", async () => {
    await expect(
      applyDecision({
        ...baseInput,
        decision: "ESCALATED",
        decisionRationale: "   ",
      }),
    ).rejects.toThrow(/rationale required/i);
  });

  it("RESOLVED accepts null rationale (rationale is optional for resolved)", async () => {
    await applyDecision({
      ...baseInput,
      decision: "RESOLVED",
      decisionRationale: null,
    });
    expect(mockSetFlag).toHaveBeenCalled();
  });
});
