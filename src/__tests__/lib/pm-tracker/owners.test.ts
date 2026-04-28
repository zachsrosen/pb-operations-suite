import { normalizePmName, isPmName, rawNamesFor, PM_NAMES } from "@/lib/pm-tracker/owners";

describe("pm-tracker/owners", () => {
  describe("normalizePmName", () => {
    it("returns null for null/undefined/empty input", () => {
      expect(normalizePmName(null)).toBeNull();
      expect(normalizePmName(undefined)).toBeNull();
      expect(normalizePmName("")).toBeNull();
      expect(normalizePmName("   ")).toBeNull();
    });

    it("normalizes case and whitespace", () => {
      expect(normalizePmName("Natasha")).toBe("Natasha");
      expect(normalizePmName("natasha")).toBe("Natasha");
      expect(normalizePmName("  NATASHA  ")).toBe("Natasha");
    });

    it("treats Kaitlyn variants as the same person (Phase 1 assumption)", () => {
      expect(normalizePmName("Kaitlyn")).toBe("Kaitlyn");
      expect(normalizePmName("Katlyyn")).toBe("Kaitlyn");
      expect(normalizePmName("Katelyn")).toBe("Kaitlyn");
      expect(normalizePmName("KATELYNN")).toBe("Kaitlyn");
    });

    it("returns null for unknown names", () => {
      expect(normalizePmName("Steve")).toBeNull();
      expect(normalizePmName("Random Person")).toBeNull();
    });
  });

  describe("isPmName", () => {
    it("returns true for known names", () => {
      expect(isPmName("Natasha")).toBe(true);
      expect(isPmName("alexis")).toBe(true);
      expect(isPmName("Katlyyn")).toBe(true);
    });

    it("returns false for unknown names", () => {
      expect(isPmName("Steve")).toBe(false);
      expect(isPmName(null)).toBe(false);
    });
  });

  describe("rawNamesFor", () => {
    it("returns all spellings for a canonical PM", () => {
      const variants = rawNamesFor("Kaitlyn");
      expect(variants).toContain("kaitlyn");
      expect(variants).toContain("katlyyn");
      expect(variants).toContain("katelyn");
      expect(variants).toContain("katelynn");
    });

    it("returns single-spelling list for unambiguous PMs", () => {
      expect(rawNamesFor("Natasha")).toEqual(["natasha"]);
      expect(rawNamesFor("Alexis")).toEqual(["alexis"]);
    });
  });

  describe("PM_NAMES", () => {
    it("contains the four (or three after merge) canonical PMs", () => {
      expect(PM_NAMES).toContain("Natasha");
      expect(PM_NAMES).toContain("Alexis");
      expect(PM_NAMES).toContain("Kaitlyn");
    });
  });
});
