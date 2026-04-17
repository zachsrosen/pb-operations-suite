const mockAuth = jest.fn();
const mockHeaders = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetAllUsers = jest.fn();
const mockUpdateUserRoles = jest.fn();
const mockFindUnique = jest.fn();
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
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
  getAllUsers: () => mockGetAllUsers(),
  updateUserRoles: (...args: [string, string[]]) => mockUpdateUserRoles(...args),
  UserRole: {},
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

jest.mock("@/lib/audit/admin-activity", () => ({
  logAdminActivity: (input: unknown) => mockLogAdminActivity(input),
  extractRequestContext: () => mockExtractRequestContext(),
}));

import { NextRequest } from "next/server";
import { PUT } from "@/app/api/admin/users/route";

describe("PUT /api/admin/users", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
    mockHeaders.mockResolvedValue(new Headers());
    mockGetUserByEmail.mockResolvedValue({
      id: "admin-1",
      email: "admin@photonbrothers.com",
      role: "ADMIN",
      name: "Admin",
    });
    mockExtractRequestContext.mockReturnValue({});
    mockLogAdminActivity.mockResolvedValue(null);
  });

  it("rejects switching to a location-scoped role when no locations are assigned", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-1",
      email: "ops@photonbrothers.com",
      role: "VIEWER",
      roles: ["VIEWER"],
      allowedLocations: [],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-1", roles: ["OPERATIONS"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      requiresLocations: true,
    });
    expect(mockUpdateUserRoles).not.toHaveBeenCalled();
  });

  it("allows switching to a global role without locations", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-2",
      email: "sales.manager@photonbrothers.com",
      role: "VIEWER",
      roles: ["VIEWER"],
      allowedLocations: [],
    });
    mockUpdateUserRoles.mockResolvedValue({
      id: "user-2",
      email: "sales.manager@photonbrothers.com",
      role: "SALES_MANAGER",
      roles: ["SALES_MANAGER"],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-2", roles: ["SALES_MANAGER"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { roles: ["SALES_MANAGER"] },
    });
    expect(mockUpdateUserRoles).toHaveBeenCalledWith("user-2", ["SALES_MANAGER"]);
  });

  it("allows switching to a location-scoped role when locations are already assigned", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-3",
      email: "ops2@photonbrothers.com",
      role: "VIEWER",
      roles: ["VIEWER"],
      allowedLocations: ["Westminster"],
    });
    mockUpdateUserRoles.mockResolvedValue({
      id: "user-3",
      email: "ops2@photonbrothers.com",
      role: "OPERATIONS",
      roles: ["OPERATIONS"],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-3", roles: ["OPERATIONS"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { roles: ["OPERATIONS"] },
    });
    expect(mockUpdateUserRoles).toHaveBeenCalledWith("user-3", ["OPERATIONS"]);
  });

  it("accepts a multi-role assignment", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-4",
      email: "dual@photonbrothers.com",
      role: "VIEWER",
      roles: ["VIEWER"],
      allowedLocations: ["Westminster"],
    });
    mockUpdateUserRoles.mockResolvedValue({
      id: "user-4",
      email: "dual@photonbrothers.com",
      role: "SERVICE",
      roles: ["SERVICE", "OPERATIONS"],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-4", roles: ["SERVICE", "OPERATIONS"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(mockUpdateUserRoles).toHaveBeenCalledWith("user-4", ["SERVICE", "OPERATIONS"]);
  });

  it("rejects an empty roles array", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-5", roles: [] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    expect(mockUpdateUserRoles).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("rejects assignment to a legacy role", async () => {
    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-6", roles: ["OWNER"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    expect(mockUpdateUserRoles).not.toHaveBeenCalled();
  });

  it("requires locations when ANY role is location-scoped", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-7",
      email: "multi@photonbrothers.com",
      role: "VIEWER",
      roles: ["VIEWER"],
      allowedLocations: [],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-7", roles: ["SERVICE", "OPERATIONS"] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      requiresLocations: true,
    });
    expect(mockUpdateUserRoles).not.toHaveBeenCalled();
  });
});
