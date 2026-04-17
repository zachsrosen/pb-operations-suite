import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import {
  resolveEffectiveRole,
  resolveUserAccess,
} from "@/lib/user-access";

describe("resolveEffectiveRole", () => {
  it("single role returns that role's definition fields", () => {
    const eff = resolveEffectiveRole(["SALES"]);
    expect(eff.suites).toEqual(ROLES.SALES.suites);
    expect(eff.allowedRoutes).toEqual(ROLES.SALES.allowedRoutes);
    expect(eff.landingCards).toEqual(ROLES.SALES.landingCards);
    expect(eff.scope).toBe(ROLES.SALES.scope);
    expect(eff.defaultCapabilities).toEqual(ROLES.SALES.defaultCapabilities);
  });

  it("multi-role unions suites + allowedRoutes", () => {
    const eff = resolveEffectiveRole(["SALES", "SERVICE"]);
    // Union should contain entries from both
    for (const s of ROLES.SALES.suites) expect(eff.suites).toContain(s);
    for (const s of ROLES.SERVICE.suites) expect(eff.suites).toContain(s);
    for (const r of ROLES.SALES.allowedRoutes) expect(eff.allowedRoutes).toContain(r);
    for (const r of ROLES.SERVICE.allowedRoutes) expect(eff.allowedRoutes).toContain(r);
    // No duplicates
    expect(new Set(eff.suites).size).toBe(eff.suites.length);
    expect(new Set(eff.allowedRoutes).size).toBe(eff.allowedRoutes.length);
  });

  it("multi-role max-privileges scope (global > location > owner)", () => {
    // SALES is owner, OPERATIONS is location, SERVICE is global
    expect(resolveEffectiveRole(["SALES"]).scope).toBe("owner");
    expect(resolveEffectiveRole(["SALES", "OPERATIONS"]).scope).toBe("location");
    expect(resolveEffectiveRole(["SALES", "OPERATIONS", "SERVICE"]).scope).toBe(
      "global",
    );
    expect(resolveEffectiveRole(["OPERATIONS", "SALES"]).scope).toBe("location");
  });

  it("multi-role ORs default capabilities", () => {
    // SALES: canScheduleSurveys=true, canManageAvailability=false
    // OPERATIONS: canScheduleSurveys=false, canManageAvailability=true
    const eff = resolveEffectiveRole(["SALES", "OPERATIONS"]);
    expect(eff.defaultCapabilities.canScheduleSurveys).toBe(true);
    expect(eff.defaultCapabilities.canManageAvailability).toBe(true);
    // neither grants canManageUsers
    expect(eff.defaultCapabilities.canManageUsers).toBe(false);
    // neither grants canEditDesign
    expect(eff.defaultCapabilities.canEditDesign).toBe(false);
  });

  it("legacy role normalizes to its canonical target", () => {
    // MANAGER -> PROJECT_MANAGER
    const legacy = resolveEffectiveRole(["MANAGER"]);
    const canonical = resolveEffectiveRole(["PROJECT_MANAGER"]);
    expect(legacy.suites).toEqual(canonical.suites);
    expect(legacy.allowedRoutes).toEqual(canonical.allowedRoutes);
    expect(legacy.landingCards).toEqual(canonical.landingCards);
    expect(legacy.scope).toBe(canonical.scope);
    expect(legacy.defaultCapabilities).toEqual(canonical.defaultCapabilities);
  });

  it("unknown role string is filtered out with a console.warn", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const eff = resolveEffectiveRole([
        "NOT_A_ROLE" as unknown as UserRole,
        "SALES",
      ]);
      // SALES should still be effective
      expect(eff.suites).toEqual(ROLES.SALES.suites);
      expect(warn).toHaveBeenCalled();
      // The warn message should include the unknown role name
      const calls = warn.mock.calls.flat().map(String).join(" ");
      expect(calls).toContain("NOT_A_ROLE");
    } finally {
      warn.mockRestore();
    }
  });

  it("empty roles array returns VIEWER-equivalent (no suites, viewer-fallback routes, owner scope, all caps false)", () => {
    const eff = resolveEffectiveRole([]);
    expect(eff.suites).toEqual([]);
    expect(eff.allowedRoutes).toEqual([
      "/",
      "/unassigned",
      "/api/auth",
      "/api/user/me",
    ]);
    expect(eff.landingCards).toEqual([]);
    expect(eff.scope).toBe("owner");
    for (const v of Object.values(eff.defaultCapabilities)) {
      expect(v).toBe(false);
    }
  });
});

describe("resolveUserAccess", () => {
  it("user.canSyncToZuper=null falls back to role default", () => {
    // SERVICE role defaults canSyncZuper=true
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      canSyncToZuper: null,
    });
    expect(access.capabilities.canSyncZuper).toBe(true);
  });

  it("user.canSyncToZuper=false overrides role default", () => {
    const access = resolveUserAccess({
      roles: ["SERVICE"],
      canSyncToZuper: false,
    });
    expect(access.capabilities.canSyncZuper).toBe(false);
  });

  it("user.canSyncToZuper=true overrides role default from false", () => {
    // TECH_OPS defaults canSyncZuper=false
    const access = resolveUserAccess({
      roles: ["TECH_OPS"],
      canSyncToZuper: true,
    });
    expect(access.capabilities.canSyncZuper).toBe(true);
  });

  it("landing cards deduped by href", () => {
    // OPERATIONS and OPERATIONS_MANAGER both declare /dashboards/scheduler
    const access = resolveUserAccess({
      roles: ["OPERATIONS", "OPERATIONS_MANAGER"],
    });
    const hrefs = access.landingCards.map((c) => c.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("landing cards capped at 10", () => {
    // Build up more than 10 cards. PROJECT_MANAGER (5) + OPERATIONS (7) +
    // TECH_OPS (4) + SERVICE (3) => 19 cards pre-dedup. After dedup still >10.
    const access = resolveUserAccess({
      roles: ["PROJECT_MANAGER", "OPERATIONS", "TECH_OPS", "SERVICE"],
    });
    expect(access.landingCards.length).toBeLessThanOrEqual(10);
  });

  it("landing-card collision: first-declared role wins for display payload", () => {
    // OPERATIONS_MANAGER and OPERATIONS both have /dashboards/scheduler with
    // identical payloads, but the ordering invariant still matters. Make the
    // test robust by asserting the first-seen card wins for any colliding href.
    const rolesOrdered: UserRole[] = ["OPERATIONS_MANAGER", "OPERATIONS"];
    const access = resolveUserAccess({ roles: rolesOrdered });
    // Manually compute first-seen map from the role order.
    const firstSeen = new Map<string, unknown>();
    for (const r of rolesOrdered) {
      for (const card of ROLES[r].landingCards) {
        if (!firstSeen.has(card.href)) firstSeen.set(card.href, card);
      }
    }
    for (const card of access.landingCards) {
      expect(firstSeen.get(card.href)).toEqual(card);
    }
  });

  it("falls back to [user.role] when user.roles is empty (Phase 1 back-compat)", () => {
    // No `roles` array at all — just `role`.
    const access = resolveUserAccess({ role: "SALES" });
    expect(access.roles).toEqual(["SALES"]);
    expect(Array.from(access.suites)).toEqual(ROLES.SALES.suites);

    // Empty roles array — should also fall back.
    const access2 = resolveUserAccess({ roles: [], role: "SALES" });
    expect(access2.roles).toEqual(["SALES"]);
  });
});
