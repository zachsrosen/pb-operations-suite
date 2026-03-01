/**
 * Tests for src/lib/bom-email-enrichment.ts
 *
 * Covers:
 *   1. checkBomSnapshotExists — returns true/false based on snapshot presence
 *   2. getBomEmailEnrichment — returns discriminated result types:
 *      - "no_snapshot" when no snapshot exists
 *      - "success" with enrichment data when snapshot exists
 *      - "error" on DB failure (NOT "no_snapshot" — prevents false fallback triggers)
 *   3. Summary line building from BOM data
 *   4. SO info enrichment from snapshot + pipeline run
 *   5. PDF timeout handling (mocked)
 *   6. PDF size cap (mocked)
 */

// ── Mock: Prisma ──────────────────────────────────────────────────────────────
const mockSnapshotFindFirst = jest.fn();
const mockPipelineRunFindFirst = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    projectBomSnapshot: {
      findFirst: (...args: unknown[]) => mockSnapshotFindFirst(...args),
    },
    bomPipelineRun: {
      findFirst: (...args: unknown[]) => mockPipelineRunFindFirst(...args),
    },
  },
}));

// ── Mock: external-links ──────────────────────────────────────────────────────
jest.mock("@/lib/external-links", () => ({
  getZohoSalesOrderUrl: (soId: string) => `https://inventory.zoho.com/so/${soId}`,
}));

// ── Mock: @react-pdf/renderer ─────────────────────────────────────────────────
const mockRenderToBuffer = jest.fn();
jest.mock("@react-pdf/renderer", () => ({
  renderToBuffer: (...args: unknown[]) => mockRenderToBuffer(...args),
}));

// ── Mock: BomPdfDocument ──────────────────────────────────────────────────────
jest.mock("@/components/BomPdfDocument", () => ({
  BomPdfDocument: () => null,
}));

import {
  checkBomSnapshotExists,
  getBomEmailEnrichment,
} from "@/lib/bom-email-enrichment";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_BOM_DATA = {
  project: {
    customer: "Smith",
    systemSizeKwdc: 10.8,
    moduleCount: 27,
  },
  items: [
    { category: "MODULE", brand: "QCells", model: "Q.PEAK DUO", description: "400W Module", qty: 27 },
    { category: "INVERTER", brand: "Tesla", model: "Inverter 7.6", description: "Inverter", qty: 1 },
    { category: "BATTERY", brand: "Tesla", model: "Powerwall 3", description: "Battery", qty: 2 },
    { category: "EV_CHARGER", brand: "Tesla", model: "Wall Connector", description: "EV Charger", qty: 1 },
  ],
};

const SAMPLE_SNAPSHOT = {
  id: "snap_123",
  dealId: "deal-1",
  version: 3,
  bomData: SAMPLE_BOM_DATA,
  zohoSoId: "so_456",
};

// ── Tests: checkBomSnapshotExists ─────────────────────────────────────────────

describe("checkBomSnapshotExists", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when snapshot exists", async () => {
    mockSnapshotFindFirst.mockResolvedValue({ id: "snap_123" });
    const result = await checkBomSnapshotExists("deal-1");
    expect(result).toBe(true);
  });

  it("returns false when no snapshot exists", async () => {
    mockSnapshotFindFirst.mockResolvedValue(null);
    const result = await checkBomSnapshotExists("deal-1");
    expect(result).toBe(false);
  });

  it("queries with correct dealId and select", async () => {
    mockSnapshotFindFirst.mockResolvedValue(null);
    await checkBomSnapshotExists("deal-42");

    expect(mockSnapshotFindFirst).toHaveBeenCalledWith({
      where: { dealId: "deal-42" },
      select: { id: true },
      orderBy: { version: "desc" },
    });
  });
});

// ── Tests: getBomEmailEnrichment ──────────────────────────────────────────────

