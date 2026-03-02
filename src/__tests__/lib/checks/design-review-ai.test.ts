/**
 * Tests for AI-powered design review (design-review-ai.ts).
 *
 * Mocks all external dependencies (Anthropic, Drive, HubSpot custom objects)
 * to isolate the parsing, validation, and heartbeat logic.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mocks (must be before imports) ──

const mockCreate = jest.fn();
const mockUpload = jest.fn();
const mockDelete = jest.fn();

jest.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({
    beta: {
      messages: { create: mockCreate },
      files: { upload: mockUpload, delete: mockDelete },
    },
  }),
  CLAUDE_MODELS: { sonnet: "claude-sonnet-test" },
}));

const mockFetchAHJs = jest.fn().mockResolvedValue([]);
const mockFetchUtilities = jest.fn().mockResolvedValue([]);
jest.mock("@/lib/hubspot-custom-objects", () => ({
  fetchAHJsForDeal: (...args: any[]) => mockFetchAHJs(...args),
  fetchUtilitiesForDeal: (...args: any[]) => mockFetchUtilities(...args),
}));

const mockListDrivePdfs = jest.fn();
const mockPickBestPlanset = jest.fn();
const mockDownloadDrivePdf = jest.fn();
jest.mock("@/lib/drive-plansets", () => ({
  extractFolderId: (input: string) => {
    const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim();
    return null;
  },
  listDrivePdfs: (...args: any[]) => mockListDrivePdfs(...args),
  pickBestPlanset: (...args: any[]) => mockPickBestPlanset(...args),
  downloadDrivePdf: (...args: any[]) => mockDownloadDrivePdf(...args),
}));

// ── Imports ──

import { runDesignReview } from "@/lib/checks/design-review-ai";

// ── Helpers ──

const DEAL_ID = "deal-123";

/** Minimal deal properties with a design folder. */
const baseProperties: Record<string, string | null> = {
  design_documents: "https://drive.google.com/drive/folders/abc123folderId",
  system_size_kw: "8.5",
  module_type: "REC 400AA",
  module_count: "20",
  inverter_type: "SolarEdge SE7600H",
  battery_type: null,
  battery_count: null,
  roof_type: "comp shingle",
};

/** Set up the Drive + Anthropic mocks for a successful flow through to the Claude call. */
function setupHappyPath() {
  mockListDrivePdfs.mockResolvedValue([
    { id: "file-1", name: "Planset_stamped.pdf", modifiedTime: "2026-01-01T00:00:00Z" },
  ]);
  mockPickBestPlanset.mockReturnValue({
    id: "file-1",
    name: "Planset_stamped.pdf",
    modifiedTime: "2026-01-01T00:00:00Z",
  });
  mockDownloadDrivePdf.mockResolvedValue({
    buffer: Buffer.from("fake-pdf"),
    filename: "Planset_stamped.pdf",
  });
  mockUpload.mockResolvedValue({ id: "anthro-file-id" });
  mockDelete.mockResolvedValue({});
}

/** Build a mock Claude response with the given tool_use input. */
function claudeResponse(toolInput: Record<string, unknown>) {
  return {
    content: [
      { type: "tool_use", name: "submit_findings", input: toolInput },
    ],
  };
}

// ── Tests ──

beforeEach(() => {
  jest.clearAllMocks();
});

