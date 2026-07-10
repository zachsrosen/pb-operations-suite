/**
 * Existing PowerhubAlert rows created before the RMA enum shipped were
 * stored as INFORMATIONAL. The poll's update path must refresh severity so
 * those rows correct themselves on the next sync instead of staying wrong
 * until the alert clears and re-reports.
 */
jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn() },
    powerhubAlert: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock("@/lib/tesla-powerhub", () => ({
  createPowerHubClient: jest.fn(),
  computePortalUrl: jest.fn(),
}));
jest.mock("@/lib/powerhub-linkage", () => ({
  normalizeAddress: jest.fn(),
  linkSite: jest.fn(),
}));
jest.mock("@/lib/powerhub-crosslink", () => ({
  enqueueCrossSystemPush: jest.fn(),
}));
jest.mock("@/lib/cache", () => ({
  appCache: { invalidate: jest.fn() },
}));

import { pollAlerts } from "@/lib/powerhub-sync";
import { prisma } from "@/lib/db";
import { createPowerHubClient } from "@/lib/tesla-powerhub";

const mockSiteFindMany = prisma.powerhubSite.findMany as jest.Mock;
const mockAlertFindUnique = prisma.powerhubAlert.findUnique as jest.Mock;
const mockAlertFindMany = prisma.powerhubAlert.findMany as jest.Mock;
const mockAlertUpdate = prisma.powerhubAlert.update as jest.Mock;
const mockClient = createPowerHubClient as jest.Mock;

it("refreshes severity on pre-existing alert rows", async () => {
  process.env.POWERHUB_ENABLED = "true";
  mockClient.mockReturnValue({
    getGroups: jest.fn().mockResolvedValue([{ group_id: "g1" }]),
    getActiveAlerts: jest.fn().mockResolvedValue({
      data: [
        {
          alert_id: "a1",
          din: "DIN-1",
          device_id: "dev-1",
          alert_name: "Powerwall RMA",
          description: "Replace part",
          severity: "ReturnMerchandiseAuthorization",
          start_time: "2026-07-01T00:00:00.000Z",
        },
      ],
      metadata: {},
    }),
  });
  mockSiteFindMany.mockResolvedValue([
    { siteId: "site-1", devices: { batteries: [{ din: "DIN-1" }] } },
  ]);
  // Row already exists — stored as INFORMATIONAL before the RMA enum shipped
  mockAlertFindUnique.mockResolvedValue({ id: "row-1", severity: "INFORMATIONAL" });
  mockAlertFindMany.mockResolvedValue([]);
  mockAlertUpdate.mockResolvedValue({});

  await pollAlerts();

  expect(mockAlertUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "row-1" },
      data: expect.objectContaining({ severity: "RMA" }),
    })
  );
});