describe("getBomEmailEnrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: small PDF buffer
    mockRenderToBuffer.mockResolvedValue(Buffer.from("fake-pdf-content"));
    mockPipelineRunFindFirst.mockResolvedValue(null);
  });

  it("returns no_snapshot when no snapshot exists", async () => {
    mockSnapshotFindFirst.mockResolvedValue(null);
    const result = await getBomEmailEnrichment("deal-1", "Test Deal");

    expect(result.status).toBe("no_snapshot");
  });

  it("returns error (NOT no_snapshot) on DB failure", async () => {
    mockSnapshotFindFirst.mockRejectedValue(new Error("Connection refused"));
    const result = await getBomEmailEnrichment("deal-1", "Test Deal");

    // Critical: transient errors must NOT be confused with "no snapshot"
    expect(result.status).toBe("error");
    expect(result.status).not.toBe("no_snapshot");
    if (result.status === "error") {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it("returns success with enrichment data when snapshot exists", async () => {
    mockSnapshotFindFirst.mockResolvedValue(SAMPLE_SNAPSHOT);
    mockPipelineRunFindFirst.mockResolvedValue({ zohoSoNumber: "SO-0789" });

    const result = await getBomEmailEnrichment("deal-1", "Smith Residence");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.enrichment.snapshotVersion).toBe(3);
      expect(result.enrichment.zohoSoUrl).toContain("so_456");
      expect(result.enrichment.zohoSoNumber).toBe("SO-0789");
      expect(result.enrichment.bomSummaryLines.length).toBeGreaterThan(0);
    }
  });

  it("builds summary lines for modules, system size, inverter, battery, EV charger", async () => {
    mockSnapshotFindFirst.mockResolvedValue(SAMPLE_SNAPSHOT);

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    if (result.status === "success") {
      const lines = result.enrichment.bomSummaryLines;
      expect(lines.some(l => l.includes("27x") && l.includes("QCells"))).toBe(true);
      expect(lines.some(l => l.includes("10.8 kWdc"))).toBe(true);
      expect(lines.some(l => l.includes("Inverter"))).toBe(true);
      expect(lines.some(l => l.includes("2x") && l.includes("Powerwall"))).toBe(true);
      expect(lines.some(l => l.includes("EV Charger"))).toBe(true);
    }
  });

  it("omits SO data when snapshot has no zohoSoId", async () => {
    mockSnapshotFindFirst.mockResolvedValue({
      ...SAMPLE_SNAPSHOT,
      zohoSoId: null,
    });

    const result = await getBomEmailEnrichment("deal-1", "Test");

    if (result.status === "success") {
      expect(result.enrichment.zohoSoUrl).toBeUndefined();
      expect(result.enrichment.zohoSoNumber).toBeUndefined();
    }
  });

  it("includes PDF attachment when render succeeds within limits", async () => {
    mockSnapshotFindFirst.mockResolvedValue(SAMPLE_SNAPSHOT);
    mockRenderToBuffer.mockResolvedValue(Buffer.from("small-pdf"));

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    if (result.status === "success") {
      expect(result.enrichment.pdfAttachment).toBeDefined();
      expect(result.enrichment.pdfAttachment!.filename).toContain("BOM-Smith-v3");
      expect(result.enrichment.pdfAttachment!.filename).toMatch(/\.pdf$/);
    }
  });

  it("skips PDF attachment when render times out (fail-open)", async () => {
    mockSnapshotFindFirst.mockResolvedValue(SAMPLE_SNAPSHOT);
    mockRenderToBuffer.mockImplementation(() =>
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 100))
    );

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    // Should still return success — PDF is best-effort
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.enrichment.pdfAttachment).toBeUndefined();
      // Summary lines still present
      expect(result.enrichment.bomSummaryLines.length).toBeGreaterThan(0);
    }
  });

  it("skips PDF when buffer exceeds 5MB", async () => {
    mockSnapshotFindFirst.mockResolvedValue(SAMPLE_SNAPSHOT);
    // Create a buffer > 5MB
    const largeBuf = Buffer.alloc(6 * 1024 * 1024, "x");
    mockRenderToBuffer.mockResolvedValue(largeBuf);

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.enrichment.pdfAttachment).toBeUndefined();
    }
  });

  it("returns error when snapshot dealId does not match input (ownership check)", async () => {
    mockSnapshotFindFirst.mockResolvedValue({
      ...SAMPLE_SNAPSHOT,
      dealId: "different-deal",
    });

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    expect(result.status).toBe("error");
  });

  it("handles empty BOM items gracefully", async () => {
    mockSnapshotFindFirst.mockResolvedValue({
      ...SAMPLE_SNAPSHOT,
      bomData: { project: {}, items: [] },
    });

    const result = await getBomEmailEnrichment("deal-1", "Smith");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.enrichment.bomSummaryLines).toEqual([]);
    }
  });
});
