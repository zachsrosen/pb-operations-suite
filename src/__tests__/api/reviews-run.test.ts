/**
 * Tests for POST /api/reviews/run
 * Validates auth, role authorization, input validation, and async review start.
 *
 * The route now uses acquireReviewLock() → immediate 200 → background execution.
 * These tests validate the synchronous response path only; the background worker
 * is tested separately via review-lock and runner unit tests.
 */

const mockAcquireReviewLock = jest.fn();

jest.mock("@/lib/review-lock", () => {
  const { DuplicateReviewError } = jest.requireActual("@/lib/review-lock");
  return {
    acquireReviewLock: (...args: unknown[]) => mockAcquireReviewLock(...args),
    completeReviewRun: jest.fn().mockResolvedValue(undefined),
    failReviewRun: jest.fn().mockResolvedValue(undefined),
    touchReviewRun: jest.fn().mockResolvedValue(undefined),
    DuplicateReviewError,
  };
});

jest.mock("@/lib/db", () => ({
  prisma: {},
}));

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(),
}));

jest.mock("@/lib/checks/runner", () => ({
  runChecks: jest.fn(),
}));

// Mock side-effect check module import
jest.mock("@/lib/checks/design-review", () => ({}));

// Mock the HubSpot client (dynamically imported in the background worker)
const mockGetById = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      deals: {
        basicApi: { getById: (...args: unknown[]) => mockGetById(...args) },
      },
    },
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/reviews/run/route";
import { requireApiAuth } from "@/lib/api-auth";
import { runChecks } from "@/lib/checks/runner";
import { DuplicateReviewError } from "@/lib/review-lock";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/reviews/run", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/reviews/run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );

    const res = await POST(makeRequest({ dealId: "123", skill: "design-review" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Authentication required");
  });

  it("returns 403 when user role is not allowed for the skill", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue({
      email: "viewer@test.com",
      role: "VIEWER",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    const res = await POST(makeRequest({ dealId: "123", skill: "design-review" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Insufficient permissions");
  });

  it("returns 400 for invalid skill name", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    const res = await POST(makeRequest({ dealId: "123", skill: "bogus-skill" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("skill must be one of");
  });

  it("returns 200 with running status when lock acquired", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    mockAcquireReviewLock.mockResolvedValue("review-abc");

    // Background worker mocks (fire-and-forget — prevent unhandled rejections)
    mockGetById.mockResolvedValue({
      properties: { dealname: "PROJ-1234 Smith", dealstage: "qualifiedtobuy" },
    });
    (runChecks as jest.Mock).mockResolvedValue({
      findings: [],
      errorCount: 0,
      warningCount: 0,
      passed: true,
      durationMs: 10,
    });

    const res = await POST(makeRequest({ dealId: "123", skill: "design-review" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("review-abc");
    expect(body.status).toBe("running");

    // Verify lock was acquired with correct args
    expect(mockAcquireReviewLock).toHaveBeenCalledWith(
      "123",
      "design-review",
      "manual",
      "admin@test.com",
    );
  });

  it("returns 409 when review is already running (attach flow)", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    mockAcquireReviewLock.mockRejectedValue(
      new DuplicateReviewError("123", "design-review", "existing-review-xyz")
    );

    const res = await POST(makeRequest({ dealId: "123", skill: "design-review" }));
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.status).toBe("already_running");
    expect(body.existingReviewId).toBe("existing-review-xyz");
  });
});
