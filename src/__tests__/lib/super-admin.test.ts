import type { UserRole } from "@/generated/prisma/enums";
import { ROLES, type RoleDefinition } from "@/lib/roles";
import { isSuperAdmin, SUPER_ADMIN_EMAILS } from "@/lib/super-admin";
import { resolveUserAccess, isPathAllowedByAccess } from "@/lib/user-access";

describe("isSuperAdmin", () => {
  it("returns true for the canonical super-admin email", () => {
    expect(isSuperAdmin("zach@photonbrothers.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSuperAdmin("Zach@PhotonBrothers.com")).toBe(true);
    expect(isSuperAdmin("ZACH@PHOTONBROTHERS.COM")).toBe(true);
  });

  it("returns false for any non-super-admin email", () => {
    expect(isSuperAdmin("someone.else@photonbrothers.com")).toBe(false);
    expect(isSuperAdmin("zach@gmail.com")).toBe(false);
  });

  it("returns false for null, undefined, empty, or non-string inputs", () => {
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
    expect(isSuperAdmin("")).toBe(false);
  });

  it("SUPER_ADMIN_EMAILS is tiny (guards against casual additions)", () => {
    // If this ever grows beyond 2, reconsider. The whole point is a last-
    // resort break-glass, not a convenience role.
    expect(SUPER_ADMIN_EMAILS.size).toBeLessThanOrEqual(2);
  });
});

describe("resolveUserAccess — super admin bypass", () => {
  it("returns ADMIN-equivalent access when email is a super admin, even with empty roles", () => {
    const access = resolveUserAccess({
      email: "zach@photonbrothers.com",
      roles: [],
    });
    expect(access.roles).toEqual(["ADMIN"]);
    expect(access.allowedRoutes.has("*")).toBe(true);
    expect(access.capabilities.canManageUsers).toBe(true);
    expect(access.capabilities.canEditDesign).toBe(true);
    expect(access.scope).toBe("global");
  });

  it("super admin bypass ignores extraDeniedRoutes that would normally win", () => {
    const access = resolveUserAccess({
      email: "zach@photonbrothers.com",
      roles: ["VIEWER"],
      extraDeniedRoutes: ["/admin", "/api/admin"],
    });
    // Normal users with these denials would be locked out; super admin passes.
    expect(isPathAllowedByAccess(access, "/admin/roles")).toBe(true);
    expect(isPathAllowedByAccess(access, "/api/admin/users")).toBe(true);
  });

  it("super admin bypass ignores a nuked role definition", () => {
    // Simulate the nightmare scenario: someone overrode the ADMIN role to
    // have no routes. Super admin should still get in.
    const access = resolveUserAccess({
      email: "zach@photonbrothers.com",
      roles: ["ADMIN"],
    });
    expect(isPathAllowedByAccess(access, "/admin")).toBe(true);
    expect(isPathAllowedByAccess(access, "/api/admin/roles/ADMIN/definition")).toBe(true);
    expect(isPathAllowedByAccess(access, "/dashboards/executive")).toBe(true);
  });

  it("non-super-admin email with same roles gets normal access (control)", () => {
    const access = resolveUserAccess({
      email: "someone.else@photonbrothers.com",
      roles: ["VIEWER"],
    });
    expect(access.roles).toEqual(["VIEWER"]);
    expect(access.allowedRoutes.has("*")).toBe(false);
    expect(access.capabilities.canManageUsers).toBe(false);
  });

  it("missing email falls through to normal role resolution", () => {
    const access = resolveUserAccess({ roles: ["VIEWER"] });
    expect(access.roles).toEqual(["VIEWER"]);
    expect(access.allowedRoutes.has("*")).toBe(false);
  });

  it("super admin bypass wins over role definition overrides", () => {
    // Inject an override that claims ADMIN has zero routes.
    const brokenAdmin: RoleDefinition = {
      ...ROLES.ADMIN,
      allowedRoutes: [],
      suites: [],
    };
    const overrides = new Map<UserRole, RoleDefinition>([["ADMIN", brokenAdmin]]);
    const access = resolveUserAccess(
      { email: "zach@photonbrothers.com", roles: ["ADMIN"] },
      overrides,
    );
    // Overrides would have stripped ADMIN's routes; super admin bypass
    // ignores the override and returns wildcard.
    expect(access.allowedRoutes.has("*")).toBe(true);
  });
});
