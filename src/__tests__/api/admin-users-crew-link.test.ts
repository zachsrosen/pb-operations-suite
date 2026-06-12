const mockAuth = jest.fn();
const mockHeaders = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockUserFindUnique = jest.fn();
const mockCrewFindUnique = jest.fn();
const mockCrewUpdate = jest.fn();
const mockCrewUpdateMany = jest.fn();
const mockLogAdminActivity = jest.fn();
const mockExtractRequestContext = jest.fn(() => ({}));

jest.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

jest.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    crewMember: {
      findUnique: (...args: unknown[]) => mockCrewFindUnique(...args),
      update: (...args: unknown[]) => mockCrewUpdate(...args),
      updateMany: (...args: unknown[]) => mockCrewUpdateMany(...args),
    },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

jest.mock("@/lib/audit/admin-activity", () => ({
  logAdminActivity: (input: unknown) => mockLogAdminActivity(input),
  extractRequestContext: () => mockExtractRequestContext(),
}));

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/users/[userId]/crew-link/route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/users/user-1/crew-link", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const routeParams = { params: Promise.resolve({ userId: "user-1" }) };

describe("PATCH /api/admin/users/[userId]/crew-link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
    mockHeaders.mockResolvedValue(new Headers());
    mockGetUserByEmail.mockResolvedValue({
      id: "admin-1",
      email: "admin@photonbrothers.com",
      roles: ["ADMIN"],
      name: "Admin",
    });
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      email: "drew@photonbrothers.com",
      name: "Drew Perry",
    });
    mockExtractRequestContext.mockReturnValue({});
    mockLogAdminActivity.mockResolvedValue(undefined);
    mockCrewUpdateMany.mockResolvedValue({ count: 0 });
    mockCrewUpdate.mockResolvedValue({});
  });

  it("rejects non-admin users with 403", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "viewer-1",
      email: "viewer@photonbrothers.com",
      roles: ["VIEWER"],
      name: "Viewer",
    });

    const response = await PATCH(makeRequest({ crewMemberId: "crew-1" }), routeParams);

    expect(response.status).toBe(403);
    expect(mockCrewUpdate).not.toHaveBeenCalled();
    expect(mockCrewUpdateMany).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).not.toHaveBeenCalled();
  });

  it("returns 409 naming the conflicting user when crew is linked to someone else", async () => {
    mockCrewFindUnique.mockResolvedValue({
      id: "crew-1",
      name: "Drew Perry",
      userId: "user-2",
    });
    // Second user.findUnique call resolves the conflicting user.
    mockUserFindUnique
      .mockResolvedValueOnce({
        id: "user-1",
        email: "drew@photonbrothers.com",
        name: "Drew Perry",
      })
      .mockResolvedValueOnce({
        id: "user-2",
        email: "joe@photonbrothers.com",
        name: "Joe Lynch",
      });

    const response = await PATCH(makeRequest({ crewMemberId: "crew-1" }), routeParams);

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("Joe Lynch");
    expect(payload.conflictingUserId).toBe("user-2");
    expect(mockCrewUpdate).not.toHaveBeenCalled();
    expect(mockCrewUpdateMany).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).not.toHaveBeenCalled();
  });

  it("clears the crew link when crewMemberId is null", async () => {
    const response = await PATCH(makeRequest({ crewMemberId: null }), routeParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "user-1", crewMemberId: null },
    });
    expect(mockCrewUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { userId: null },
    });
    expect(mockCrewUpdate).not.toHaveBeenCalled();
    expect(mockLogAdminActivity).toHaveBeenCalledTimes(1);
  });

  it("sets the crew link when the crew member is unclaimed", async () => {
    mockCrewFindUnique.mockResolvedValue({
      id: "crew-1",
      name: "Drew Perry",
      userId: null,
    });

    const response = await PATCH(makeRequest({ crewMemberId: "crew-1" }), routeParams);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "user-1", crewMemberId: "crew-1" },
    });
    // Clears any other crew record claiming this user before linking.
    expect(mockCrewUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { not: "crew-1" } },
      data: { userId: null },
    });
    expect(mockCrewUpdate).toHaveBeenCalledWith({
      where: { id: "crew-1" },
      data: { userId: "user-1" },
    });
    expect(mockLogAdminActivity).toHaveBeenCalledTimes(1);
  });
});
