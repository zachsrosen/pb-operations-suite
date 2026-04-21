const mockAuth = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetOverride = jest.fn();
const mockUpsertOverride = jest.fn();
const mockResetOverride = jest.fn();
const mockInvalidateCache = jest.fn();
const mockLogAdminActivity = jest.fn();
const mockExtractCtx = jest.fn();

jest.mock("@/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/db", () => ({
  prisma: {},
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
  getRoleDefinitionOverride: (role: string) => mockGetOverride(role),
  upsertRoleDefinitionOverride: (
    role: string,
    override: unknown,
    email: string | null,
  ) => mockUpsertOverride(role, override, email),
  resetRoleDefinitionOverride: (role: string) => mockResetOverride(role),
}));
jest.mock("@/lib/role-resolution", () => ({
  invalidateRoleCache: (r: string) => mockInvalidateCache(r),
}));
jest.mock("@/lib/audit/admin-activity", () => ({
  logAdminActivity: (...a: unknown[]) => mockLogAdminActivity(...a),
  extractRequestContext: (h: unknown) => mockExtractCtx(h),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Map(),
}));

import { NextRequest } from "next/server";
import {
  GET,
  PUT,
  DELETE,
} from "@/app/api/admin/roles/[role]/definition/route";

function mkReq(body?: unknown, url = "http://localhost/api/admin/roles/PROJECT_MANAGER/definition") {
  return new NextRequest(url, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function mkParams(role: string) {
  return { params: Promise.resolve({ role }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
  mockGetUserByEmail.mockResolvedValue({
    id: "a1",
    email: "admin@photonbrothers.com",
    name: "Admin",
    roles: ["ADMIN"],
  });
  mockExtractCtx.mockReturnValue({ ipAddress: "0.0.0.0", userAgent: null });
  mockGetOverride.mockResolvedValue(null);
  mockUpsertOverride.mockResolvedValue({
    role: "PROJECT_MANAGER",
    override: {},
    updatedAt: new Date(),
    updatedByEmail: "admin@photonbrothers.com",
  });
  mockResetOverride.mockResolvedValue(null);
});

describe("GET /api/admin/roles/[role]/definition", () => {
  it("401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(401);
  });

  it("403 when user is not ADMIN", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "u1",
      email: "zach@photonbrothers.com",
      roles: ["SERVICE"],
    });
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(403);
  });

  it("400 for unknown role", async () => {
    const res = await GET(mkReq(), mkParams("NOT_A_ROLE"));
    expect(res.status).toBe(400);
  });

  it("400 for legacy role with canonical-target message", async () => {
    const res = await GET(mkReq(), mkParams("OWNER"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/EXECUTIVE/);
  });

  it("200 returns override + codeDefaults", async () => {
    mockGetOverride.mockResolvedValue({
      role: "PROJECT_MANAGER",
      override: { label: "PM (custom)" },
    });
    const res = await GET(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("PROJECT_MANAGER");
    expect(body.override).toEqual({ label: "PM (custom)" });
    expect(body.codeDefaults).toBeTruthy();
    expect(body.codeDefaults.label).toBe("Project Manager");
  });
});

describe("PUT /api/admin/roles/[role]/definition", () => {
  it("400 when body is not JSON object", async () => {
    const res = await PUT(mkReq(null), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(400);
  });

  it("400 when body.override has unknown keys", async () => {
    const res = await PUT(
      mkReq({ override: { not_a_field: true } }),
      mkParams("PROJECT_MANAGER"),
    );
    expect(res.status).toBe(400);
  });

  it("400 with violations array when guard fails (ADMIN allowedRoutes without /admin)", async () => {
    const res = await PUT(
      mkReq({ override: { allowedRoutes: ["/dashboards/something"] } }),
      mkParams("ADMIN"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.violations.length).toBeGreaterThan(0);
  });

  it("400 for legacy role", async () => {
    const res = await PUT(
      mkReq({ override: { label: "x" } }),
      mkParams("MANAGER"),
    );
    expect(res.status).toBe(400);
  });

  it("200 on success: upserts, invalidates cache, logs activity", async () => {
    const override = { label: "PM (renamed)" };
    const res = await PUT(mkReq({ override }), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    expect(mockUpsertOverride).toHaveBeenCalledWith(
      "PROJECT_MANAGER",
      override,
      "admin@photonbrothers.com",
    );
    expect(mockInvalidateCache).toHaveBeenCalledWith("PROJECT_MANAGER");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ROLE_DEFINITION_CHANGED",
        entityType: "role",
        entityId: "PROJECT_MANAGER",
      }),
    );
  });
});

describe("DELETE /api/admin/roles/[role]/definition", () => {
  it("403 when not admin", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "u1",
      email: "zach@photonbrothers.com",
      roles: ["SERVICE"],
    });
    const res = await DELETE(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(403);
  });

  it("400 for legacy role", async () => {
    const res = await DELETE(mkReq(), mkParams("OWNER"));
    expect(res.status).toBe(400);
  });

  it("200 resets, invalidates cache, logs activity", async () => {
    mockResetOverride.mockResolvedValue({ role: "PROJECT_MANAGER", override: { label: "x" } });
    const res = await DELETE(mkReq(), mkParams("PROJECT_MANAGER"));
    expect(res.status).toBe(200);
    expect(mockInvalidateCache).toHaveBeenCalledWith("PROJECT_MANAGER");
    expect(mockLogAdminActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ROLE_DEFINITION_RESET" }),
    );
  });
});
