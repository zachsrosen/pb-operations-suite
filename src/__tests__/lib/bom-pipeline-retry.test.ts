/**
 * Tests for BOM pipeline auto-retry, escalation, and location routing.
 *
 * Covers (minimum pre-deploy set):
 *   1. fetchContactDetails retries on 5xx/429, returns null on 400/404
 *   2. escalateToClaudeAnalysis always clears timeout when messages.create() throws
 *   3. withRetry updates shared RetryObservation even after a 2-attempt failure
 *   4. Location recipient routing: correct per location, deduped, unknown/empty fallback
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Prisma (imported by bom-pipeline via db)
jest.mock("@/lib/db", () => ({
  prisma: {
    bomPipelineRun: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
  logActivity: jest.fn(),
}));

// Mock Anthropic client (imported by bom-pipeline via anthropic)
const mockCreate = jest.fn();
jest.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  CLAUDE_MODELS: { haiku: "claude-haiku-test", sonnet: "claude-sonnet-test" },
}));

// Mock heavy/ESM dependencies that bom-pipeline imports
jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: jest.fn() }));
jest.mock("@/components/BomPdfDocument", () => ({ BomPdfDocument: jest.fn() }));
jest.mock("@/lib/google-auth", () => ({ getServiceAccountToken: jest.fn() }));
jest.mock("@/lib/bom-extract", () => ({ extractBomFromPdf: jest.fn() }));
jest.mock("@/lib/bom-snapshot", () => ({ saveBomSnapshot: jest.fn() }));
jest.mock("@/lib/bom-so-create", () => ({ createSalesOrder: jest.fn() }));
jest.mock("@/lib/hubspot", () => ({ fetchPrimaryContactId: jest.fn() }));
jest.mock("@/lib/email", () => {
  const actual = jest.requireActual("@/lib/email");
  return {
    ...actual,
    sendPipelineNotification: jest.fn(),
  };
});
jest.mock("@/lib/actor-context", () => ({ PIPELINE_ACTOR: { type: "system", id: "pipeline" } }));
jest.mock("@/lib/bom-pipeline-lock", () => ({
  acquirePipelineLock: jest.fn(),
  DuplicateRunError: class DuplicateRunError extends Error { constructor(id: string) { super(id); this.name = "DuplicateRunError"; } },
}));

// Mock global fetch for fetchContactDetails tests
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Set env vars BEFORE module load (module-level consts read process.env at import time)
process.env.PIPELINE_AI_ESCALATION_ENABLED = "true";
process.env.PIPELINE_AUTO_RETRY_ENABLED = "true";

// Speed up retry delays
jest.useFakeTimers({ advanceTimers: true });

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  fetchContactDetails,
  escalateToClaudeAnalysis,
  isRetryableError,
  withRetry,
  pickBestPlanset,
  type RetryObservation,
} from "@/lib/bom-pipeline";
import { getPipelineLocationRecipients, resolvePipelineRecipients } from "@/lib/email";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeContactResponse() {
  return makeResponse(200, {
    properties: {
      firstname: "Jane",
      lastname: "Doe",
      company: "Acme",
      email: "jane@acme.com",
      phone: "555-1234",
      mobilephone: null,
    },
  });
}

// ── 1. fetchContactDetails ───────────────────────────────────────────────────

describe("fetchContactDetails", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, HUBSPOT_ACCESS_TOKEN: "test-token" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns contact data on 200", async () => {
    mockFetch.mockResolvedValueOnce(makeContactResponse());

    const result = await fetchContactDetails("contact-1");

    expect(result).toEqual({
      fullName: "Doe, Jane",
      lastName: "Doe",
      company: "Acme",
      email: "jane@acme.com",
      phone: "555-1234",
    });
  });

  it("returns null on 404 (contact not found)", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404));
    const result = await fetchContactDetails("contact-missing");
    expect(result).toBeNull();
    // Should NOT have been called a second time (no retry)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null on 400 (bad request)", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(400));
    const result = await fetchContactDetails("bad-id");
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on 500 (server error) — retryable by withRetry", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(500, { message: "Internal Server Error" }),
    );

    await expect(fetchContactDetails("contact-1")).rejects.toThrow(
      /HubSpot contact API 500/,
    );
  });

  it("throws on 429 (rate limited) — retryable by withRetry", async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(429, { message: "Rate limit exceeded" }),
    );

    await expect(fetchContactDetails("contact-1")).rejects.toThrow(
      /HubSpot contact API 429/,
    );
  });

  it("returns null when HUBSPOT_ACCESS_TOKEN is missing", async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    const result = await fetchContactDetails("contact-1");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── 2. escalateToClaudeAnalysis — timeout always cleared ─────────────────────

describe("escalateToClaudeAnalysis — timeout cleanup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      PIPELINE_AI_ESCALATION_ENABLED: "true",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const baseParams = {
    dealId: "deal-1",
    dealName: "Test Deal",
    failedStep: "EXTRACT_BOM" as const,
    errorMessage: "Anthropic API 500: Internal Server Error",
    runId: "run-1",
    attempt: 2,
  };

  it("clears timeout when messages.create() succeeds", async () => {
    const clearSpy = jest.spyOn(global, "clearTimeout");

    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: '{"shouldRetry": true, "reasoning": "Transient 500"}' },
      ],
    });

    await escalateToClaudeAnalysis(baseParams);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("clears timeout when messages.create() throws", async () => {
    const clearSpy = jest.spyOn(global, "clearTimeout");

    mockCreate.mockRejectedValueOnce(new Error("Network failure"));

    // Should return null (safe fallback), not throw
    const result = await escalateToClaudeAnalysis(baseParams);
    expect(result).toBeNull();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("returns null when response is not valid JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I cannot determine this" }],
    });

    const result = await escalateToClaudeAnalysis(baseParams);
    expect(result).toBeNull();
  });

  it("returns null when response has invalid schema", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: '{"shouldRetry": "yes", "reasoning": 123}' },
      ],
    });

    const result = await escalateToClaudeAnalysis(baseParams);
    expect(result).toBeNull();
  });

  it("parses valid retry=true response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"shouldRetry": true, "reasoning": "Transient Anthropic 500 — safe to retry"}',
        },
      ],
    });

    const result = await escalateToClaudeAnalysis(baseParams);
    expect(result).toEqual({
      shouldRetry: true,
      reasoning: "Transient Anthropic 500 — safe to retry",
    });
  });

  it("parses valid retry=false response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '{"shouldRetry": false, "reasoning": "Missing planset — permanent error"}',
        },
      ],
    });

    const result = await escalateToClaudeAnalysis(baseParams);
    expect(result).toEqual({
      shouldRetry: false,
      reasoning: "Missing planset — permanent error",
    });
  });
});

// ── 3. withRetry + RetryObservation ──────────────────────────────────────────

describe("withRetry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, PIPELINE_AUTO_RETRY_ENABLED: "true" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns result on first attempt success", async () => {
    const obs: RetryObservation = { attempt: 0, retried: false };
    const fn = jest.fn().mockResolvedValue("ok");

    const { result, attempt, retried } = await withRetry("FETCH_DEAL", fn, obs);

    expect(result).toBe("ok");
    expect(attempt).toBe(1);
    expect(retried).toBe(false);
    expect(obs.attempt).toBe(1);
    expect(obs.retried).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds on attempt 2", async () => {
    const obs: RetryObservation = { attempt: 0, retried: false };
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("HubSpot API 502: Bad Gateway"))
      .mockResolvedValueOnce("recovered");

    const promise = withRetry("FETCH_DEAL", fn, obs);
    // Advance timers to skip the sleep delay
    jest.advanceTimersByTime(10_000);
    const { result, attempt, retried, retryReason } = await promise;

    expect(result).toBe("recovered");
    expect(attempt).toBe(2);
    expect(retried).toBe(true);
    expect(retryReason).toMatch(/502/);
    expect(obs.attempt).toBe(2);
    expect(obs.retried).toBe(true);
    expect(obs.retryReason).toMatch(/502/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("updates RetryObservation even when both attempts fail", async () => {
    const obs: RetryObservation = { attempt: 0, retried: false };
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error("HubSpot API 500: Internal Server Error"))
      .mockRejectedValueOnce(new Error("HubSpot API 500: still broken"));

    const promise = withRetry("FETCH_DEAL", fn, obs);
    jest.advanceTimersByTime(10_000);

    await expect(promise).rejects.toThrow(/still broken/);

    // Key assertion: obs is updated with retry metadata even on failure
    expect(obs.attempt).toBe(2);
    expect(obs.retried).toBe(true);
    expect(obs.retryReason).toMatch(/500/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry non-retryable errors", async () => {
    const obs: RetryObservation = { attempt: 0, retried: false };
    const fn = jest.fn().mockRejectedValueOnce(
      new Error("No PDF files found in Drive folder"),
    );

    await expect(withRetry("FETCH_DEAL", fn, obs)).rejects.toThrow(/No PDF files/);

    expect(obs.attempt).toBe(1);
    expect(obs.retried).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── 4. isRetryableError ──────────────────────────────────────────────────────

describe("isRetryableError", () => {
  const policy = {
    maxAttempts: 2,
    baseDelayMs: 1000,
    jitterMs: 500,
    retryableStatuses: [500, 502, 503, 429],
    retryablePatterns: [/ECONNRESET/i, /fetch failed/i],
  };

  it("matches status codes embedded in error message", () => {
    expect(isRetryableError(new Error("HubSpot API 502: Bad Gateway"), policy)).toBe(true);
    expect(isRetryableError(new Error("Rate limit 429"), policy)).toBe(true);
  });

  it("matches regex patterns", () => {
    expect(isRetryableError(new Error("ECONNRESET"), policy)).toBe(true);
    expect(isRetryableError(new Error("fetch failed: timeout"), policy)).toBe(true);
  });

  it("rejects non-retryable errors", () => {
    expect(isRetryableError(new Error("No design_documents folder"), policy)).toBe(false);
    expect(isRetryableError(new Error("Unauthorized 401"), policy)).toBe(false);
  });
});

// ── 5. Location recipient routing ────────────────────────────────────────────

describe("getPipelineLocationRecipients", () => {
  it("returns director + coordinator for Westminster", () => {
    const result = getPipelineLocationRecipients("Westminster");
    expect(result).toContain("joe@photonbrothers.com");
    expect(result).toContain("brittany.miller@photonbrothers.com");
    expect(result).toHaveLength(2);
  });

  it("returns director + coordinator for Centennial", () => {
    const result = getPipelineLocationRecipients("Centennial");
    expect(result).toContain("drew@photonbrothers.com");
    expect(result).toContain("brittany.miller@photonbrothers.com");
    expect(result).toHaveLength(2);
  });

  it("returns director + coordinator for Colorado Springs", () => {
    const result = getPipelineLocationRecipients("Colorado Springs");
    expect(result).toContain("rolando@photonbrothers.com");
    expect(result).toContain("brittany.miller@photonbrothers.com");
    expect(result).toHaveLength(2);
  });

  it("returns nick + kat for San Luis Obispo", () => {
    const result = getPipelineLocationRecipients("San Luis Obispo");
    expect(result).toContain("nick.scarpellino@photonbrothers.com");
    expect(result).toContain("kat@photonbrothers.com");
    expect(result).toHaveLength(2);
  });

  it("returns nick + kat for Camarillo", () => {
    const result = getPipelineLocationRecipients("Camarillo");
    expect(result).toContain("nick.scarpellino@photonbrothers.com");
    expect(result).toContain("kat@photonbrothers.com");
    expect(result).toHaveLength(2);
  });

  it("returns empty array for unknown location", () => {
    expect(getPipelineLocationRecipients("Narnia")).toEqual([]);
  });

  it("returns empty array for undefined location", () => {
    expect(getPipelineLocationRecipients(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(getPipelineLocationRecipients("")).toEqual([]);
  });

  it("does not contain duplicates (nick appears in both SLO and Camarillo)", () => {
    const slo = getPipelineLocationRecipients("San Luis Obispo");
    const cam = getPipelineLocationRecipients("Camarillo");
    // Each location set itself should have no dupes
    expect(new Set(slo).size).toBe(slo.length);
    expect(new Set(cam).size).toBe(cam.length);
  });
});

describe("resolvePipelineRecipients", () => {
  it("puts SLO location recipients in To and configured recipients in Bcc", () => {
    const resolved = resolvePipelineRecipients({
      pbLocation: "San Luis Obispo",
      configuredRecipientsRaw: "zach@photonbrothers.com, ops@photonbrothers.com",
    });

    expect(resolved.to).toEqual([
      "nick.scarpellino@photonbrothers.com",
      "kat@photonbrothers.com",
    ]);
    expect(resolved.bcc).toEqual([
      "zach@photonbrothers.com",
      "ops@photonbrothers.com",
    ]);
  });

  it("dedupes configured recipients already present in To", () => {
    const resolved = resolvePipelineRecipients({
      pbLocation: "San Luis Obispo",
      configuredRecipientsRaw: "nick.scarpellino@photonbrothers.com, kat@photonbrothers.com, zach@photonbrothers.com",
    });

    expect(resolved.to).toEqual([
      "nick.scarpellino@photonbrothers.com",
      "kat@photonbrothers.com",
    ]);
    expect(resolved.bcc).toEqual(["zach@photonbrothers.com"]);
  });

  it("falls back to configured recipients when location is unknown", () => {
    const resolved = resolvePipelineRecipients({
      pbLocation: "Narnia",
      configuredRecipientsRaw: "zach@photonbrothers.com, ops@photonbrothers.com",
    });

    expect(resolved.to).toEqual(["zach@photonbrothers.com"]);
    expect(resolved.bcc).toEqual(["ops@photonbrothers.com"]);
  });
});

// ── 7. pickBestPlanset — document selection ────────────────────────────────

describe("pickBestPlanset", () => {
  function file(name: string, id = "file-1", size?: string): { id: string; name: string; modifiedTime: string; size?: string } {
    return { id, name, modifiedTime: "2026-03-01T00:00:00Z", ...(size ? { size } : {}) };
  }

  it("prefers stamped files of comparable size", () => {
    const result = pickBestPlanset([
      file("PROJ-8904 Sobrevilla Stamped Planset.pdf", "stamped", "20000000"),
      file("PROJ-8904 Sobrevilla Planset.pdf", "plain", "25000000"),
    ]);
    expect(result?.id).toBe("stamped");
  });

  it("prefers stamped files when no size info is available", () => {
    const result = pickBestPlanset([
      file("PROJ-8904 Sobrevilla Stamped Planset.pdf", "stamped"),
      file("PROJ-8904 Sobrevilla Planset.pdf", "plain"),
    ]);
    expect(result?.id).toBe("stamped");
  });

  it("prefers planset over generic PDFs", () => {
    const result = pickBestPlanset([
      file("Some random document.pdf", "random"),
      file("PROJ-8904 Planset 02.27.2026.pdf", "planset"),
    ]);
    expect(result?.id).toBe("planset");
  });

  it("excludes response letters", () => {
    const result = pickBestPlanset([
      file("Response letter PROJ-8904 Sobrevilla REV_D 02.27.2026.pdf", "response"),
      file("PROJ-8904 Sobrevilla Planset.pdf", "planset"),
    ]);
    expect(result?.id).toBe("planset");
  });

  it("excludes revision response/comment documents", () => {
    const result = pickBestPlanset([
      file("Revision Response PROJ-8904.pdf", "rev-response"),
      file("Plan Check Comments PROJ-8904.pdf", "check-comments"),
      file("PROJ-8904 Sobrevilla.pdf", "real"),
    ]);
    expect(result?.id).toBe("real");
  });

  it("excludes cover letters, permit apps, invoices, proposals, contracts", () => {
    const excluded = [
      file("Cover Letter PROJ-8904.pdf", "cover"),
      file("Permit App PROJ-8904.pdf", "permit"),
      file("Invoice 12345.pdf", "invoice"),
      file("Proposal PROJ-8904.pdf", "proposal"),
      file("Contract PROJ-8904.pdf", "contract"),
    ];
    const planset = file("PROJ-8904 Sobrevilla 02.27.2026.pdf", "planset");
    const result = pickBestPlanset([...excluded, planset]);
    expect(result?.id).toBe("planset");
  });

  it("falls back to newest non-excluded PDF when no stamped/planset keywords", () => {
    const result = pickBestPlanset([
      file("Response letter PROJ-8904.pdf", "response"),
      file("PROJ-8904 Sobrevilla 02.27.2026.pdf", "newest"),
    ]);
    expect(result?.id).toBe("newest");
  });

  it("falls back to original list if ALL files are excluded (with warning)", () => {
    const result = pickBestPlanset([
      file("Response letter PROJ-8904.pdf", "only-file"),
    ]);
    // Should still return something (the warning fallback)
    expect(result?.id).toBe("only-file");
  });

  it("returns null for empty list", () => {
    expect(pickBestPlanset([])).toBeNull();
  });

  it("skips tiny stamped file when much larger planset exists (PROJ-9530 barn plans)", () => {
    // Exact scenario: "Stamped barn plans" at 2.8MB matched /stamped/i
    // but the actual planset is the 29MB PROJ file
    const files = [
      file("Design Approval | Cool, Monte | 535 Avila Beach Dr, Avila Beach, CA 93424", "da", "1900000"),
      file("PROJ9530CoolMonte_REV_A0312202669b2d3edf1e35.pdf", "planset", "29400000"),
      file("Stamped barn plans reduced-compressed (1).pdf", "barn", "2800000"),
    ];
    const result = pickBestPlanset(files);
    // Should NOT pick the barn plans just because "stamped" is in the name
    expect(result?.id).toBe("planset");
  });

  it("still picks stamped file when it is the largest or comparable in size", () => {
    const files = [
      file("PROJ-9530 Cool Monte Stamped Plans.pdf", "stamped-real", "28000000"),
      file("PROJ9530CoolMonte_REV_A0312202669b2d3edf1e35.pdf", "rev", "29400000"),
    ];
    const result = pickBestPlanset(files);
    // 28MB is >1/3 of 29MB — stamped preference still holds
    expect(result?.id).toBe("stamped-real");
  });

  it("would have selected the Sobrevilla response letter before the fix", () => {
    // This is the exact scenario from PROJ-8904 — response letter was newest
    const files = [
      file("Response letter PROJ-8904 Sobrevilla, Saidel REV_D 02.27.2026.pdf", "response"),
      file("PROJ-8904 Sobrevilla, Saidel 01.15.2026.pdf", "planset"),
    ];
    const result = pickBestPlanset(files);
    // With the fix, it should skip the response letter
    expect(result?.id).toBe("planset");
  });
});
