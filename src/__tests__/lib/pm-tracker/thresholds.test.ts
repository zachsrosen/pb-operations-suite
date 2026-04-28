import { THRESHOLDS, bandFor } from "@/lib/pm-tracker/thresholds";

describe("pm-tracker/thresholds", () => {
  describe("bandFor (higher-is-better metrics)", () => {
    it("returns green when at/above green threshold", () => {
      expect(bandFor("readinessScore", 0.95)).toBe("green");
      expect(bandFor("readinessScore", 1.0)).toBe("green");
    });

    it("returns yellow between yellow and green thresholds", () => {
      expect(bandFor("readinessScore", 0.85)).toBe("yellow");
      expect(bandFor("readinessScore", 0.9)).toBe("yellow");
    });

    it("returns red below yellow threshold", () => {
      expect(bandFor("readinessScore", 0.84)).toBe("red");
      expect(bandFor("readinessScore", 0)).toBe("red");
    });
  });

  describe("bandFor (lower-is-better — ghostRate)", () => {
    it("returns green when at/below green threshold", () => {
      expect(bandFor("ghostRate", 0)).toBe("green");
      expect(bandFor("ghostRate", 0.05)).toBe("green");
    });

    it("returns yellow between green and yellow thresholds", () => {
      expect(bandFor("ghostRate", 0.1)).toBe("yellow");
      expect(bandFor("ghostRate", 0.15)).toBe("yellow");
    });

    it("returns red above yellow threshold", () => {
      expect(bandFor("ghostRate", 0.16)).toBe("red");
      expect(bandFor("ghostRate", 1)).toBe("red");
    });
  });

  describe("THRESHOLDS values", () => {
    it("defaults match the spec", () => {
      expect(THRESHOLDS.ghostDays).toBe(14);
      expect(THRESHOLDS.stuckDays).toBe(14);
      expect(THRESHOLDS.dayOfFailureHours).toBe(48);
      expect(THRESHOLDS.permitSlaDays).toBe(30);
      expect(THRESHOLDS.saveDebounceDays).toBe(30);
    });
  });
});
