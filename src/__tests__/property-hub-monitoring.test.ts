/**
 * Regression test for fetchMonitoring id-resolution.
 *
 * Bug: fetchMonitoring queried prisma.powerhubSite.findMany with the raw
 * incoming `propertyId`. The /properties/[id] page URL uses the HubSpot
 * object id (numeric string), but PowerhubSite.propertyId always stores the
 * internal Prisma cuid. The HubSpot-id call therefore returned an empty
 * sites array even when linked PowerhubSite rows existed.
 *
 * Fix: resolve the incoming id via loadPropertyWithLinks first, then use
 * property.id (the internal cuid) for the PowerhubSite query — matching the
 * pattern used by every other tab fetcher and by getPropertyHubCounts.
 */

const findUnique = jest.fn();
const powerhubFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
    powerhubSite: {
      findMany: (...args: unknown[]) => powerhubFindMany(...args),
    },
  },
}));

import { getPropertyHub } from "@/lib/property-hub";

const PROPERTY = {
  id: "cmo0dq7o200rz1l8ogdsmuij6",
  hubspotObjectId: "51680210691",
  dealLinks: [],
  ticketLinks: [],
  contactLinks: [],
};

const POWERHUB_SITE = {
  id: "site-row-1",
  siteId: "tesla-uuid-1",
  siteName: "STE20230821-00641",
  portalUrl: "https://powerhub.energy.tesla.com/site/tesla-uuid-1",
  status: "ACTIVE",
  primaryForProperty: true,
  lastTelemetryAt: null,
  telemetrySnapshot: null,
  alerts: [],
};

describe("fetchMonitoring id resolution", () => {
  beforeEach(() => {
    findUnique.mockReset();
    powerhubFindMany.mockReset();
    powerhubFindMany.mockResolvedValue([POWERHUB_SITE]);
  });

  it("queries PowerhubSite by internal cuid when called with the HubSpot object id", async () => {
    // Caller passes the numeric HubSpot object id (the URL form)
    findUnique.mockImplementation(async ({ where }: { where: { hubspotObjectId?: string; id?: string } }) => {
      if (where.hubspotObjectId === PROPERTY.hubspotObjectId) return PROPERTY;
      return null;
    });

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");

    // Resolver was used
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hubspotObjectId: PROPERTY.hubspotObjectId } }),
    );

    // PowerhubSite query used the INTERNAL cuid, not the raw HubSpot id
    expect(powerhubFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: PROPERTY.id } }),
    );

    expect(res.tab).toBe("monitoring");
    if (res.tab === "monitoring") {
      expect(res.data.sites).toHaveLength(1);
      expect(res.data.sites[0].siteName).toBe(POWERHUB_SITE.siteName);
    }
  });

  it("queries PowerhubSite by internal cuid when called with the internal cuid", async () => {
    // Caller passes the internal cuid directly (e.g. server-side flows)
    findUnique.mockImplementation(async ({ where }: { where: { hubspotObjectId?: string; id?: string } }) => {
      if (where.id === PROPERTY.id) return PROPERTY;
      return null;
    });

    await getPropertyHub(PROPERTY.id, "monitoring");

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROPERTY.id } }),
    );
    expect(powerhubFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: PROPERTY.id } }),
    );
  });

  it("returns an empty sites array when the property does not exist", async () => {
    findUnique.mockResolvedValue(null);

    const res = await getPropertyHub("does-not-exist", "monitoring");

    expect(res.tab).toBe("monitoring");
    if (res.tab === "monitoring") {
      expect(res.data.sites).toEqual([]);
      expect(res.data.totalActiveAlerts).toBe(0);
    }
    // Must NOT query PowerhubSite when the property lookup misses
    expect(powerhubFindMany).not.toHaveBeenCalled();
  });
});
