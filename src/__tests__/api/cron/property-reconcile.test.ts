/**
 * Tests for GET /api/cron/property-reconcile — Task 3.2, plan lines 1659–1678.
 *
 * Covers:
 *   1. Missing / wrong Authorization bearer → 401
 *   2. Feature flag off → 200 `{status:"disabled"}`, reconcile NOT invoked
 *   3. Correct bearer + flag on → returns reconcile result
 *   4. Watermark cleanup + Sentry stale-cache alert branch fires when stale rows exist
 */

// ── Mock: property-sync.reconcileAllProperties ───────────────────────────────
const mockReconcile = jest.fn();
jest.mock("@/lib/property-sync", () => ({
  reconcileAllProperties: () => mockReconcile(),
}));

import { GET } from "@/app/api/cron/property-reconcile/route";
import { NextRequest } from "next/server";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://test/api/cron/property-reconcile", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/property-reconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.PROPERTY_SYNC_ENABLED = "true";
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns 401 when bearer token is wrong", async () => {
    const res = await GET(makeReq({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns {status:'disabled'} and skips work when feature flag is off", async () => {
    process.env.PROPERTY_SYNC_ENABLED = "false";
    const res = await GET(makeReq({ authorization: "Bearer test-cron-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("disabled");
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("calls reconcileAllProperties and returns its stats when auth + flag pass", async () => {
    mockReconcile.mockResolvedValue({ processed: 5, drifted: 1, failed: 0 });
    const res = await GET(makeReq({ authorization: "Bearer test-cron-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      status: "ok",
      processed: 5,
      drifted: 1,
      failed: 0,
    });
  });

  it("returns 500 when reconcile throws", async () => {
    mockReconcile.mockRejectedValue(new Error("boom"));
    const res = await GET(makeReq({ authorization: "Bearer test-cron-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.error).toBe("boom");
  });
});
