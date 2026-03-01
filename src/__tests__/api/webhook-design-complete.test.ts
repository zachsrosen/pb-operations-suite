/**
 * Tests for POST /api/webhooks/hubspot/design-complete
 *
 * Covers Gate 4 requirements:
 *   1. Signature validation — rejects invalid signatures
 *   2. Dedupe — concurrent duplicate webhooks for the same deal are skipped
 *   3. Feature flag — disabled when DESIGN_COMPLETE_AUTO_ENABLED !== "true"
 *   4. Stage filtering — events for non-matching stages are ignored
 *   5. Stale lock recovery — old RUNNING rows are flipped to FAILED
 */

import crypto from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────
const TEST_SECRET = "test-secret-for-webhooks";
const TEST_URL = "http://localhost:3000/api/webhooks/hubspot/design-complete";

// ── Mock: @vercel/functions ───────────────────────────────────────────────────
const mockWaitUntil = jest.fn();
jest.mock("@vercel/functions", () => ({
  waitUntil: (...args: unknown[]) => mockWaitUntil(...args),
}));

// ── Mock: pipeline orchestrator ───────────────────────────────────────────────
const mockRunPipeline = jest.fn(async () => ({
  status: "succeeded",
  dealId: "123",
  durationMs: 1000,
}));
jest.mock("@/lib/bom-pipeline", () => ({
  runDesignCompletePipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

// ── Mock: Prisma ──────────────────────────────────────────────────────────────
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    bomPipelineRun: {
      create: (...args: unknown[]) => mockCreate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Execute the transaction callback with the same mock methods
      return fn({
        bomPipelineRun: {
          create: (...args: unknown[]) => mockCreate(...args),
          updateMany: (...args: unknown[]) => mockUpdateMany(...args),
        },
      });
    },
  },
  logActivity: jest.fn(async () => {}),
}));

// ── Mock: webhook auth (use real implementation for signature tests) ─────────
jest.mock("@/lib/hubspot-webhook-auth", () => {
  const actual = jest.requireActual("@/lib/hubspot-webhook-auth");
  return actual;
});

// ── Mock: actor-context ─────────────────────────────────────────────────────
jest.mock("@/lib/actor-context", () => ({
  PIPELINE_ACTOR: {
    email: "pipeline@system",
    name: "BOM Pipeline",
    requestPath: "bom-pipeline",
    requestMethod: "INTERNAL",
  },
}));

// ── Route under test ──────────────────────────────────────────────────────────
import { POST } from "@/app/api/webhooks/hubspot/design-complete/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWebhookPayload(overrides: Partial<{
  eventId: number;
  subscriptionType: string;
  propertyName: string;
  propertyValue: string;
  objectId: number;
}> = {}) {
  return [{
    eventId: overrides.eventId ?? 1001,
    subscriptionType: overrides.subscriptionType ?? "deal.propertyChange",
    propertyName: overrides.propertyName ?? "dealstage",
    propertyValue: overrides.propertyValue ?? "some-stage-id",
    objectId: overrides.objectId ?? 12345,
  }];
}

function sign(body: string, timestamp: string, secret = TEST_SECRET): string {
  const source = "POST" + TEST_URL + body + timestamp;
  return crypto.createHmac("sha256", secret).update(source, "utf8").digest("base64");
}

