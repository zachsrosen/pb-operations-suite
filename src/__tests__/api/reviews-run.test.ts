/**
 * Tests for POST /api/reviews/run
 * Validates auth, role authorization, input validation, and successful review execution.
 */

const mockCreate = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    projectReview: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(),
}));

jest.mock("@/lib/checks/runner", () => ({
  runChecks: jest.fn(),
}));

// Mock the side-effect check module imports so they don't try to register real checks
jest.mock("@/lib/checks/design-review", () => ({}));
jest.mock("@/lib/checks/engineering-review", () => ({}));
jest.mock("@/lib/checks/sales-advisor", () => ({}));

// Mock the HubSpot client (dynamically imported in the route)
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
// hubspotClient is already mocked above via jest.mock

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

  it("returns 200 with review result when everything is valid", async () => {
    (requireApiAuth as jest.Mock).mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    mockGetById.mockResolvedValue({
      properties: {
        dealname: "PROJ-1234 Smith Residence",
        dealstage: "qualifiedtobuy",
        pipeline: "default",
      },
    });

    const mockResult = {
      skill: "design-review",
      dealId: "123",
      findings: [
        { check: "test-check", severity: "warning", message: "Something off" },
      ],
      errorCount: 0,
      warningCount: 1,
      passed: true,
      durationMs: 42,
    };
    (runChecks as jest.Mock).mockResolvedValue(mockResult);

    mockCreate.mockResolvedValue({ id: "review-abc", ...mockResult });

    const res = await POST(makeRequest({ dealId: "123", skill: "design-review" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("review-abc");
    expect(body.passed).toBe(true);
    expect(body.warningCount).toBe(1);
    expect(body.findings).toHaveLength(1);

    // Verify runChecks was called with correct args
    expect(runChecks).toHaveBeenCalledWith("design-review", {
      dealId: "123",
      properties: expect.objectContaining({ dealname: "PROJ-1234 Smith Residence" }),
    });

    // Verify prisma.projectReview.create was called with correct data
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dealId: "123",
          projectId: "PROJ-1234",
          skill: "design-review",
          trigger: "manual",
          triggeredBy: "admin@test.com",
          passed: true,
        }),
      })
    );
  });
});