describe("runDesignReview", () => {
  describe("happy path", () => {
    it("extracts valid findings and calculates pass/fail", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "ahj_compliance", severity: "error", message: "Missing fire setback on Page 2" },
            { check: "equipment_match", severity: "warning", message: "Module count mismatch" },
            { check: "completeness", severity: "info", message: "All sections present" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.skill).toBe("design-review");
      expect(result.dealId).toBe(DEAL_ID);
      expect(result.findings).toHaveLength(3);
      expect(result.errorCount).toBe(1);
      expect(result.warningCount).toBe(1);
      expect(result.passed).toBe(false); // has error
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("passes when all findings are info/warning (no errors)", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "completeness", severity: "info", message: "All good" },
            { check: "ahj_compliance", severity: "warning", message: "Minor thing" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(1);
    });
  });

  describe("P0: empty/invalid findings → error, not false pass", () => {
    it("returns error when findings array is empty", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(claudeResponse({ findings: [] }));

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].severity).toBe("error");
      expect(result.findings[0].message).toMatch(/zero valid findings/);
    });

    it("returns error when all findings have empty check/message", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "", severity: "info", message: "something" },
            { check: "ahj_compliance", severity: "error", message: "" },
            { check: "", severity: "warning", message: "" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toMatch(/zero valid findings/);
      expect(result.findings[0].message).toMatch(/3 entries before validation/);
    });

    it("returns error when findings is not an array", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(claudeResponse({ findings: "oops" }));

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toMatch(/zero valid findings/);
    });

    it("returns error when findings key is missing entirely", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(claudeResponse({}));

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
    });

    it("filters out non-object findings and fails if none remain", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({ findings: [null, 42, "string", true] }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toMatch(/zero valid findings/);
    });
  });

  describe("no tool_use block", () => {
    it("returns error when Claude response has no tool_use", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "I could not review this." }],
      });

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].message).toMatch(/no tool use in response/);
    });
  });

  describe("severity normalization", () => {
    it("downgrades unknown severity to warning", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "completeness", severity: "critical", message: "Something bad" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.findings[0].severity).toBe("warning");
    });
  });

  describe("early exits", () => {
    it("returns error when no design folder on deal", async () => {
      const props = { ...baseProperties, design_documents: null, design_document_folder_id: null, all_document_parent_folder_id: null };

      const result = await runDesignReview(DEAL_ID, props);

      expect(result.passed).toBe(false);
      expect(result.findings[0].message).toMatch(/No design folder/);
      // Should NOT have called Anthropic
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("returns error when folder has no PDFs", async () => {
      mockListDrivePdfs.mockResolvedValue([]);

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.findings[0].message).toMatch(/No PDF files found/);
    });

    it("returns error when pickBestPlanset returns null", async () => {
      mockListDrivePdfs.mockResolvedValue([{ id: "f1", name: "junk.pdf" }]);
      mockPickBestPlanset.mockReturnValue(null);

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.passed).toBe(false);
      expect(result.findings[0].message).toMatch(/Could not select a planset/);
    });
  });

  describe("heartbeat callback", () => {
    it("calls heartbeat at 3 milestones during successful review", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [{ check: "completeness", severity: "info", message: "OK" }],
        }),
      );
      const heartbeat = jest.fn().mockResolvedValue(undefined);

      await runDesignReview(DEAL_ID, baseProperties, heartbeat);

      expect(heartbeat).toHaveBeenCalledTimes(3);
    });

    it("works without heartbeat (undefined)", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [{ check: "completeness", severity: "info", message: "OK" }],
        }),
      );

      // Should not throw
      const result = await runDesignReview(DEAL_ID, baseProperties);
      expect(result.passed).toBe(true);
    });
  });

  describe("Files API cleanup", () => {
    it("cleans up uploaded file after successful review", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [{ check: "completeness", severity: "info", message: "OK" }],
        }),
      );

      await runDesignReview(DEAL_ID, baseProperties);

      expect(mockDelete).toHaveBeenCalledWith("anthro-file-id");
    });

    it("cleans up uploaded file even when Claude call throws", async () => {
      setupHappyPath();
      mockCreate.mockRejectedValue(new Error("API timeout"));

      await expect(runDesignReview(DEAL_ID, baseProperties)).rejects.toThrow("API timeout");

      expect(mockDelete).toHaveBeenCalledWith("anthro-file-id");
    });

    it("does not call delete when upload was never reached", async () => {
      mockListDrivePdfs.mockResolvedValue([]);

      await runDesignReview(DEAL_ID, baseProperties);

      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("field filtering", () => {
    it("includes optional field when present in finding", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "ahj_compliance", severity: "error", message: "Missing setback", field: "fire_setback_ridge" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.findings[0].field).toBe("fire_setback_ridge");
    });

    it("omits field property when not in finding", async () => {
      setupHappyPath();
      mockCreate.mockResolvedValue(
        claudeResponse({
          findings: [
            { check: "completeness", severity: "info", message: "Looks complete" },
          ],
        }),
      );

      const result = await runDesignReview(DEAL_ID, baseProperties);

      expect(result.findings[0]).not.toHaveProperty("field");
    });
  });
});
