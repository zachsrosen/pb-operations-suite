// Mock modules that require runtime dependencies (Prisma, HubSpot SDK)
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {},
  searchWithRetry: jest.fn(),
}));

import { diffDealProperties, resolvePipeline, resolveStage } from "@/lib/deal-sync";

describe("deal-sync", () => {
  describe("diffDealProperties", () => {
    it("detects changed fields", () => {
      const existing = { dealName: "Old Name", amount: 5000 };
      const incoming = { dealName: "New Name", amount: 5000 };
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({ dealName: ["Old Name", "New Name"] });
    });

    it("returns empty object when no changes", () => {
      const data = { dealName: "Same", amount: 5000 };
      expect(diffDealProperties(data, data)).toEqual({});
    });

    it("detects null → value changes", () => {
      const existing = { closeDate: null };
      const incoming = { closeDate: new Date("2026-04-10") };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.closeDate).toBeDefined();
    });

    it("detects value → null changes", () => {
      const existing = { amount: 5000 };
      const incoming = { amount: null };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.amount).toEqual([5000, null]);
    });

    it("compares Date values by ISO string (no false diffs for same instant)", () => {
      const d = new Date("2026-04-10T12:00:00.000Z");
      const existing = { closeDate: new Date(d.getTime()) };
      const incoming = { closeDate: new Date(d.getTime()) };
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({});
    });

    it("detects Date changes when instants differ", () => {
      const existing = { closeDate: new Date("2026-04-10T12:00:00.000Z") };
      const incoming = { closeDate: new Date("2026-04-11T12:00:00.000Z") };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.closeDate).toBeDefined();
      expect(diff.closeDate![0]).toEqual(new Date("2026-04-10T12:00:00.000Z"));
      expect(diff.closeDate![1]).toEqual(new Date("2026-04-11T12:00:00.000Z"));
    });

    it("only diffs keys present in the incoming object", () => {
      const existing = { dealName: "Test", amount: 5000 };
      const incoming = { dealName: "Test" };
      // Should not report amount as changed since it's not in incoming
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({});
    });

    it("handles nested JSON by JSON.stringify comparison", () => {
      const existing = { departmentLeads: { design: "Alice" } };
      const incoming = { departmentLeads: { design: "Bob" } };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.departmentLeads).toBeDefined();
    });

    it("treats identical nested JSON as unchanged", () => {
      const existing = { departmentLeads: { design: "Alice", permit: "Bob" } };
      const incoming = { departmentLeads: { design: "Alice", permit: "Bob" } };
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({});
    });

    it("handles boolean changes", () => {
      const existing = { isSiteSurveyScheduled: false };
      const incoming = { isSiteSurveyScheduled: true };
      const diff = diffDealProperties(existing, incoming);
      expect(diff.isSiteSurveyScheduled).toEqual([false, true]);
    });

    it("handles undefined vs null as equivalent", () => {
      const existing = { amount: undefined };
      const incoming = { amount: null };
      // Both serialize to "null" so no diff expected
      const diff = diffDealProperties(existing, incoming);
      expect(diff).toEqual({});
    });
  });

  describe("resolvePipeline", () => {
    it("maps known pipeline IDs to enum", () => {
      expect(resolvePipeline("6900017")).toBe("PROJECT");
      expect(resolvePipeline("21997330")).toBe("DNR");
      expect(resolvePipeline("23928924")).toBe("SERVICE");
      expect(resolvePipeline("765928545")).toBe("ROOFING");
    });

    it("defaults to SALES for default/unknown pipeline", () => {
      expect(resolvePipeline("default")).toBe("SALES");
      expect(resolvePipeline("")).toBe("SALES");
      expect(resolvePipeline(undefined)).toBe("SALES");
    });

    it("defaults to SALES for null", () => {
      expect(resolvePipeline(null as unknown as string)).toBe("SALES");
    });

    it("defaults to SALES for unrecognized numeric ID", () => {
      expect(resolvePipeline("999999999")).toBe("SALES");
    });
  });

  describe("resolveStage", () => {
    // resolveStage reads from the database via prisma.
    // Since prisma is mocked as null, it should fall back to the raw stageId.

    it("falls back to stageId when DB is unavailable", async () => {
      const result = await resolveStage("12345", "SALES");
      expect(result).toBe("12345");
    });

    it("returns raw stageId for any pipeline when DB is unavailable", async () => {
      const result = await resolveStage("20461935", "PROJECT");
      expect(result).toBe("20461935");
    });
  });
});
