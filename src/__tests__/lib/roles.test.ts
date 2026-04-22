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
