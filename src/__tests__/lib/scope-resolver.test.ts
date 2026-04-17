const mockGetUserByEmail = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });

jest.mock("@/lib/db", () => ({
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { resolveAccessScope } from "@/lib/scope-resolver";

describe("scope-resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns global scope for global roles", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "admin-1",
      email: "admin@photonbrothers.com",
      roles: ["ADMIN"],
      role: "ADMIN",
      allowedLocations: [],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("admin@photonbrothers.com")).resolves.toMatchObject({
      effectiveRole: "ADMIN",
      scope: { type: "global" },
      isImpersonating: false,
      adminEmail: null,
    });
  });

  it("returns global scope for SALES_MANAGER", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "sales-manager-1",
      email: "sales.manager@photonbrothers.com",
      roles: ["SALES_MANAGER"],
      role: "SALES_MANAGER",
      allowedLocations: [],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("sales.manager@photonbrothers.com")).resolves.toMatchObject({
      effectiveRole: "SALES_MANAGER",
      scope: { type: "global" },
    });
  });

  it("returns location scope for location-scoped roles with normalized locations", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "ops-1",
      email: "ops@photonbrothers.com",
      roles: ["OPERATIONS"],
      role: "OPERATIONS",
      allowedLocations: ["DTC", "Westminster", "Unknown"],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("ops@photonbrothers.com", { scopeEnforcementEnabled: true })).resolves.toMatchObject({
      effectiveRole: "OPERATIONS",
      scope: { type: "location", locations: ["Centennial", "Westminster"] },
    });
  });

  it("returns owner scope for SALES users", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "sales-1",
      email: "sales@photonbrothers.com",
      roles: ["SALES"],
      role: "SALES",
      allowedLocations: [],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("sales@photonbrothers.com")).resolves.toMatchObject({
      effectiveRole: "SALES",
      scope: { type: "owner", userId: "sales-1" },
    });
  });

  it("uses rollout fallback for location-scoped users without assigned locations when enforcement is off", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "ops-2",
      email: "ops2@photonbrothers.com",
      roles: ["OPERATIONS"],
      role: "OPERATIONS",
      allowedLocations: [],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("ops2@photonbrothers.com")).resolves.toMatchObject({
      scope: { type: "global" },
    });
  });

  it("returns an empty location scope when enforcement is on and no locations are assigned", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "ops-3",
      email: "ops3@photonbrothers.com",
      roles: ["OPERATIONS"],
      role: "OPERATIONS",
      allowedLocations: [],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("ops3@photonbrothers.com", { scopeEnforcementEnabled: true })).resolves.toMatchObject({
      scope: { type: "location", locations: [] },
    });
  });

  it("inherits the impersonated user's scope", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "admin-2",
      email: "admin2@photonbrothers.com",
      roles: ["ADMIN"],
      role: "ADMIN",
      allowedLocations: [],
      impersonatingUserId: "ops-4",
    });
    mockFindUnique.mockResolvedValue({
      id: "ops-4",
      email: "ops4@photonbrothers.com",
      roles: ["OPERATIONS"],
      role: "OPERATIONS",
      allowedLocations: ["San Luis Obispo"],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("admin2@photonbrothers.com", { scopeEnforcementEnabled: true })).resolves.toMatchObject({
      effectiveRole: "OPERATIONS",
      scope: { type: "location", locations: ["San Luis Obispo"] },
      isImpersonating: true,
      adminEmail: "admin2@photonbrothers.com",
    });
  });

  it("returns global scope for machine-token auth", async () => {
    await expect(resolveAccessScope("api@system")).resolves.toMatchObject({
      user: null,
      effectiveRole: "ADMIN",
      scope: { type: "global" },
    });
  });

  it("returns null when the email is unknown", async () => {
    mockGetUserByEmail.mockResolvedValue(null);
    await expect(resolveAccessScope("missing@photonbrothers.com")).resolves.toBeNull();
  });

  it("picks max-privilege scope for multi-role users (location + global → global)", async () => {
    mockGetUserByEmail.mockResolvedValue({
      id: "multi-1",
      email: "multi@photonbrothers.com",
      roles: ["OPERATIONS", "EXECUTIVE"],
      role: "OPERATIONS",
      allowedLocations: ["DTC"],
      impersonatingUserId: null,
    });

    await expect(resolveAccessScope("multi@photonbrothers.com", { scopeEnforcementEnabled: true })).resolves.toMatchObject({
      scope: { type: "global" },
    });
  });
});
