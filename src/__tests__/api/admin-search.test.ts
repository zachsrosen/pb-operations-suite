const mockAuth = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockUserFindMany = jest.fn();
const mockActivityFindMany = jest.fn();
const mockBugReportFindMany = jest.fn();

jest.mock("@/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
    activityLog: { findMany: (...a: unknown[]) => mockActivityFindMany(...a) },
    bugReport: { findMany: (...a: unknown[]) => mockBugReportFindMany(...a) },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/search/route";

function req(q: string) {
  return new NextRequest(`http://localhost/api/admin/search?q=${encodeURIComponent(q)}`);
}

describe("GET /api/admin/search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
    mockGetUserByEmail.mockResolvedValue({ id: "a1", email: "admin@photonbrothers.com", roles: ["ADMIN"] });
    mockUserFindMany.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([]);
    mockBugReportFindMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req("zach"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated user is not an admin", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", email: "zach@photonbrothers.com", roles: ["SERVICE"] });
    const res = await GET(req("zach"));
    expect(res.status).toBe(403);
  });

  it("returns empty shape for empty query", async () => {
    const res = await GET(req(""));
    const body = await res.json();
    expect(body).toEqual({ users: [], roles: [], activity: [], tickets: [] });
  });

  it("searches across all four entity types with take:5 per category", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "u1", email: "nick@x.com", name: "Nick" }]);
    mockActivityFindMany.mockResolvedValue([
      { id: "a1", type: "LOGIN", description: "Nick logged in", userEmail: "nick@x.com", createdAt: new Date() },
    ]);
    mockBugReportFindMany.mockResolvedValue([]);
    const res = await GET(req("nick"));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.activity).toHaveLength(1);
    expect(body.tickets).toHaveLength(0);
    expect(Array.isArray(body.roles)).toBe(true);
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("returns partial results when one query errors", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "u1", email: "a@b.com", name: "A" }]);
    mockActivityFindMany.mockRejectedValue(new Error("DB blip"));
    const res = await GET(req("a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.activity).toEqual([]);
  });

  it("matches roles by label or key", async () => {
    const res = await GET(req("admin"));
    const body = await res.json();
    expect(body.roles.length).toBeGreaterThan(0);
  });
});
