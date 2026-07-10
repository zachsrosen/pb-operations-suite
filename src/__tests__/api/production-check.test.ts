/**
 * /api/service/production-check route tests — role gating + error mapping.
 * Mock pattern follows rtb-review.test.ts (requireApiAuth mocked), extended
 * with roles per gate.
 */

const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

const mockLib = {
  createProductionCheck: jest.fn(),
  submitSolution: jest.fn(),
  decide: jest.fn(),
  cancelProductionCheck: jest.fn(),
  listProductionChecks: jest.fn(),
  getApproverEmail: jest.fn(),
};
jest.mock("@/lib/production-check", () => {
  class ProductionCheckStateError extends Error {}
  class ProductionCheckValidationError extends Error {}
  return {
    ProductionCheckStateError,
    ProductionCheckValidationError,
    createProductionCheck: (...args: unknown[]) => mockLib.createProductionCheck(...args),
    submitSolution: (...args: unknown[]) => mockLib.submitSolution(...args),
    decide: (...args: unknown[]) => mockLib.decide(...args),
    cancelProductionCheck: (...args: unknown[]) => mockLib.cancelProductionCheck(...args),
    listProductionChecks: (...args: unknown[]) => mockLib.listProductionChecks(...args),
    getApproverEmail: (...args: unknown[]) => mockLib.getApproverEmail(...args),
  };
});

import { NextRequest } from "next/server";
import {
  ProductionCheckStateError,
  ProductionCheckValidationError,
} from "@/lib/production-check";
import { GET, POST } from "@/app/api/service/production-check/route";
import { POST as SOLUTION } from "@/app/api/service/production-check/[id]/solution/route";
import { POST as DECIDE } from "@/app/api/service/production-check/[id]/decide/route";
import { POST as CANCEL } from "@/app/api/service/production-check/[id]/cancel/route";

function req(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/service/production-check", {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = { params: Promise.resolve({ id: "pc-1" }) };

function asUser(email: string, roles: string[]) {
  mockRequireApiAuth.mockResolvedValue({ email, roles });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLib.getApproverEmail.mockResolvedValue("jessica@x");
  mockLib.listProductionChecks.mockResolvedValue([]);
  mockLib.createProductionCheck.mockResolvedValue({ request: { id: "pc-1" } });
  mockLib.submitSolution.mockResolvedValue({ request: { id: "pc-1" } });
  mockLib.decide.mockResolvedValue({ request: { id: "pc-1" } });
  mockLib.cancelProductionCheck.mockResolvedValue({ request: { id: "pc-1" } });
});

describe("GET /api/service/production-check", () => {
  it("returns requests plus viewer capability flags", async () => {
    asUser("jessica@x", ["SERVICE"]);
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.requests).toEqual([]);
    expect(body.viewer).toEqual({ canCreate: true, canSubmitSolution: false, canDecide: true });
  });

  it("computes canDecide=true for ADMIN even when not the configured approver", async () => {
    asUser("admin@x", ["ADMIN"]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.viewer.canDecide).toBe(true);
    expect(body.viewer.canSubmitSolution).toBe(true);
  });

  it("computes designer capabilities for DESIGN role", async () => {
    asUser("designer@x", ["DESIGN"]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.viewer).toEqual({ canCreate: false, canSubmitSolution: true, canDecide: false });
  });
});

