const mockAuth = jest.fn();
const mockHeaders = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetAllUsers = jest.fn();
const mockUpdateUserRole = jest.fn();
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
  updateUserRole: (...args: [string, string]) => mockUpdateUserRole(...args),
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
      allowedLocations: [],
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-1", role: "OPERATIONS" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      requiresLocations: true,
    });
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it("allows switching to a global role without locations", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-2",
      email: "sales.manager@photonbrothers.com",
      role: "VIEWER",
      allowedLocations: [],
    });
    mockUpdateUserRole.mockResolvedValue({
      id: "user-2",
      email: "sales.manager@photonbrothers.com",
      role: "SALES_MANAGER",
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-2", role: "SALES_MANAGER" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { role: "SALES_MANAGER" },
    });
    expect(mockUpdateUserRole).toHaveBeenCalledWith("user-2", "SALES_MANAGER");
  });

  it("allows switching to a location-scoped role when locations are already assigned", async () => {
    mockFindUnique.mockResolvedValue({
      id: "user-3",
      email: "ops2@photonbrothers.com",
      role: "VIEWER",
      allowedLocations: ["Westminster"],
    });
    mockUpdateUserRole.mockResolvedValue({
      id: "user-3",
      email: "ops2@photonbrothers.com",
      role: "OPERATIONS",
    });

    const response = await PUT(new NextRequest("http://localhost/api/admin/users", {
      method: "PUT",
      body: JSON.stringify({ userId: "user-3", role: "OPERATIONS" }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { role: "OPERATIONS" },
    });
    expect(mockUpdateUserRole).toHaveBeenCalledWith("user-3", "OPERATIONS");
  });
});
