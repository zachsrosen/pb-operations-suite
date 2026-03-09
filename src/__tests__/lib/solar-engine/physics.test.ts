/**
 * Solar Engine — Physics Module Tests
 *
 * Golden-master fixture tests for pure physics functions.
 * All assertions use deterministic expected values (not snapshots).
 */

import {
  solarFactor,
  seasonFactor,
  getSeasonalTSRF,
  getPanelShadeFactorAtTimestep,
  calculateStringElectrical,
} from "@/lib/solar/engine/physics";
import { expectClose, expectInRange } from "./test-helpers";

describe("solarFactor", () => {
  it("returns 0 before sunrise (hour < 6)", () => {
    expect(solarFactor(0)).toBe(0); // midnight
    expect(solarFactor(10)).toBe(0); // 5:00
    expect(solarFactor(11)).toBe(0); // 5:30
  });

  it("returns 0 after sunset (hour > 20)", () => {
    expect(solarFactor(41)).toBe(0); // 20:30
    expect(solarFactor(47)).toBe(0); // 23:30
  });

  it("peaks near solar noon (halfHour=24, hour=12)", () => {
    const noon = solarFactor(24);
    // sin((12-6)/14 * PI) = sin(6/14 * PI) ≈ sin(0.4286 * PI) ≈ 0.975
    expectClose(noon, 0.9749, 0.01, "solar noon");
  });

  it("is symmetric around solar midpoint (hour 13)", () => {
    // Midpoint of [6,20] = 13. hour 8 is 5h before, hour 18 is 5h after.
    // halfHour 16 = hour 8, halfHour 36 = hour 18
    const morning = solarFactor(16);
    const afternoon = solarFactor(36);
    expectClose(morning, afternoon, 0.001, "symmetry");
  });

  it("returns values between 0 and 1 for all daylight hours", () => {
    for (let h = 12; h <= 40; h++) {
      const val = solarFactor(h);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

describe("seasonFactor", () => {
  it("peaks near summer solstice (day ~172)", () => {
    const summer = seasonFactor(172);
    // 0.7 + 0.3 * sin((172-80)/365 * 2PI) = 0.7 + 0.3 * sin(1.584) ≈ 0.7 + 0.3 * 0.9998 ≈ 1.0
    expectClose(summer, 1.0, 0.01, "summer solstice");
  });

  it("troughs near winter solstice (day ~355)", () => {
    const winter = seasonFactor(355);
    // Should be near minimum ~0.4
    expectInRange(winter, 0.38, 0.50, "winter solstice");
  });

  it("is ~0.7 at equinoxes (day ~80, ~263)", () => {
    // sin((80-80)/365*2PI) = sin(0) = 0 → 0.7
    expectClose(seasonFactor(80), 0.7, 0.01, "spring equinox");
    // sin((263-80)/365*2PI) ≈ sin(PI) ≈ 0 → 0.7
    expectClose(seasonFactor(263), 0.7, 0.05, "fall equinox");
  });

  it("stays within [0.4, 1.0] for all days", () => {
    for (let d = 0; d < 365; d++) {
      expectInRange(seasonFactor(d), 0.38, 1.01, `day ${d}`);
    }
  });
});

describe("getSeasonalTSRF", () => {
  it("returns raw TSRF when hasShade=true", () => {
    expect(getSeasonalTSRF(0.85, 172, true)).toBe(0.85);
    expect(getSeasonalTSRF(0.85, 0, true)).toBe(0.85);
  });

  it("returns 0.8 for falsy TSRF", () => {
    expect(getSeasonalTSRF(0, 100)).toBe(0.8);
  });

  it("returns 1.0 for TSRF >= 1.0", () => {
    expect(getSeasonalTSRF(1.0, 100)).toBe(1.0);
  });

  it("summer > winter for TSRF < 1.0 (without shade)", () => {
    const summer = getSeasonalTSRF(0.85, 172, false);
    const winter = getSeasonalTSRF(0.85, 355, false);
    expect(summer).toBeGreaterThan(winter);
  });

  it("stays within [0.01, 1.0]", () => {
    for (let d = 0; d < 365; d++) {
      const val = getSeasonalTSRF(0.5, d, false);
      expectInRange(val, 0.01, 1.0, `day ${d}`);
    }
  });
});

describe("getPanelShadeFactorAtTimestep", () => {
  it("returns 1 when hasShade=false", () => {
    expect(
      getPanelShadeFactorAtTimestep(["p1", "p2"], 0, { p1: "00", p2: "00" }, false)
    ).toBe(1);
  });

  it("returns 1 when no points", () => {
    expect(getPanelShadeFactorAtTimestep([], 0, {}, true)).toBe(1);
  });

  it("returns 1 when all points unshaded (char '1' = sun)", () => {
    const shade = { p1: "11", p2: "11" };
    expect(getPanelShadeFactorAtTimestep(["p1", "p2"], 0, shade, true)).toBe(1);
  });

  it("returns 0 when all points shaded (char '0' = shade)", () => {
    const shade = { p1: "00", p2: "00" };
    expect(getPanelShadeFactorAtTimestep(["p1", "p2"], 0, shade, true)).toBe(0);
  });

  it("returns 0.5 when half points shaded", () => {
    const shade = { p1: "0", p2: "1" };
    expect(getPanelShadeFactorAtTimestep(["p1", "p2"], 0, shade, true)).toBe(0.5);
  });

  it("returns 1 when timestep beyond sequence length", () => {
    const shade = { p1: "01" };
    // timestepIdx=5 is beyond the 2-char sequence
    expect(getPanelShadeFactorAtTimestep(["p1"], 5, shade, true)).toBe(1);
  });
});

describe("calculateStringElectrical", () => {
  const panel = {
    watts: 440,
    voc: 48.4,
    vmp: 40.8,
    isc: 11.5,
    imp: 10.79,
    tempCoVoc: -0.0024,
    tempCoIsc: 0.0004,
  };
  const inverter = { mpptMax: 500, mpptMin: 100, maxIsc: 20 };

  it("computes correct Voc at cold temperature", () => {
    const result = calculateStringElectrical({
      numPanels: 10,
      panel,
      inverter,
      tempMin: -10,
      tempMax: 45,
    });
    // 10 * 48.4 * (1 + (-0.0024) * (-10 - 25)) = 484 * (1 + 0.084) = 484 * 1.084 = 524.656
    expectClose(result.vocCold, 524.656, 0.01, "vocCold");
  });

  it("warns when Voc exceeds inverter max", () => {
    const result = calculateStringElectrical({
      numPanels: 12,
      panel,
      inverter,
      tempMin: -20,
      tempMax: 45,
    });
    expect(result.warning).toContain("Voc exceeds");
  });

  it("warns when Vmp below inverter min", () => {
    const result = calculateStringElectrical({
      numPanels: 2,
      panel,
      inverter: { ...inverter, mpptMin: 200 },
      tempMin: 0,
      tempMax: 60,
    });
    expect(result.warning).toContain("Vmp below");
  });

  it("returns no warning for valid config", () => {
    const result = calculateStringElectrical({
      numPanels: 8,
      panel,
      inverter,
      tempMin: 0,
      tempMax: 40,
    });
    expect(result.warning).toBeNull();
  });
});
