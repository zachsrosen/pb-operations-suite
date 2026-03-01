/**
 * Tests for the admin-activity audit pipeline helper.
 *
 * These tests verify that logAdminActivity:
 * 1. Calls getOrCreateAuditSession with correct input
 * 2. Computes risk level from the activity type
 * 3. Calls logActivity with session + risk fields
 * 4. Fires anomaly checks (non-blocking)
 * 5. Never throws (swallows errors gracefully)
 * 6. Resolves userId from email when not provided
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockGetOrCreateAuditSession = jest.fn();
const mockRunSessionAnomalyChecks = jest.fn();
const mockLogActivity = jest.fn();
const mockGetUserByEmail = jest.fn();

jest.mock("@/lib/audit/session", () => ({
  getOrCreateAuditSession: (...args: any[]) => mockGetOrCreateAuditSession(...args),
  runSessionAnomalyChecks: (...args: any[]) => mockRunSessionAnomalyChecks(...args),
}));

jest.mock("@/lib/db", () => ({
  logActivity: (...args: any[]) => mockLogActivity(...args),
  getUserByEmail: (...args: any[]) => mockGetUserByEmail(...args),
  prisma: { fake: true }, // truthy so guard passes
}));

// detect is NOT mocked — we use real risk mapping
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    type: "USER_ROLE_CHANGED" as any,
    description: "Changed role",
    userId: "user-1",
    userEmail: "admin@test.com",
    userName: "Admin",
    entityType: "user",
    entityId: "target-1",
    entityName: "target@test.com",
    metadata: { oldRole: "VIEWER", newRole: "ADMIN" },
    ipAddress: "1.2.3.4",
    userAgent: "Mozilla/5.0",
    xClientType: null,
    requestPath: "/api/admin/users",
    requestMethod: "PUT",
    ...overrides,
  };
}

const MOCK_SESSION_DATA = {
  id: "sess-1",
  userId: "user-1",
  userEmail: "admin@test.com",
  clientType: "BROWSER",
  environment: "PRODUCTION",
  ipAddress: "1.2.3.4",
  deviceFingerprint: null,
  riskScore: 0,
  anomalyReasons: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOrCreateAuditSession.mockResolvedValue({
    sessionId: "sess-1",
    isNew: true,
    sessionData: MOCK_SESSION_DATA,
  });
  mockRunSessionAnomalyChecks.mockResolvedValue(undefined);
  mockLogActivity.mockResolvedValue({ id: "log-1" });
  mockGetUserByEmail.mockResolvedValue({ id: "user-1", email: "admin@test.com", name: "Admin" });
});

describe("logAdminActivity", () => {
  it("calls getOrCreateAuditSession with correct input", async () => {
    await logAdminActivity(baseInput());

    expect(mockGetOrCreateAuditSession).toHaveBeenCalledTimes(1);
    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput).toMatchObject({
      userEmail: "admin@test.com",
      userName: "Admin",
      userId: "user-1",
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      xClientType: null,
      hasValidSession: true,
    });
  });

  it("computes correct risk for USER_ROLE_CHANGED (HIGH = 3)", async () => {
    await logAdminActivity(baseInput());

    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall.riskLevel).toBe("HIGH");
    expect(logCall.riskScore).toBe(3);
  });

  it("computes correct risk for SETTINGS_CHANGED (CRITICAL = 4)", async () => {
    await logAdminActivity(baseInput({ type: "SETTINGS_CHANGED" }));

    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall.riskLevel).toBe("CRITICAL");
    expect(logCall.riskScore).toBe(4);
  });

  it("computes correct risk for USER_CREATED (HIGH = 3)", async () => {
    await logAdminActivity(baseInput({ type: "USER_CREATED" }));

    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall.riskLevel).toBe("HIGH");
    expect(logCall.riskScore).toBe(3);
  });

  it("computes correct risk for AVAILABILITY_CHANGED (MEDIUM = 2)", async () => {
    await logAdminActivity(baseInput({ type: "AVAILABILITY_CHANGED" }));

    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall.riskLevel).toBe("MEDIUM");
    expect(logCall.riskScore).toBe(2);
  });

  it("passes auditSessionId and all fields to logActivity", async () => {
    await logAdminActivity(baseInput());

    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall).toMatchObject({
      type: "USER_ROLE_CHANGED",
      description: "Changed role",
      userId: "user-1",
      userEmail: "admin@test.com",
      userName: "Admin",
      entityType: "user",
      entityId: "target-1",
      entityName: "target@test.com",
      auditSessionId: "sess-1",
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      requestPath: "/api/admin/users",
      requestMethod: "PUT",
    });
    expect(logCall.metadata).toEqual({ oldRole: "VIEWER", newRole: "ADMIN" });
  });

  it("fires anomaly checks (non-blocking) with session data and risk score", async () => {
    await logAdminActivity(baseInput());

    expect(mockRunSessionAnomalyChecks).toHaveBeenCalledTimes(1);
    const [sessionData, riskScore] = mockRunSessionAnomalyChecks.mock.calls[0];
    expect(sessionData).toEqual(MOCK_SESSION_DATA);
    expect(riskScore).toBe(3);
  });

  it("skips anomaly checks when sessionData is null", async () => {
    mockGetOrCreateAuditSession.mockResolvedValue({
      sessionId: "",
      isNew: false,
      sessionData: null,
    });

    await logAdminActivity(baseInput());

    expect(mockRunSessionAnomalyChecks).not.toHaveBeenCalled();
    // logActivity should still be called (with empty auditSessionId)
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it("never throws even if getOrCreateAuditSession fails", async () => {
    mockGetOrCreateAuditSession.mockRejectedValue(new Error("DB down"));

    // Should not throw
    await expect(logAdminActivity(baseInput())).resolves.toBeUndefined();
  });

  it("never throws even if logActivity fails", async () => {
    mockLogActivity.mockRejectedValue(new Error("Write failed"));

    await expect(logAdminActivity(baseInput())).resolves.toBeUndefined();
  });

  it("resolves userId from email when userId is not provided", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "resolved-id", email: "admin@test.com", name: "Admin" });

    await logAdminActivity(baseInput({ userId: undefined }));

    expect(mockGetUserByEmail).toHaveBeenCalledWith("admin@test.com");

    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput.userId).toBe("resolved-id");

    const logCall = mockLogActivity.mock.calls[0][0];
    expect(logCall.userId).toBe("resolved-id");
  });

  it("skips userId resolution for api@system email", async () => {
    await logAdminActivity(baseInput({ userId: undefined, userEmail: "api@system" }));

    expect(mockGetUserByEmail).not.toHaveBeenCalled();

    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput.userId).toBeNull();
  });

  it("sets hasValidSession=false for api@system (token auth)", async () => {
    await logAdminActivity(baseInput({ userEmail: "api@system" }));

    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput.hasValidSession).toBe(false);
  });

  it("sets hasValidSession=true for real user emails", async () => {
    await logAdminActivity(baseInput({ userEmail: "admin@test.com" }));

    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput.hasValidSession).toBe(true);
  });

  it("handles userId resolution failure gracefully", async () => {
    mockGetUserByEmail.mockResolvedValue(null);

    await logAdminActivity(baseInput({ userId: undefined }));

    // Should proceed with null userId
    const [sessionInput] = mockGetOrCreateAuditSession.mock.calls[0];
    expect(sessionInput.userId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractRequestContext
// ---------------------------------------------------------------------------

describe("extractRequestContext", () => {
  function makeHeaders(entries: Record<string, string>): Headers {
    const h = new Headers();
    for (const [k, v] of Object.entries(entries)) {
      h.set(k, v);
    }
    return h;
  }

  it("extracts IP from x-forwarded-for (first entry)", () => {
    const ctx = extractRequestContext(
      makeHeaders({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })
    );
    expect(ctx.ipAddress).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const ctx = extractRequestContext(
      makeHeaders({ "x-real-ip": "9.8.7.6" })
    );
    expect(ctx.ipAddress).toBe("9.8.7.6");
  });

  it("returns 'unknown' when no IP headers present", () => {
    const ctx = extractRequestContext(makeHeaders({}));
    expect(ctx.ipAddress).toBe("unknown");
  });

  it("extracts user-agent", () => {
    const ctx = extractRequestContext(
      makeHeaders({ "user-agent": "TestAgent/1.0" })
    );
    expect(ctx.userAgent).toBe("TestAgent/1.0");
  });

  it("extracts x-client-type", () => {
    const ctx = extractRequestContext(
      makeHeaders({ "x-client-type": "CLAUDE_CODE" })
    );
    expect(ctx.xClientType).toBe("CLAUDE_CODE");
  });

  it("returns null for missing optional headers", () => {
    const ctx = extractRequestContext(makeHeaders({}));
    expect(ctx.userAgent).toBeNull();
    expect(ctx.xClientType).toBeNull();
  });
});
