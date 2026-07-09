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
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/idr-meeting/escalation-photos/route";
import { DELETE, PATCH } from "@/app/api/idr-meeting/escalation-photos/[id]/route";
import { GET as VIEW } from "@/app/api/idr-meeting/escalation-photos/view/route";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";

const mockAuth = requireApiAuth as jest.MockedFunction<typeof requireApiAuth>;
const mockRole = isIdrAllowedRole as jest.MockedFunction<typeof isIdrAllowedRole>;
const mockPut = put as jest.MockedFunction<typeof put>;
const mockDel = del as jest.MockedFunction<typeof del>;
const mockFindMany = prisma.idrEscalationPhoto.findMany as jest.Mock;
const mockFindUnique = prisma.idrEscalationPhoto.findUnique as jest.Mock;
const mockDelete = prisma.idrEscalationPhoto.delete as jest.Mock;
const mockAggregate = prisma.idrEscalationPhoto.aggregate as jest.Mock;
const mockCreate = prisma.idrEscalationPhoto.create as jest.Mock;

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

  it("PATCH returns 403 for a non-IDR role", async () => {
    mockRole.mockReturnValue(false);
    const res = await PATCH(req("http://localhost/api/idr-meeting/escalation-photos/p1"), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(403);
  });

  it("VIEW returns 403 for a non-IDR role", async () => {
    mockRole.mockReturnValue(false);
    const res = await VIEW(req("http://localhost/api/idr-meeting/escalation-photos/view?path=escalation-photos/a.png"));
    expect(res.status).toBe(403);
  });
});

describe("POST upload (happy path + failure handling)", () => {
  const OLD_ENV = process.env.BLOB_READ_WRITE_TOKEN;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = OLD_ENV;
  });

  // Bypass real multipart parsing (unreliable under jest) by faking req.formData()
  // directly — the handler only calls formData().get(...), so this exercises the
  // full handler logic without a round-trip through undici's multipart parser.
  function postReq(file: File | null, dealId: string | null, caption?: string): NextRequest {
    const map = new Map<string, unknown>();
    if (file) map.set("file", file);
    if (dealId != null) map.set("dealId", dealId);
    if (caption != null) map.set("caption", caption);
    return {
      formData: async () => ({ get: (k: string) => (map.has(k) ? map.get(k) : null) }),
      nextUrl: new URL("http://localhost/api/idr-meeting/escalation-photos"),
    } as unknown as NextRequest;
  }
  const img = () => new File([Buffer.from("fakebytes")], "shot.png", { type: "image/png" });

  it("assigns sortOrder = max+1 and returns 201 with viewerUrl", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    mockPut.mockResolvedValue({ pathname: "escalation-photos/shot-xyz.png" } as never);
    mockAggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "new1", createdAt: new Date(), ...data,
    }));

    const res = await POST(postReq(img(), "d9", "main panel"));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 5, dealId: "d9", caption: "main panel" }) }),
    );
    const body = await res.json();
    expect(body.viewerUrl).toBe("/api/idr-meeting/escalation-photos/view?path=escalation-photos%2Fshot-xyz.png");
  });

  it("first photo for a deal gets sortOrder 0", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    mockPut.mockResolvedValue({ pathname: "escalation-photos/first.png" } as never);
    mockAggregate.mockResolvedValue({ _max: { sortOrder: null } });
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "n", createdAt: new Date(), ...data }));

    await POST(postReq(img(), "d1"));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sortOrder: 0 }) }),
    );
  });

  it("returns 503 when the blob token is missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const res = await POST(postReq(img(), "d1"));
    expect(res.status).toBe(503);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file type with 400", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    const pdf = new File([Buffer.from("x")], "doc.pdf", { type: "application/pdf" });
    const res = await POST(postReq(pdf, "d1"));
    expect(res.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("deletes the orphan blob and returns 500 when row create fails", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    mockPut.mockResolvedValue({ pathname: "escalation-photos/orphan.png" } as never);
    mockAggregate.mockResolvedValue({ _max: { sortOrder: null } });
    mockCreate.mockRejectedValue(new Error("db down"));
    mockDel.mockResolvedValue(undefined as never);

    const res = await POST(postReq(img(), "d1"));
    expect(res.status).toBe(500);
    expect(mockDel).toHaveBeenCalledWith("escalation-photos/orphan.png");
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
