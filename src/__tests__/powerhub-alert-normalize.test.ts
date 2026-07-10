import {
  normalizePowerhubSeverity,
  buildDinToSiteIdMap,
} from "@/lib/powerhub-alert-normalize";
import { POWERHUB_SEVERITY_RANK } from "@/lib/service-priority";

describe("normalizePowerhubSeverity", () => {
  it("maps Tesla's known severities to enum values", () => {
    expect(normalizePowerhubSeverity("Critical")).toBe("CRITICAL");
    expect(normalizePowerhubSeverity("Performance")).toBe("PERFORMANCE");
    expect(normalizePowerhubSeverity("Informational")).toBe("INFORMATIONAL");
  });

  it("maps ReturnMerchandiseAuthorization to RMA", () => {
    expect(normalizePowerhubSeverity("ReturnMerchandiseAuthorization")).toBe(
      "RMA"
    );
  });

  it("is case-insensitive", () => {
    expect(normalizePowerhubSeverity("CRITICAL")).toBe("CRITICAL");
    expect(normalizePowerhubSeverity("returnmerchandiseauthorization")).toBe(
      "RMA"
    );
  });

  it("falls back to INFORMATIONAL for unknown or missing severities", () => {
    expect(normalizePowerhubSeverity("SomeBrandNewSeverity")).toBe(
      "INFORMATIONAL"
    );
    expect(normalizePowerhubSeverity(undefined)).toBe("INFORMATIONAL");
    expect(normalizePowerhubSeverity("")).toBe("INFORMATIONAL");
  });
});

describe("POWERHUB_SEVERITY_RANK", () => {
  it("ranks RMA above PERFORMANCE and below CRITICAL", () => {
    expect(POWERHUB_SEVERITY_RANK.RMA).toBeGreaterThan(
      POWERHUB_SEVERITY_RANK.PERFORMANCE
    );
    expect(POWERHUB_SEVERITY_RANK.RMA).toBeLessThan(
      POWERHUB_SEVERITY_RANK.CRITICAL
    );
  });
});

describe("buildDinToSiteIdMap", () => {
  it("maps DINs from every device category, for every site", () => {
    const map = buildDinToSiteIdMap([
      {
        siteId: "site-1",
        devices: {
          gateways: [{ din: "GW-1" }],
          batteries: [{ din: "BAT-1" }, { din: "BAT-2" }],
          inverters: [{ din: "INV-1" }],
          meters: [{ din: "MTR-1" }],
          evse: [{ din: "EV-1" }],
        },
      },
      // Shell site: zero gateway/battery/inverter counts, but a meter with
      // a DIN — its alerts must still map.
      {
        siteId: "site-2",
        devices: { meters: [{ din: "MTR-2" }] },
      },
    ]);

    expect(map.get("GW-1")).toBe("site-1");
    expect(map.get("BAT-2")).toBe("site-1");
    expect(map.get("MTR-1")).toBe("site-1");
    expect(map.get("EV-1")).toBe("site-1");
    expect(map.get("MTR-2")).toBe("site-2");
    expect(map.size).toBe(7);
  });

  it("tolerates null, non-object, and empty devices payloads", () => {
    const map = buildDinToSiteIdMap([
      { siteId: "a", devices: null },
      { siteId: "b", devices: "[]" },
      { siteId: "c", devices: { gateways: [{}] } },
    ]);
    expect(map.size).toBe(0);
  });
});
