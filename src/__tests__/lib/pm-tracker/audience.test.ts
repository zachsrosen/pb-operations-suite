import { isInAudience } from "@/lib/pm-tracker/audience-list";

describe("pm-tracker/audience", () => {
  describe("isInAudience", () => {
    it("returns true for the configured audience email", () => {
      expect(isInAudience("zach@photonbrothers.com")).toBe(true);
    });

    it("is case-insensitive and trims whitespace", () => {
      expect(isInAudience("ZACH@PhotonBrothers.com")).toBe(true);
      expect(isInAudience("  zach@photonbrothers.com  ")).toBe(true);
    });

    it("returns false for null/undefined/empty input", () => {
      expect(isInAudience(null)).toBe(false);
      expect(isInAudience(undefined)).toBe(false);
      expect(isInAudience("")).toBe(false);
    });

    it("returns false for non-allowlisted emails (even other PB employees)", () => {
      expect(isInAudience("jake@photonbrothers.com")).toBe(false);
      expect(isInAudience("attacker@example.com")).toBe(false);
    });
  });
});
