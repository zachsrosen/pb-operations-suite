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

describe("fetchMonitoring battery SoC derivation", () => {
  beforeEach(() => {
    findUnique.mockReset();
    powerhubFindMany.mockReset();
    findUnique.mockImplementation(async ({ where }: { where: { hubspotObjectId?: string; id?: string } }) => {
      if (where.hubspotObjectId === PROPERTY.hubspotObjectId) return PROPERTY;
      return null;
    });
  });

  function siteWithSnapshot(snapshot: Record<string, unknown> | null, totalBatteryEnergy: number | null) {
    return {
      ...POWERHUB_SITE,
      totalBatteryEnergy,
      telemetrySnapshot: snapshot,
    };
  }

  it("derives SoC from energy-remaining + capacity when battery_state_of_energy is missing", async () => {
    // Real values from Brotherton STE20230810-00404 on 2026-05-19 21:17 UTC
    powerhubFindMany.mockResolvedValue([
      siteWithSnapshot(
        {
          solarPowerW: 6720,
          batterySocPercent: null,             // Tesla didn't return this signal
          batteryEnergyRemainingWh: 10509,     // but it returned this
          gridConnectedStatus: "1",
        },
        13500, // gateway nameplate capacity
      ),
    ]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    expect(res.tab).toBe("monitoring");
    if (res.tab !== "monitoring") return;

    const soc = res.data.sites[0].snapshot?.batterySocPercent;
    expect(soc).not.toBeNull();
    expect(soc!).toBeCloseTo(77.84, 1); // 10509/13500*100 ≈ 77.84%
  });

  it("prefers the direct batterySocPercent signal when it's provided", async () => {
    powerhubFindMany.mockResolvedValue([
      siteWithSnapshot(
        {
          solarPowerW: null,
          batterySocPercent: 42,
          batteryEnergyRemainingWh: 10000, // would compute differently — ignored
          gridConnectedStatus: null,
        },
        20000,
      ),
    ]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;
    expect(res.data.sites[0].snapshot?.batterySocPercent).toBe(42);
  });

  it("returns null when neither direct SoC nor energy/capacity is available", async () => {
    powerhubFindMany.mockResolvedValue([
      siteWithSnapshot(
        {
          solarPowerW: null,
          batterySocPercent: null,
          batteryEnergyRemainingWh: null,
          gridConnectedStatus: null,
        },
        13500,
      ),
    ]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;
    expect(res.data.sites[0].snapshot?.batterySocPercent).toBeNull();
  });

  it("returns null when totalBatteryEnergy is zero or missing (avoid divide-by-zero)", async () => {
    powerhubFindMany.mockResolvedValue([
      siteWithSnapshot(
        {
          solarPowerW: null,
          batterySocPercent: null,
          batteryEnergyRemainingWh: 5000,
          gridConnectedStatus: null,
        },
        0, // bad capacity reading
      ),
    ]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;
    expect(res.data.sites[0].snapshot?.batterySocPercent).toBeNull();
  });
});
