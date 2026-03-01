/**
 * Tests for POST /api/catalog/expire-pending
 *
 * This cron route expires PendingCatalogPush records older than TTL.
 */

const mockUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
const mockLogActivity = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

import { POST } from "@/app/api/catalog/expire-pending/route";
import { NextRequest } from "next/server";

describe("POST /api/catalog/expire-pending", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireApiAuth.mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
      ip: "127.0.0.1",
      userAgent: "test",
    });
  });

  it("expires pending pushes with past expiresAt", async () => {
    const request = new NextRequest(
      "http://localhost/api/catalog/expire-pending",
      { method: "POST" },
    );

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.expired).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          expiresAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: { status: "EXPIRED" },
      }),
    );
  });

  it("logs activity when records are expired", async () => {
    const request = new NextRequest(
      "http://localhost/api/catalog/expire-pending",
      { method: "POST" },
    );

    await POST(request);

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SETTINGS_CHANGED",
        description: expect.stringContaining("Expired 3"),
        userEmail: "admin@test.com",
      }),
    );
  });

  it("skips logging when no records expired", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    const request = new NextRequest(
      "http://localhost/api/catalog/expire-pending",
      { method: "POST" },
    );

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.expired).toBe(0);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireApiAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    );

    const request = new NextRequest(
      "http://localhost/api/catalog/expire-pending",
      { method: "POST" },
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin roles", async () => {
    mockRequireApiAuth.mockResolvedValueOnce({
      email: "viewer@test.com",
      role: "VIEWER",
      ip: "127.0.0.1",
      userAgent: "test",
    });

    const request = new NextRequest(
      "http://localhost/api/catalog/expire-pending",
      { method: "POST" },
    );

    const response = await POST(request);
    expect(response.status).toBe(403);
  });
});
