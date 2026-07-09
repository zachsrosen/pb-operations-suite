jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(),
}));
jest.mock("@/lib/idr-meeting", () => ({
  isIdrAllowedRole: jest.fn(),
}));
jest.mock("@vercel/blob", () => ({
  put: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
}));
jest.mock("@/lib/db", () => ({
  prisma: {
    idrEscalationPhoto: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/idr-meeting/escalation-photos/route";
import { DELETE } from "@/app/api/idr-meeting/escalation-photos/[id]/route";
import { GET as VIEW } from "@/app/api/idr-meeting/escalation-photos/view/route";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";

const mockAuth = requireApiAuth as jest.MockedFunction<typeof requireApiAuth>;
const mockRole = isIdrAllowedRole as jest.MockedFunction<typeof isIdrAllowedRole>;
const mockDel = del as jest.MockedFunction<typeof del>;
const mockFindMany = prisma.idrEscalationPhoto.findMany as jest.Mock;
const mockFindUnique = prisma.idrEscalationPhoto.findUnique as jest.Mock;
const mockDelete = prisma.idrEscalationPhoto.delete as jest.Mock;

// Non-IDR role name used only to make intent clear; the guard decision is the
// return value of isIdrAllowedRole (a stub that currently returns true for all
// roles), so we drive that mock directly.
const AUTH_OK = { email: "x@photonbrothers.com", role: "SALES", roles: ["SALES"], ip: "127.0.0.1", userAgent: "test" };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(AUTH_OK as never);
  mockRole.mockReturnValue(true);
});

function req(url: string): NextRequest {
  return new NextRequest(url);
}

describe("escalation-photos route auth gate", () => {
  it("GET returns 403 for a non-IDR role", async () => {
    mockRole.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/idr-meeting/escalation-photos?dealId=d1"));
    expect(res.status).toBe(403);
  });

  it("POST returns 403 for a non-IDR role", async () => {
    mockRole.mockReturnValue(false);
    const res = await POST(req("http://localhost/api/idr-meeting/escalation-photos"));
    expect(res.status).toBe(403);
  });

  it("DELETE returns 403 for a non-IDR role", async () => {
    mockRole.mockReturnValue(false);
    const res = await DELETE(req("http://localhost/api/idr-meeting/escalation-photos/p1"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET list (happy path)", () => {
  it("returns photos with a same-origin viewerUrl", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", dealId: "d1", blobPath: "escalation-photos/a.png", fileName: "a.png", caption: null, sortOrder: 0, uploadedBy: "x@photonbrothers.com", createdAt: new Date() },
    ]);
    const res = await GET(req("http://localhost/api/idr-meeting/escalation-photos?dealId=d1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].viewerUrl).toBe(
      "/api/idr-meeting/escalation-photos/view?path=escalation-photos%2Fa.png",
    );
  });

  it("returns 400 when dealId is missing", async () => {
    const res = await GET(req("http://localhost/api/idr-meeting/escalation-photos"));
    expect(res.status).toBe(400);
  });
});

describe("view route path guard", () => {
  it("returns 400 for a path outside the prefix", async () => {
    const res = await VIEW(req("http://localhost/api/idr-meeting/escalation-photos/view?path=catalog-photos/x.png"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a path containing ..", async () => {
    const res = await VIEW(req("http://localhost/api/idr-meeting/escalation-photos/view?path=escalation-photos/../secret"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when path is missing", async () => {
    const res = await VIEW(req("http://localhost/api/idr-meeting/escalation-photos/view"));
    expect(res.status).toBe(400);
  });
});

describe("DELETE continues when blob del throws", () => {
  it("still deletes the row and returns { ok: true }", async () => {
    mockFindUnique.mockResolvedValue({ id: "p1", blobPath: "escalation-photos/a.png" });
    mockDel.mockRejectedValue(new Error("blob gone"));
    mockDelete.mockResolvedValue({ id: "p1" });

    const res = await DELETE(req("http://localhost/api/idr-meeting/escalation-photos/p1"), {
      params: Promise.resolve({ id: "p1" }),
    });

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 404 when the photo row is missing", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await DELETE(req("http://localhost/api/idr-meeting/escalation-photos/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
