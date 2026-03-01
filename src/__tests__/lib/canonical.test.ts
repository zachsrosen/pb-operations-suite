import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";

describe("canonical", () => {
  describe("canonicalToken", () => {
    it("lowercases and strips non-alphanumeric", () => {
      expect(canonicalToken("IQ Combiner BOX-5")).toBe("iqcombinerbox5");
    });

    it("returns empty string for null/undefined", () => {
      expect(canonicalToken(null)).toBe("");
      expect(canonicalToken(undefined)).toBe("");
    });

    it("trims whitespace", () => {
      expect(canonicalToken("  Tesla  ")).toBe("tesla");
    });
  });

  describe("buildCanonicalKey", () => {
    it("joins category|brand|model tokens", () => {
      expect(buildCanonicalKey("MODULE", "REC Solar", "Alpha 405-AA")).toBe(
        "MODULE|recsolar|alpha405aa"
      );
    });

    it("returns null when brand or model is empty", () => {
      expect(buildCanonicalKey("MODULE", "", "Alpha")).toBeNull();
      expect(buildCanonicalKey("MODULE", "REC", "")).toBeNull();
    });

    it("returns null when category is empty", () => {
      expect(buildCanonicalKey("", "REC", "Alpha")).toBeNull();
    });
  });
});
