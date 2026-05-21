import {
  buildEnphaseDeviceSummary,
  pickPrimaryEnphaseSite,
} from "@/lib/enphase-crosslink";
import { prisma } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

jest.mock("@/lib/db", () => ({
  prisma: {
    enphaseSite: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    hubSpotPropertyCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  updateTicketProperties: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-property", () => ({
  updateProperty: jest.fn().mockResolvedValue(undefined),
}));

// Suppress unused-import warnings — the mocks above are exercised in
// async-cascade tests that intentionally use these modules indirectly.
void prisma;
void updateDealProperty;
void updateTicketProperties;
void updateHubSpotProperty;

describe("buildEnphaseDeviceSummary", () => {
  it("extracts envoy, micros, and batteries from devices JSON", () => {
    const devices = {
      micro_inverters: [
        { serial_number: "MI001", model: "IQ8PLUS-72-2-US", part_number: "800-01968-r02" },
        { serial_number: "MI002", model: "IQ8PLUS-72-2-US", part_number: "800-01968-r02" },
      ],
      encharges: [
        { serial_number: "BAT001", model: "ENCHARGE-10T-1P-NA", part_number: "830-01760-r33" },
      ],
      enpower: [
        { serial_number: "ENV001", model: "IQ Combiner 4C", part_number: "800-01763-r06" },
      ],
    };
    const summary = buildEnphaseDeviceSummary(devices);
    expect(summary.envoySerial).toBe("ENV001");
    expect(summary.envoyModel).toBe("IQ Combiner 4C");
    expect(summary.microModel).toBe("IQ8PLUS-72-2-US");
    expect(summary.microCount).toBe(2);
    expect(summary.batterySerials).toBe("BAT001");
    expect(summary.batteryModel).toBe("ENCHARGE-10T-1P-NA");
    expect(summary.formatted).toContain("Envoy: ENV001");
    expect(summary.formatted).toContain("2× IQ8PLUS-72-2-US");
    expect(summary.formatted).toContain("Battery: BAT001");
  });

  it("returns nulls for empty devices", () => {
    const summary = buildEnphaseDeviceSummary({});
    expect(summary.envoySerial).toBeNull();
    expect(summary.microCount).toBe(0);
    expect(summary.formatted).toBeNull();
  });

  it("semicolon-joins multiple battery serials", () => {
    const devices = {
      encharges: [
        { serial_number: "B1", model: "ENCHARGE-10T", part_number: "x" },
        { serial_number: "B2", model: "ENCHARGE-10T", part_number: "x" },
      ],
    };
    const summary = buildEnphaseDeviceSummary(devices);
    expect(summary.batterySerials).toBe("B1; B2");
  });
});

describe("pickPrimaryEnphaseSite", () => {
  const makeSite = (overrides: Partial<{
    id: string;
    systemName: string;
    operationalAt: Date | null;
    createdAt: Date;
  }>) => ({
    id: overrides.id || "site1",
    systemName: overrides.systemName || "Test System",
    operationalAt: overrides.operationalAt ?? null,
    createdAt: overrides.createdAt || new Date("2024-01-01"),
  });

  it("returns null for empty array", () => {
    expect(pickPrimaryEnphaseSite([])).toBeNull();
  });

  it("picks newest operationalAt", () => {
    const sites = [
      makeSite({ id: "a", operationalAt: new Date("2024-01-01") }),
      makeSite({ id: "b", operationalAt: new Date("2024-06-15") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });

  it("falls back to createdAt when operationalAt is null", () => {
    const sites = [
      makeSite({ id: "a", createdAt: new Date("2024-01-01") }),
      makeSite({ id: "b", createdAt: new Date("2024-06-15") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });

  it("operationalAt beats createdAt-only site", () => {
    const sites = [
      makeSite({ id: "a", operationalAt: new Date("2023-01-01") }),
      makeSite({ id: "b", createdAt: new Date("2025-01-01") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("a");
  });

  it("tie-breaks on systemName desc then id desc", () => {
    const sites = [
      makeSite({ id: "a", systemName: "Alpha", operationalAt: new Date("2024-01-01") }),
      makeSite({ id: "b", systemName: "Zeta", operationalAt: new Date("2024-01-01") }),
    ];
    expect(pickPrimaryEnphaseSite(sites)!.id).toBe("b");
  });
});
