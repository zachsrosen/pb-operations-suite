import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import {
  isPathAllowedByAccess,
  resolveUserAccess,
} from "@/lib/user-access";

/**
 * Unit tests for Option D — per-user extra allowed/denied routes.
 *
 * Rules under test:
 *  1. `extraAllowedRoutes` adds to the role union.
 *  2. `extraDeniedRoutes` subtracts from the final allowance, winning over
 *     role grants, extra-allowed, AND the ADMIN wildcard.
 *  3. Admin-only routes still require the ADMIN canonical role EXCEPT when
 *     a matching extra-allow grants access — but only if the path is NOT
 *     in ADMIN_ONLY_ROUTES. (Extras cannot elevate non-admins past admin
 *     gates; they're orthogonal to the admin gate.)
 *  4. Denied wins even if the path isn't admin-gated and the user has
 *     wildcard allowedRoutes.
 */

describe("resolveUserAccess with per-user extras", () => {
  it("extraAllowedRoutes adds a route not in the role union", () => {
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      extraAllowedRoutes: ["/dashboards/capacity-report"],
    });
    expect(access.allowedRoutes.has("/dashboards/capacity-report")).toBe(true);
    expect(isPathAllowedByAccess(access, "/dashboards/capacity-report")).toBe(true);
  });

  it("extraDeniedRoutes blocks a route in the role union", () => {
    // SERVICE role grants /dashboards/service-tickets
    expect(ROLES.SERVICE.allowedRoutes).toContain("/dashboards/service-tickets");
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      extraDeniedRoutes: ["/dashboards/service-tickets"],
    });
    expect(access.deniedRoutes.has("/dashboards/service-tickets")).toBe(true);
    expect(isPathAllowedByAccess(access, "/dashboards/service-tickets")).toBe(false);
  });

  it("extraDeniedRoutes wins over extraAllowedRoutes for the same path", () => {
    const access = resolveUserAccess({
      roles: ["VIEWER"],
      extraAllowedRoutes: ["/dashboards/reports"],
      extraDeniedRoutes: ["/dashboards/reports"],
    });
    expect(isPathAllowedByAccess(access, "/dashboards/reports")).toBe(false);
  });

  it("extraDeniedRoutes wins over ADMIN wildcard", () => {
    // ADMIN has "*" in allowedRoutes. A denied entry should still block.
    const access = resolveUserAccess({
      roles: ["ADMIN"],
      extraDeniedRoutes: ["/dashboards/forecast-timeline"],
    });
    expect(access.allowedRoutes.has("*")).toBe(true);
    expect(isPathAllowedByAccess(access, "/dashboards/forecast-timeline")).toBe(false);
    // But admin's other paths still work
    expect(isPathAllowedByAccess(access, "/dashboards/deals")).toBe(true);
  });

  it("extraDeniedRoutes uses segment-boundary matching like the allow list", () => {
    const access = resolveUserAccess({
      roles: ["ADMIN"],
      extraDeniedRoutes: ["/dashboards/catalog"],
    });
    // Exact match: denied
    expect(isPathAllowedByAccess(access, "/dashboards/catalog")).toBe(false);
    // Segment-boundary subpath: also denied
    expect(isPathAllowedByAccess(access, "/dashboards/catalog/new")).toBe(false);
    // Different route that merely shares a prefix: NOT denied
    expect(isPathAllowedByAccess(access, "/dashboards/catalogue")).toBe(true);
  });

  it("extraAllowedRoutes does NOT grant access to an admin-only route for a non-admin", () => {
    // /admin is in ADMIN_ONLY_ROUTES. Granting a non-admin an extra-allow
    // for it should not let them through the admin gate. (Admin gate runs
    // after the deny check but before the allow check.)
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      extraAllowedRoutes: ["/admin/users"],
    });
    expect(isPathAllowedByAccess(access, "/admin/users")).toBe(false);
  });

  it("null or missing extras arrays are treated as empty (no effect)", () => {
    const withNull = resolveUserAccess({
      roles: ["SERVICE"],
      extraAllowedRoutes: null,
      extraDeniedRoutes: null,
    });
    const withoutField = resolveUserAccess({
      roles: ["SERVICE"],
    });
    expect(withNull.deniedRoutes.size).toBe(0);
    expect(withoutField.deniedRoutes.size).toBe(0);
    // allowedRoutes should match the role union exactly
    for (const r of ROLES.SERVICE.allowedRoutes) {
      expect(withNull.allowedRoutes.has(r)).toBe(true);
      expect(withoutField.allowedRoutes.has(r)).toBe(true);
    }
  });

  it("empty-string and whitespace entries in extras are ignored", () => {
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      extraAllowedRoutes: ["", "   ", "/dashboards/valid"],
      extraDeniedRoutes: [""],
    });
    expect(access.allowedRoutes.has("/dashboards/valid")).toBe(true);
    expect(access.allowedRoutes.has("")).toBe(false);
    expect(access.deniedRoutes.has("")).toBe(false);
  });

  it("multi-role user still honors per-user denials", () => {
    const access = resolveUserAccess({
      roles: ["SALES", "SERVICE" as UserRole],
      extraDeniedRoutes: ["/dashboards/service-tickets"],
    });
    expect(isPathAllowedByAccess(access, "/dashboards/service-tickets")).toBe(false);
  });
});
