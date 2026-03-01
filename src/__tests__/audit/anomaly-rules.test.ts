import {
  checkOffHours,
  checkRapidActions,
  checkUnknownClientOnProd,
  checkNewDevice,
  checkNewIP,
  checkSensitiveFromNewContext,
  checkImpossibleTravel,
  type AnomalyRuleResult,
} from "@/lib/audit/anomaly-rules";

describe("checkOffHours", () => {
  it("triggers for 11pm America/Denver time", () => {
    // 11pm MST = 6am UTC next day
    const date = new Date("2026-03-02T06:00:00Z");
    const result = checkOffHours(date);
    expect(result.triggered).toBe(true);
    expect(result.riskScore).toBe(1);
    expect(result.rule).toBe("off_hours");
  });

  it("does not trigger for 10am America/Denver time", () => {
    // 10am MST = 5pm UTC
    const date = new Date("2026-03-02T17:00:00Z");
    const result = checkOffHours(date);
    expect(result.triggered).toBe(false);
  });

  it("triggers for 3am America/Denver time", () => {
    // 3am MST = 10am UTC
    const date = new Date("2026-03-02T10:00:00Z");
    const result = checkOffHours(date);
    expect(result.triggered).toBe(true);
  });
});

describe("checkRapidActions", () => {
  it("triggers when >20 mutating actions in 5 minutes", () => {
    const result = checkRapidActions(21);
    expect(result.triggered).toBe(true);
    expect(result.riskScore).toBe(2);
    expect(result.rule).toBe("rapid_actions");
  });

  it("does not trigger for <=20 actions", () => {
    expect(checkRapidActions(20).triggered).toBe(false);
    expect(checkRapidActions(0).triggered).toBe(false);
  });
});

describe("checkUnknownClientOnProd", () => {
  it("triggers for UNKNOWN on PRODUCTION", () => {
    const result = checkUnknownClientOnProd("UNKNOWN", "PRODUCTION");
    expect(result.triggered).toBe(true);
    expect(result.riskScore).toBe(2);
  });

  it("does not trigger for UNKNOWN on LOCAL", () => {
    expect(checkUnknownClientOnProd("UNKNOWN", "LOCAL").triggered).toBe(false);
  });

  it("does not trigger for BROWSER on PRODUCTION", () => {
    expect(checkUnknownClientOnProd("BROWSER", "PRODUCTION").triggered).toBe(
      false
    );
  });
});

describe("checkNewDevice", () => {
  it("triggers when fingerprint is new", () => {
    const result = checkNewDevice(false, "fp_abc123");
    expect(result.triggered).toBe(true);
    expect(result.rule).toBe("new_device");
  });

  it("does not trigger when fingerprint is known", () => {
    expect(checkNewDevice(true, "fp_abc123").triggered).toBe(false);
  });

  it("does not trigger when no fingerprint", () => {
    expect(checkNewDevice(false, null).triggered).toBe(false);
  });
});

describe("checkNewIP", () => {
  it("triggers for unknown IP on PRODUCTION", () => {
    const result = checkNewIP(false, "8.8.8.8", "PRODUCTION");
    expect(result.triggered).toBe(true);
    expect(result.rule).toBe("new_ip");
  });

  it("does not trigger for known IP", () => {
    expect(checkNewIP(true, "8.8.8.8", "PRODUCTION").triggered).toBe(false);
  });

  it("does not trigger on LOCAL", () => {
    expect(checkNewIP(false, "8.8.8.8", "LOCAL").triggered).toBe(false);
  });
});

describe("checkSensitiveFromNewContext", () => {
  it("triggers for HIGH risk + new device", () => {
    const result = checkSensitiveFromNewContext(3, true, false);
    expect(result.triggered).toBe(true);
    expect(result.riskScore).toBe(3);
  });

  it("triggers for HIGH risk + new IP", () => {
    expect(checkSensitiveFromNewContext(3, false, true).triggered).toBe(true);
  });

  it("does not trigger for LOW risk + new device", () => {
    expect(checkSensitiveFromNewContext(1, true, false).triggered).toBe(false);
  });

  it("does not trigger for HIGH risk without new context", () => {
    expect(checkSensitiveFromNewContext(3, false, false).triggered).toBe(false);
  });
});

describe("checkImpossibleTravel (stub)", () => {
  it("never triggers (stub)", () => {
    const result = checkImpossibleTravel();
    expect(result.triggered).toBe(false);
    expect(result.rule).toBe("impossible_travel");
  });
});
