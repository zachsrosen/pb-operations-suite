jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: {
      findMany: jest.fn(),
    },
  },
}));

import { normalizeIdentityModel, extractModelFamily, pickUniqueInternalCandidate } from "@/lib/bom-catalog-match";
import type { InternalAliasCandidate } from "@/lib/bom-catalog-match";

describe("bom-catalog-match helpers", () => {
  describe("normalizeIdentityModel", () => {
    it("uppercases and trims", () => {
      expect(normalizeIdentityModel("  seg-440-btd-bg  ")).toBe("SEG-440-BTD-BG");
    });
  });

  describe("extractModelFamily", () => {
    it("extracts family prefix from structured part number", () => {
      expect(extractModelFamily("1707000-21-K")).toBe("1707000");
    });

    it("returns null for non-structured models", () => {
      expect(extractModelFamily("XR-10")).toBeNull();
    });

    it("extracts family from longer structured models", () => {
      expect(extractModelFamily("1841000-X1-Y")).toBe("1841000");
    });
  });

  describe("pickUniqueInternalCandidate", () => {
    const candidateA: InternalAliasCandidate = { id: "a", model: "M1", canonicalKey: "k1" };
    const candidateB: InternalAliasCandidate = { id: "b", model: "M2", canonicalKey: "k2" };

    it("returns the single candidate", () => {
      expect(pickUniqueInternalCandidate([candidateA])).toBe(candidateA);
    });

    it("returns null for empty array", () => {
      expect(pickUniqueInternalCandidate([])).toBeNull();
    });

    it("returns null for multiple candidates (ambiguous)", () => {
      expect(pickUniqueInternalCandidate([candidateA, candidateB])).toBeNull();
    });
  });
});