function makeSignedRequest(body: string, secret = TEST_SECRET): NextRequest {
  const timestamp = String(Date.now());
  const signature = sign(body, timestamp, secret);
  return new NextRequest(TEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hubspot-signature-v3": signature,
      "x-hubspot-request-timestamp": timestamp,
    },
    body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/hubspot/design-complete", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HUBSPOT_WEBHOOK_SECRET = TEST_SECRET;
    process.env.DESIGN_COMPLETE_AUTO_ENABLED = "true";
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "";
    delete process.env.PIPELINE_STAGE_CONFIG;

    // Default: create succeeds
    mockCreate.mockResolvedValue({ id: "run_abc123" });
    mockUpdateMany.mockResolvedValue({ count: 0 });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Signature validation ──

  it("rejects requests with invalid signature", async () => {
    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body, "wrong-secret");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid signature", async () => {
    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // ── Feature flag ──

  it("returns 200 with disabled status when feature flag is off", async () => {
    process.env.DESIGN_COMPLETE_AUTO_ENABLED = "false";
    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("disabled");
  });

  // ── Stage filtering ──

  it("ignores events for non-matching stages when DESIGN_COMPLETE_TARGET_STAGES is set", async () => {
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "target-stage-1,target-stage-2";
    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "wrong-stage" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual([]);
  });

  it("processes events for matching stages", async () => {
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "target-stage-1,target-stage-2";
    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "target-stage-1" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toContain("12345:started");
  });

  it("skips events with missing propertyValue when stage allowlist is configured", async () => {
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "target-stage-1";
    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual([]);
  });

  // ── Dedupe: concurrent webhooks ──

  it("skips duplicate webhook when RUNNING row already exists (P2002)", async () => {
    // First call succeeds, second hits unique constraint
    mockCreate
      .mockResolvedValueOnce({ id: "run_first" })
      .mockRejectedValueOnce({ code: "P2002", message: "Unique constraint" });

    // First webhook
    const body1 = JSON.stringify(makeWebhookPayload({ eventId: 1001 }));
    const req1 = makeSignedRequest(body1);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.triggered).toContain("12345:started");

    // Second webhook (same dealId) — should be skipped
    const body2 = JSON.stringify(makeWebhookPayload({ eventId: 1002 }));
    const req2 = makeSignedRequest(body2);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.triggered).toContain("12345:skipped");
  });

  // ── Dedupe: stale lock recovery ──

  it("recovers stale RUNNING locks before inserting new row", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 }); // 1 stale lock recovered
    mockCreate.mockResolvedValue({ id: "run_new" });

    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify stale lock recovery was attempted
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dealId: "12345",
          status: "RUNNING",
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("stale lock"),
        }),
      }),
    );

    // Verify new RUNNING row was created
    expect(mockCreate).toHaveBeenCalled();
  });

  // ── Event filtering ──

  it("ignores non-dealstage property changes", async () => {
    const body = JSON.stringify(makeWebhookPayload({ propertyName: "amount" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual([]);
  });

  it("ignores non-deal.propertyChange subscription types", async () => {
    const body = JSON.stringify(makeWebhookPayload({ subscriptionType: "contact.propertyChange" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual([]);
  });

  // ── Pipeline execution ──

  it("calls waitUntil with the pipeline promise", async () => {
    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body);
    await POST(req);

    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("handles multiple events in a single payload", async () => {
    mockCreate
      .mockResolvedValueOnce({ id: "run_1" })
      .mockResolvedValueOnce({ id: "run_2" });

    const events = [
      ...makeWebhookPayload({ objectId: 111, eventId: 1 }),
      ...makeWebhookPayload({ objectId: 222, eventId: 2 }),
    ];
    const body = JSON.stringify(events);
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual(["111:started", "222:started"]);
    expect(mockWaitUntil).toHaveBeenCalledTimes(2);
  });

  // ── PIPELINE_STAGE_CONFIG ──

  it("uses PIPELINE_STAGE_CONFIG when set (overrides DESIGN_COMPLETE_TARGET_STAGES)", async () => {
    process.env.PIPELINE_STAGE_CONFIG = "stage-a:design_complete,stage-b:ready_to_build";
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "stage-a,old-stage"; // should be ignored

    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "stage-b" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toContain("12345:started");

    // Verify the trigger type was READY_TO_BUILD
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: "WEBHOOK_READY_TO_BUILD",
      }),
    });
  });

  it("falls back to DESIGN_COMPLETE_TARGET_STAGES when PIPELINE_STAGE_CONFIG is unset", async () => {
    delete process.env.PIPELINE_STAGE_CONFIG;
    process.env.DESIGN_COMPLETE_TARGET_STAGES = "fallback-stage";

    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "fallback-stage" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toContain("12345:started");
  });

  it("skips malformed entries in PIPELINE_STAGE_CONFIG", async () => {
    // "bad-entry" has no colon separator — should be skipped
    // "stage-ok:design_complete" is valid — should work
    process.env.PIPELINE_STAGE_CONFIG = "bad-entry,stage-ok:design_complete,also:invalid_type";

    const body = JSON.stringify(makeWebhookPayload({ propertyValue: "stage-ok" }));
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toContain("12345:started");
  });

  it("returns empty triggered when PIPELINE_STAGE_CONFIG is empty string", async () => {
    process.env.PIPELINE_STAGE_CONFIG = "";
    delete process.env.DESIGN_COMPLETE_TARGET_STAGES;

    const body = JSON.stringify(makeWebhookPayload());
    const req = makeSignedRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.triggered).toEqual([]);
  });
});
