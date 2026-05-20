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
  totalGateways: 1,
  totalBatteries: 1,
  totalInverters: 1,
  totalBatteryEnergy: 13500,
  totalBatteryPower: 5800,
  aggregatorSiteId: null,
  devices: {},
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

  it("surfaces all expanded snapshot signals + equipment summary", async () => {
    // Real raw snapshot for Brotherton STE20230810-00404 on 2026-05-19 21:17 UTC
    powerhubFindMany.mockResolvedValue([
      siteWithSnapshot(
        {
          solarPowerW: 6720,
          batteryPowerW: 0,
          gridPowerW: -6214,
          loadPowerW: 506,
          batterySocPercent: null,
          batteryEnergyRemainingWh: 10509,
          gridConnectedStatus: "1",
          batteryMode: "7",
          solarEnergyTodayWh: 36927524,
          gridEnergyImportedWh: 7238858.5,
          gridEnergyExportedWh: 19476628,
        },
        13500,
      ),
    ]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;

    const site = res.data.sites[0];
    expect(site.equipment).toMatchObject({
      gatewayCount: 1,
      batteryCount: 1,
      inverterCount: 1,
      batteryCapacityWh: 13500,
      batteryMaxPowerW: 5800,
    });
    expect(site.snapshot).toMatchObject({
      solarPowerW: 6720,
      batteryPowerW: 0,
      gridPowerW: -6214,
      loadPowerW: 506,
      batteryEnergyRemainingWh: 10509,
      gridConnectedStatus: "1",
      batteryMode: "7",
      solarEnergyExportedLifetimeWh: 36927524,
      gridEnergyImportedLifetimeWh: 7238858.5,
      gridEnergyExportedLifetimeWh: 19476628,
    });
    expect(site.snapshot?.batterySocPercent).toBeCloseTo(77.84, 1);
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

describe("fetchMonitoring devices parsing", () => {
  beforeEach(() => {
    findUnique.mockReset();
    powerhubFindMany.mockReset();
    findUnique.mockImplementation(async ({ where }: { where: { hubspotObjectId?: string; id?: string } }) => {
      if (where.hubspotObjectId === PROPERTY.hubspotObjectId) return PROPERTY;
      return null;
    });
  });

  it("parses Brotherton-shaped devices JSON into typed arrays", async () => {
    // Real shape from Brotherton STE20230810-00404 — snake_case Tesla payload
    const teslaDevices = {
      evse: [],
      meters: [
        { din: "NEURIO--VAH5282AB4159", part_number: "NEURIO", serial_number: "VAH5282AB4159" },
      ],
      gateways: [
        {
          din: "1232100-10-H--CN322320G1H00M",
          device_id: "8c670f25-9362-4e2c-a43a-c5857a208dbc",
          part_number: "1232100-10-H",
          serial_number: "CN322320G1H00M",
          nameplate_energy_watt_hours: 13500,
          nameplate_max_charge_power_watts: 5800,
          nameplate_max_discharge_power_watts: 5800,
        },
      ],
      batteries: [
        { din: "3012170-25-E--TG123105001YFE", part_number: "3012170-25-E", serial_number: "TG123105001YFE" },
      ],
      inverters: [
        { din: "1538100-01-F--ADU23270I001VE", part_number: "1538100-01-F", serial_number: "ADU23270I001VE" },
      ],
    };
    powerhubFindMany.mockResolvedValue([{ ...POWERHUB_SITE, devices: teslaDevices, aggregatorSiteId: "PB-DEAL-12345" }]);

    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;

    const eq = res.data.sites[0].equipment;
    expect(eq.aggregatorSiteId).toBe("PB-DEAL-12345");
    expect(eq.devices.gateways).toHaveLength(1);
    expect(eq.devices.gateways[0]).toMatchObject({
      partNumber: "1232100-10-H",
      serialNumber: "CN322320G1H00M",
      deviceId: "8c670f25-9362-4e2c-a43a-c5857a208dbc",
      nameplateEnergyWh: 13500,
      nameplateMaxChargeW: 5800,
      nameplateMaxDischargeW: 5800,
    });
    expect(eq.devices.batteries[0].serialNumber).toBe("TG123105001YFE");
    expect(eq.devices.inverters[0].serialNumber).toBe("ADU23270I001VE");
    expect(eq.devices.meters[0].partNumber).toBe("NEURIO");
    expect(eq.devices.evse).toEqual([]);
  });

  it("returns safe empty arrays when devices JSON is null / missing / malformed", async () => {
    powerhubFindMany.mockResolvedValue([{ ...POWERHUB_SITE, devices: null }]);
    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;
    const eq = res.data.sites[0].equipment;
    expect(eq.devices.gateways).toEqual([]);
    expect(eq.devices.batteries).toEqual([]);
    expect(eq.devices.inverters).toEqual([]);
    expect(eq.devices.meters).toEqual([]);
    expect(eq.devices.evse).toEqual([]);
  });

  it("ignores garbage entries (non-array values) gracefully", async () => {
    powerhubFindMany.mockResolvedValue([
      { ...POWERHUB_SITE, devices: { gateways: "not-an-array", batteries: null, inverters: 42 } as unknown },
    ]);
    const res = await getPropertyHub(PROPERTY.hubspotObjectId, "monitoring");
    if (res.tab !== "monitoring") return;
    const eq = res.data.sites[0].equipment;
    expect(eq.devices.gateways).toEqual([]);
    expect(eq.devices.batteries).toEqual([]);
    expect(eq.devices.inverters).toEqual([]);
  });
});
