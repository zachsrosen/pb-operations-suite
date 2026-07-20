import { LocationSchema, QuoteRequestSchema } from "@/lib/estimator/validation";

describe("estimator validation — location", () => {
  it("accepts PBLO", () => {
    expect(LocationSchema.parse("PBLO")).toBe("PBLO");
  });

  it("normalizes legacy COSP input to PBLO (stored runs + in-flight clients)", () => {
    expect(LocationSchema.parse("COSP")).toBe("PBLO");
  });

  it("still accepts the other location codes unchanged", () => {
    for (const loc of ["DTC", "WESTY", "CA", "CAMARILLO"]) {
      expect(LocationSchema.parse(loc)).toBe(loc);
    }
  });

  it("rejects unknown location codes", () => {
    expect(() => LocationSchema.parse("NOPE")).toThrow();
    expect(() => LocationSchema.parse("")).toThrow();
  });

  it("normalizes COSP inside a full quote request", () => {
    const parsed = QuoteRequestSchema.parse({
      address: { street: "1 Main St", city: "Pueblo", state: "CO", zip: "81001" },
      location: "COSP",
      utilityId: "2409",
      usage: { kind: "bill", avgMonthlyBillUsd: 150 },
      home: { roofType: "asphalt_shingle", heatPump: false },
      considerations: {
        planningEv: false,
        needsPanelUpgrade: false,
        planningHotTub: false,
        mayNeedNewRoof: false,
      },
      addOns: { evCharger: false, panelUpgrade: false },
    });
    expect(parsed.location).toBe("PBLO");
  });
});
