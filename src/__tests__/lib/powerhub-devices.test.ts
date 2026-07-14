import { computeDeviceCounts, isPowerwallInGatewayList } from "@/lib/powerhub-devices";

describe("isPowerwallInGatewayList", () => {
  it("recognizes Powerwall 3 part families (1707000) as batteries", () => {
    expect(isPowerwallInGatewayList({ part_number: "1707000-11-L" })).toBe(true);
    expect(isPowerwallInGatewayList({ part_number: "1707000-21-M" })).toBe(true);
    expect(isPowerwallInGatewayList({ din: "1707000-11-L--TG125004000TDK" })).toBe(true);
  });
  it("treats genuine Backup Gateways (1232100) and others as gateways", () => {
    expect(isPowerwallInGatewayList({ part_number: "1232100-00-H" })).toBe(false);
    expect(isPowerwallInGatewayList({ part_number: "1538000-25-F" })).toBe(false);
    expect(isPowerwallInGatewayList({ part_number: "" })).toBe(false);
  });
});

describe("computeDeviceCounts", () => {
  it("reclassifies Powerwall 3 gateways as batteries (the reported bug)", () => {
    const snap = {
      gateways: [{ part_number: "1707000-11-L" }, { part_number: "1707000-11-L" }],
      batteries: [],
      inverters: [],
    };
    expect(computeDeviceCounts(snap)).toEqual({ totalGateways: 0, totalBatteries: 2, totalInverters: 0 });
  });

  it("keeps a traditional PW2 + Backup Gateway system unchanged", () => {
    const snap = {
      gateways: [{ part_number: "1232100-00-H" }],
      batteries: [{ part_number: "3012170-05-C" }, { part_number: "3012170-05-C" }],
      inverters: [{ part_number: "1538100-01-F" }],
    };
    expect(computeDeviceCounts(snap)).toEqual({ totalGateways: 1, totalBatteries: 2, totalInverters: 1 });
  });

  it("handles a mixed gateway list (real gateway + PW3)", () => {
    const snap = {
      gateways: [{ part_number: "1232100-00-H" }, { part_number: "1707000-11-L" }],
      batteries: [],
      inverters: [],
    };
    expect(computeDeviceCounts(snap)).toEqual({ totalGateways: 1, totalBatteries: 1, totalInverters: 0 });
  });

  it("falls back to gateway total when the gateways array is empty", () => {
    expect(computeDeviceCounts({ gateways: [], batteries: [], inverters: [] }, 3)).toEqual({
      totalGateways: 3,
      totalBatteries: 0,
      totalInverters: 0,
    });
  });

  it("handles null/missing snapshot", () => {
    expect(computeDeviceCounts(null)).toEqual({ totalGateways: 0, totalBatteries: 0, totalInverters: 0 });
  });
});