describe("POST /api/service/production-check (create)", () => {
  const payload = { dealId: "111", issueSummary: "underproducing" };

  it("allows SERVICE", async () => {
    asUser("jessica@x", ["SERVICE"]);
    const res = await POST(req(payload));
    expect(res.status).toBe(200);
    expect(mockLib.createProductionCheck).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "111", createdByEmail: "jessica@x" }),
    );
  });

  it("rejects DESIGN with 403", async () => {
    asUser("designer@x", ["DESIGN"]);
    const res = await POST(req(payload));
    expect(res.status).toBe(403);
    expect(mockLib.createProductionCheck).not.toHaveBeenCalled();
  });

  it("maps validation errors to 400", async () => {
    asUser("jessica@x", ["SERVICE"]);
    mockLib.createProductionCheck.mockRejectedValue(new ProductionCheckValidationError("bad"));
    const res = await POST(req(payload));
    expect(res.status).toBe(400);
  });

  it("does not leak raw error messages on unexpected failures", async () => {
    asUser("jessica@x", ["SERVICE"]);
    mockLib.createProductionCheck.mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal:5432 schema=neondb"),
    );
    const res = await POST(req(payload));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal error");
  });
});

describe("POST /[id]/solution", () => {
  const payload = { proposedSolution: "replace optimizer" };

  it("allows DESIGN", async () => {
    asUser("designer@x", ["DESIGN"]);
    const res = await SOLUTION(req(payload), params);
    expect(res.status).toBe(200);
    expect(mockLib.submitSolution).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pc-1", designerEmail: "designer@x" }),
    );
  });

  it("rejects SERVICE with 403", async () => {
    asUser("jessica@x", ["SERVICE"]);
    const res = await SOLUTION(req(payload), params);
    expect(res.status).toBe(403);
  });

  it("maps state errors to 409", async () => {
    asUser("designer@x", ["TECH_OPS"]);
    mockLib.submitSolution.mockRejectedValue(new ProductionCheckStateError("wrong state"));
    const res = await SOLUTION(req(payload), params);
    expect(res.status).toBe(409);
  });
});

describe("POST /[id]/decide", () => {
  it("allows the configured approver (case-insensitive email match)", async () => {
    asUser("Jessica@X", ["SERVICE"]);
    const res = await DECIDE(req({ decision: "yes" }), params);
    expect(res.status).toBe(200);
    expect(mockLib.decide).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pc-1", decision: "yes", decidedByEmail: "Jessica@X" }),
    );
  });

  it("allows ADMIN as backup approver", async () => {
    asUser("admin@x", ["ADMIN"]);
    const res = await DECIDE(req({ decision: "no", reason: "wrong count" }), params);
    expect(res.status).toBe(200);
  });

  it("rejects a non-approver SERVICE user with 403", async () => {
    asUser("other-service@x", ["SERVICE"]);
    const res = await DECIDE(req({ decision: "yes" }), params);
    expect(res.status).toBe(403);
    expect(mockLib.decide).not.toHaveBeenCalled();
  });

  it("maps a double-decide to 409", async () => {
    asUser("jessica@x", ["SERVICE"]);
    mockLib.decide.mockRejectedValue(new ProductionCheckStateError("already decided"));
    const res = await DECIDE(req({ decision: "yes" }), params);
    expect(res.status).toBe(409);
  });

  it("rejects an invalid decision value with 400", async () => {
    asUser("jessica@x", ["SERVICE"]);
    const res = await DECIDE(req({ decision: "maybe" }), params);
    expect(res.status).toBe(400);
    expect(mockLib.decide).not.toHaveBeenCalled();
  });
});

describe("POST /[id]/cancel", () => {
  it("allows SERVICE / PM / OPS_MGR roles", async () => {
    asUser("pm@x", ["PROJECT_MANAGER"]);
    const res = await CANCEL(req({}), params);
    expect(res.status).toBe(200);
    expect(mockLib.cancelProductionCheck).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pc-1", cancelledByEmail: "pm@x" }),
    );
  });

  it("rejects DESIGN with 403", async () => {
    asUser("designer@x", ["DESIGN"]);
    const res = await CANCEL(req({}), params);
    expect(res.status).toBe(403);
  });

  it("maps cancel-of-approved to 409", async () => {
    asUser("jessica@x", ["SERVICE"]);
    mockLib.cancelProductionCheck.mockRejectedValue(new ProductionCheckStateError("approved"));
    const res = await CANCEL(req({}), params);
    expect(res.status).toBe(409);
  });
});
