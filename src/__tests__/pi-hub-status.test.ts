/**
 * setStatus contract: validate against ACTIVE options → PATCH → note +
 * activity log. The PATCH is THE write — failures before/at it throw;
 * failures after it only warn (design decision 2026-07-17: status-update
 * only, no task completion).
 */

jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: { deals: { basicApi: { update: jest.fn() } } },
  },
}));
// Faithful pass-through of the real contract: { ok: true, data } on success,
// { ok: false, error: "label: msg" } on throw — no retries/sleeps in tests.
jest.mock("@/lib/bulk-sync-confirmation", () => ({
  withHubSpotRetry: jest.fn(async (fn: () => Promise<unknown>, label: string) => {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      return {
        ok: false,
        error: `${label}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }),
}));
jest.mock("@/lib/hubspot-enum-labels", () => ({
  getActiveEnumOptions: jest.fn(),
}));
jest.mock("@/lib/hubspot-engagements", () => ({
  createDealNote: jest.fn(),
}));
jest.mock("@/lib/db", () => ({
  prisma: { activityLog: { create: jest.fn() } },
}));

import { hubspotClient } from "@/lib/hubspot";
import { getActiveEnumOptions } from "@/lib/hubspot-enum-labels";
import { createDealNote } from "@/lib/hubspot-engagements";
import { prisma } from "@/lib/db";
import { setStatus } from "@/lib/pi-hub/status";

const update = hubspotClient.crm.deals.basicApi.update as jest.Mock;
const mockOptions = getActiveEnumOptions as jest.Mock;
const mockNote = createDealNote as jest.Mock;
const mockLog = prisma.activityLog.create as unknown as jest.Mock;

const CALLER = {
  team: "permit" as const,
  dealId: "123",
  userEmail: "zach@photonbrothers.com",
  userName: "Zach",
  userId: "user-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOptions.mockResolvedValue([
    { value: "Submitted to AHJ", label: "Submitted to AHJ" },
    { value: "Complete", label: "Permit Issued" },
  ]);
  update.mockResolvedValue({});
  mockNote.mockResolvedValue(undefined);
  mockLog.mockResolvedValue({});
});

describe("setStatus", () => {
  it("rejects a value not in active options without calling update", async () => {
    await expect(
      setStatus({ ...CALLER, newValue: "Archived Old Status" }),
    ).rejects.toThrow(/not an active permitting_status option/);
    expect(update).not.toHaveBeenCalled();
    expect(mockNote).not.toHaveBeenCalled();
  });

  it("empty options list → load-failure message, no PATCH", async () => {
    mockOptions.mockResolvedValue([]);
    await expect(
      setStatus({ ...CALLER, newValue: "Submitted to AHJ" }),
    ).rejects.toThrow(
      "could not load permitting_status options from HubSpot — try again",
    );
    expect(update).not.toHaveBeenCalled();
    expect(mockNote).not.toHaveBeenCalled();
  });

  it("PATCH succeeds → ok with no warnings; note + activity attempted", async () => {
    const result = await setStatus({ ...CALLER, newValue: "Submitted to AHJ" });
    expect(result).toEqual({ ok: true, warnings: [] });
    expect(update).toHaveBeenCalledWith("123", {
      properties: { permitting_status: "Submitted to AHJ" },
    });
    expect(mockNote).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledTimes(1);
    // The today-count route filters on exactly this type — pin it.
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "HUBSPOT_DEAL_UPDATED" }),
      }),
    );
  });

  it("note failure warns but stays ok and still attempts the activity log", async () => {
    mockNote.mockRejectedValue(new Error("note boom"));
    const result = await setStatus({ ...CALLER, newValue: "Submitted to AHJ" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("note failed");
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it("activity-log failure warns but stays ok", async () => {
    mockLog.mockRejectedValue(new Error("db boom"));
    const result = await setStatus({ ...CALLER, newValue: "Submitted to AHJ" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("activity log failed");
  });

  it("PATCH failure throws; note is never attempted", async () => {
    update.mockRejectedValue(new Error("hubspot 500"));
    await expect(
      setStatus({ ...CALLER, newValue: "Submitted to AHJ" }),
    ).rejects.toThrow("hubspot 500");
    expect(mockNote).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
});
