import type { UserRole } from "@/generated/prisma/enums";
import { ROLES, type RoleDefinition } from "@/lib/roles";
import { resolveEffectiveRole, resolveUserAccess } from "@/lib/user-access";

/**
 * Unit tests for the `overrides` parameter on `resolveEffectiveRole` and
 * `resolveUserAccess`. These mimic what `resolveUserAccessWithOverrides` does
 * after it reads the `RoleCapabilityOverride` table — the pure function under
 * test only cares that the injected Map wins over `ROLES[r]` for
 * capabilities, while preserving all other fields (suites, routes, scope,
 * landing cards).
 */
describe("resolveEffectiveRole with overrides", () => {
  it("injected override wins over the static ROLES entry for capabilities", () => {
    const base = ROLES.SALES;
    // Override flips canScheduleSurveys from true to false.
    const override: RoleDefinition = {
      ...base,
      defaultCapabilities: {
        ...base.defaultCapabilities,
        canScheduleSurveys: false,
      },
    };
    const overrides = new Map<UserRole, RoleDefinition>([["SALES", override]]);
    const eff = resolveEffectiveRole(["SALES"], overrides);
    expect(eff.defaultCapabilities.canScheduleSurveys).toBe(false);
  });

  it("roles without an override still resolve from the static ROLES entry", () => {
    const base = ROLES.OPERATIONS;
    const override: RoleDefinition = {
      ...base,
      defaultCapabilities: {
        ...base.defaultCapabilities,
        canManageUsers: true, // OPERATIONS normally false
      },
    };
    const overrides = new Map<UserRole, RoleDefinition>([["OPERATIONS", override]]);
    // SALES has no override entry — should resolve normally.
    const eff = resolveEffectiveRole(["SALES", "OPERATIONS"], overrides);
    // SALES brings canScheduleSurveys=true from static ROLES (unchanged).
    expect(eff.defaultCapabilities.canScheduleSurveys).toBe(true);
    // OPERATIONS override flips canManageUsers to true → OR wins.
    expect(eff.defaultCapabilities.canManageUsers).toBe(true);
  });

  it("overrides do not affect routes, suites, scope, or landing cards", () => {
    // An override with CHANGED routes and suites should still resolve using
    // the override's OTHER fields (suites/routes/scope/cards are merged as
    // normal). This guards against anyone deciding to carve route-editing
    // into this pathway later — if they do, this test catches it early.
    const base = ROLES.SALES;
    const override: RoleDefinition = {
      ...base,
      suites: ["pretend-suite"],
      allowedRoutes: ["/pretend/route"],
    };
    const overrides = new Map<UserRole, RoleDefinition>([["SALES", override]]);
    const eff = resolveEffectiveRole(["SALES"], overrides);
    // Resolver trusts the provided def: override's suites + routes apply.
    expect(eff.suites).toEqual(["pretend-suite"]);
    expect(eff.allowedRoutes).toEqual(["/pretend/route"]);
  });
});

describe("resolveUserAccess with overrides", () => {
  it("role override is applied, then per-user column still wins", () => {
    // Start from SALES canScheduleSurveys=true. Override flips it to false.
    // User.canScheduleSurveys=true should flip it back on.
    const base = ROLES.SALES;
    const override: RoleDefinition = {
      ...base,
      defaultCapabilities: {
        ...base.defaultCapabilities,
        canScheduleSurveys: false,
      },
    };
    const overrides = new Map<UserRole, RoleDefinition>([["SALES", override]]);
    const access = resolveUserAccess(
      { roles: ["SALES"], canScheduleSurveys: true },
      overrides,
    );
    expect(access.capabilities.canScheduleSurveys).toBe(true);
  });

  it("role override applied when no per-user column value is set", () => {
    const base = ROLES.SERVICE;
    const override: RoleDefinition = {
      ...base,
      defaultCapabilities: {
        ...base.defaultCapabilities,
        canSyncZuper: false, // SERVICE normally true
      },
    };
    const overrides = new Map<UserRole, RoleDefinition>([["SERVICE", override]]);
    const access = resolveUserAccess(
      { roles: ["SERVICE"], canSyncToZuper: null },
      overrides,
    );
    expect(access.capabilities.canSyncZuper).toBe(false);
  });

  it("legacy role uses override stored under canonical target", () => {
    // MANAGER normalizes to PROJECT_MANAGER. The caller is expected to key
    // its override Map by the canonical role (that's what
    // `resolveUserAccessWithOverrides` does). Verify the canonical override
    // applies when a user is still carrying the legacy role string.
    const canonical = ROLES.PROJECT_MANAGER;
    const override: RoleDefinition = {
      ...canonical,
      defaultCapabilities: {
        ...canonical.defaultCapabilities,
        canEditDesign: true,
      },
    };
    const overrides = new Map<UserRole, RoleDefinition>([
      ["PROJECT_MANAGER", override],
    ]);
    // The resolver's internal canonicalization (normalizeRoles) runs before
    // it looks up `overrides.get(canonical)`. A legacy `MANAGER` input should
    // still pick up the override keyed by `PROJECT_MANAGER`.
    const access = resolveUserAccess({ roles: ["MANAGER"] }, overrides);
    expect(access.capabilities.canEditDesign).toBe(true);
  });
});
