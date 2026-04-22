import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

const ROLE_ENTRIES = Object.entries(ROLES);
const VALID_SCOPES = ["global", "location", "owner"] as const;

describe("ROLES map", () => {
  it("has exactly one entry per UserRole enum value", () => {
    const enumValues = Object.values(UserRole);
    const mapKeys = Object.keys(ROLES).sort();
    expect(mapKeys).toEqual([...enumValues].sort());
  });

  it.each(ROLE_ENTRIES)(
    "%s: normalizesTo target is itself canonical (visibleInPicker: true)",
    (role, def) => {
      if (def.normalizesTo !== role) {
        expect(ROLES[def.normalizesTo].visibleInPicker).toBe(true);
      }
    },
  );

  it.each(ROLE_ENTRIES)(
    "%s: badge has tailwind-friendly color + truthy abbrev",
    (_role, def) => {
      expect(def.badge.color).toMatch(/^[a-z-]+$/);
      expect(def.badge.abbrev).toBeTruthy();
    },
  );

  it.each(ROLE_ENTRIES)(
    "%s: scope is valid",
    (_role, def) => {
      expect(VALID_SCOPES).toContain(def.scope);
    },
  );
});

describe("scoped suite roles (Phase 1)", () => {
  it.each([
    ["DESIGN", "/suites/design-engineering"],
    ["PERMIT", "/suites/permitting-interconnection"],
    ["INTERCONNECT", "/suites/permitting-interconnection"],
    ["INTELLIGENCE", "/suites/intelligence"],
    ["ROOFING", "/suites/dnr-roofing"],
    ["MARKETING", "/suites/sales-marketing"],
  ] as const)("%s has exactly one suite: %s", (role, expectedSuite) => {
    const def = ROLES[role as UserRole];
    expect(def.suites).toEqual([expectedSuite]);
  });

  it.each([
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "INTELLIGENCE",
    "ROOFING",
    "MARKETING",
  ] as const)("%s does NOT grant Operations suite access", (role) => {
    const def = ROLES[role as UserRole];
    expect(def.suites).not.toContain("/suites/operations");
    expect(def.allowedRoutes).not.toContain("/suites/operations");
  });

  it.each([
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "INTELLIGENCE",
    "ROOFING",
    "MARKETING",
  ] as const)("%s cannot manage users", (role) => {
    expect(ROLES[role as UserRole].defaultCapabilities.canManageUsers).toBe(false);
  });

  it("MARKETING is read-only (no scheduling, no Zuper sync)", () => {
    const caps = ROLES.MARKETING.defaultCapabilities;
    expect(caps.canScheduleSurveys).toBe(false);
    expect(caps.canScheduleInstalls).toBe(false);
    expect(caps.canScheduleInspections).toBe(false);
    expect(caps.canSyncZuper).toBe(false);
  });

  it("SALES now lands on Sales & Marketing suite", () => {
    expect(ROLES.SALES.suites).toContain("/suites/sales-marketing");
    expect(ROLES.SALES.allowedRoutes).toContain("/suites/sales-marketing");
  });

  it("ADMIN, EXECUTIVE, SALES_MANAGER include the new suite", () => {
    expect(ROLES.ADMIN.suites).toContain("/suites/sales-marketing");
    expect(ROLES.EXECUTIVE.suites).toContain("/suites/sales-marketing");
    expect(ROLES.SALES_MANAGER.suites).toContain("/suites/sales-marketing");
  });
});

describe("accounting suite tightening", () => {
  it.each([
    "OPERATIONS",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "TECH_OPS",
    "SALES_MANAGER",
    "SALES",
    "SERVICE",
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "INTELLIGENCE",
    "ROOFING",
    "MARKETING",
    "VIEWER",
  ] as const)("%s cannot access /suites/accounting", (role) => {
    const def = ROLES[role as UserRole];
    expect(def.suites).not.toContain("/suites/accounting");
    expect(def.allowedRoutes).not.toContain("/suites/accounting");
  });

  it.each([
    "OPERATIONS",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "TECH_OPS",
    "SALES_MANAGER",
  ] as const)("%s does not have accounting-only dashboard routes", (role) => {
    const def = ROLES[role as UserRole];
    expect(def.allowedRoutes).not.toContain("/dashboards/pe-deals");
    expect(def.allowedRoutes).not.toContain("/dashboards/pe");
    expect(def.allowedRoutes).not.toContain("/api/accounting");
    expect(def.allowedRoutes).not.toContain("/dashboards/payment-tracking");
    expect(def.allowedRoutes).not.toContain("/dashboards/payment-action-queue");
  });

  it("only ADMIN, EXECUTIVE, and ACCOUNTING (and OWNER-legacy-mirror) have /suites/accounting", () => {
    const rolesWithAccounting = (Object.entries(ROLES) as Array<[UserRole, (typeof ROLES)[UserRole]]>)
      .filter(([, def]) => def.suites.includes("/suites/accounting"))
      .map(([role]) => role)
      .sort();
    // OWNER is a legacy role that mirrors EXECUTIVE's suites, so it also shows here.
    expect(rolesWithAccounting).toEqual(["ACCOUNTING", "ADMIN", "EXECUTIVE", "OWNER"]);
  });
});

describe("OPERATIONS role narrowing", () => {
  it("OPERATIONS does not access D&R + Roofing suite", () => {
    expect(ROLES.OPERATIONS.suites).not.toContain("/suites/dnr-roofing");
    expect(ROLES.OPERATIONS.allowedRoutes).not.toContain("/suites/dnr-roofing");
  });

  it("OPERATIONS does not have D&R or Roofing dashboard routes", () => {
    const routes = ROLES.OPERATIONS.allowedRoutes;
    expect(routes).not.toContain("/dashboards/dnr");
    expect(routes).not.toContain("/dashboards/dnr-scheduler");
    expect(routes).not.toContain("/dashboards/roofing");
    expect(routes).not.toContain("/dashboards/roofing-scheduler");
  });

  it("OPERATIONS keeps Operations + Service suite access", () => {
    expect(ROLES.OPERATIONS.suites).toEqual(["/suites/operations", "/suites/service"]);
  });
});
