// Mock db and zuper-catalog so Jest doesn't try to parse Prisma's ESM client
jest.mock("@/lib/db", () => ({ prisma: {} }));
jest.mock("@/lib/zuper-catalog", () => ({
  mergeZuperMetaData: jest.fn((existing: unknown[], updates: unknown[]) => [...existing, ...updates]),
}));

import {
  buildPropertyCustomFields,
  ZUPER_PROPERTY_FIELD_LABELS,
} from "@/lib/zuper-property-sync";

describe("buildPropertyCustomFields", () => {
  it("maps a fully populated property to 10 custom field entries", () => {
    const property = {
      systemSizeKwDc: 8.4,
      hasBattery: true,
      hasEvCharger: false,
      firstInstallDate: new Date("2024-03-15"),
      yearBuilt: 1998,
      squareFootage: 2400,
      stories: 2,
      pbLocation: "DTC",
      ahjName: "El Paso County",
      utilityName: "Colorado Springs Utilities",
      teslaPortalUrl: null,
      teslaSiteId: null,
      teslaGatewaySerial: null,
      teslaPowerwallSerials: null,
      teslaInverterSerial: null,
      teslaMeterSerial: null,
      teslaGatewayModel: null,
      teslaPowerwallModel: null,
      teslaInverterModel: null,
      teslaMeterModel: null,
      teslaHardwareSummary: null,
    };

    const fields = buildPropertyCustomFields(property);

    expect(fields).toHaveLength(21);
    expect(fields.find((f) => f.label === "System Size (kW)")?.value).toBe("8.4");
    expect(fields.find((f) => f.label === "Has Battery")?.value).toBe("Yes");
    expect(fields.find((f) => f.label === "Has EV Charger")?.value).toBe("No");
    expect(fields.find((f) => f.label === "Install Date")?.value).toBe("2024-03-15");
    expect(fields.find((f) => f.label === "Year Built")?.value).toBe("1998");
    expect(fields.find((f) => f.label === "Square Footage")?.value).toBe("2400");
    expect(fields.find((f) => f.label === "Stories")?.value).toBe("2");
    expect(fields.find((f) => f.label === "PB Location")?.value).toBe("DTC");
    expect(fields.find((f) => f.label === "AHJ")?.value).toBe("El Paso County");
    expect(fields.find((f) => f.label === "Utility")?.value).toBe("Colorado Springs Utilities");
  });

  it("handles null/missing fields with empty strings or N/A", () => {
    const property = {
      systemSizeKwDc: null,
      hasBattery: false,
      hasEvCharger: false,
      firstInstallDate: null,
      yearBuilt: null,
      squareFootage: null,
      stories: null,
      pbLocation: null,
      ahjName: null,
      utilityName: null,
      teslaPortalUrl: null,
      teslaSiteId: null,
      teslaGatewaySerial: null,
      teslaPowerwallSerials: null,
      teslaInverterSerial: null,
      teslaMeterSerial: null,
      teslaGatewayModel: null,
      teslaPowerwallModel: null,
      teslaInverterModel: null,
      teslaMeterModel: null,
      teslaHardwareSummary: null,
    };

    const fields = buildPropertyCustomFields(property);

    expect(fields).toHaveLength(21);
    expect(fields.find((f) => f.label === "System Size (kW)")?.value).toBe("N/A");
    expect(fields.find((f) => f.label === "Has Battery")?.value).toBe("No");
    expect(fields.find((f) => f.label === "Has EV Charger")?.value).toBe("No");
    expect(fields.find((f) => f.label === "Install Date")?.value).toBe("");
    expect(fields.find((f) => f.label === "Year Built")?.value).toBe("");
    expect(fields.find((f) => f.label === "Square Footage")?.value).toBe("");
    expect(fields.find((f) => f.label === "Stories")?.value).toBe("");
    expect(fields.find((f) => f.label === "PB Location")?.value).toBe("");
    expect(fields.find((f) => f.label === "AHJ")?.value).toBe("");
    expect(fields.find((f) => f.label === "Utility")?.value).toBe("");
    expect(fields.find((f) => f.label === "Tesla PowerHub")?.value).toBe("");
    expect(fields.find((f) => f.label === "Tesla Site ID")?.value).toBe("");
  });

  it("exports all 21 field labels", () => {
    expect(ZUPER_PROPERTY_FIELD_LABELS).toHaveLength(21);
  });

  it("all simple fields use SINGLE_LINE type (hardware summary is MULTI_LINE)", () => {
    const property = {
      systemSizeKwDc: 5.0,
      hasBattery: false,
      hasEvCharger: false,
      firstInstallDate: null,
      yearBuilt: 2000,
      squareFootage: 1500,
      stories: 1,
      pbLocation: "Westminster",
      ahjName: "City of Westminster",
      utilityName: "Xcel Energy",
      teslaPortalUrl: null,
      teslaSiteId: null,
      teslaGatewaySerial: null,
      teslaPowerwallSerials: null,
      teslaInverterSerial: null,
      teslaMeterSerial: null,
      teslaGatewayModel: null,
      teslaPowerwallModel: null,
      teslaInverterModel: null,
      teslaMeterModel: null,
      teslaHardwareSummary: null,
    };

    const fields = buildPropertyCustomFields(property);
    const summary = fields.find((f) => f.label === "Tesla Hardware Summary");
    expect(summary?.type).toBe("MULTI_LINE");
    expect(fields.filter((f) => f.label !== "Tesla Hardware Summary").every((f) => f.type === "SINGLE_LINE")).toBe(true);
  });
});
