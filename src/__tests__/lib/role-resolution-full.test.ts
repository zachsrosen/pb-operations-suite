jest.mock("server-only", () => ({}), { virtual: true });

const mockCapFindUnique = jest.fn();
const mockDefFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  prisma: {
    roleCapabilityOverride: { findUnique: (...a: unknown[]) => mockCapFindUnique(...a) },
    roleDefinitionOverride: { findUnique: (...a: unknown[]) => mockDefFindUnique(...a) },
  },
}));

// Import after mock so the module picks up the mocked prisma.
import { resolveRoleDefinition, invalidateRoleCache } from "@/lib/role-resolution";
import { ROLES } from "@/lib/roles";

beforeEach(() => {
  jest.clearAllMocks();
  invalidateRoleCache(); // wipe module-level cache between tests
  mockCapFindUnique.mockResolvedValue(null);
  mockDefFindUnique.mockResolvedValue(null);
});

describe("resolveRoleDefinition — definition overrides", () => {
  it("falls back to code defaults when no override row exists", async () => {
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.allowedRoutes).toEqual(ROLES.OPERATIONS.allowedRoutes);
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
    expect(def.landingCards).toEqual(ROLES.OPERATIONS.landingCards);
  });

  it("replaces allowedRoutes when the override provides an allowedRoutes key", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { allowedRoutes: ["/", "/dashboards/custom"] },
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.allowedRoutes).toEqual(["/", "/dashboards/custom"]);
    // Unaffected fields stay at code default.
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
  });

  it("empty-array override replaces (does not inherit)", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { landingCards: [] },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.landingCards).toEqual([]);
    expect(def.allowedRoutes).toEqual(ROLES.SERVICE.allowedRoutes); // untouched
  });

  it("merges capability + definition overrides in one resolve", async () => {
    mockCapFindUnique.mockResolvedValue({
      role: "SERVICE",
      canScheduleInstalls: true, // default is false
      canScheduleSurveys: null,
      canScheduleInspections: null,
      canSyncZuper: null,
      canManageUsers: null,
      canManageAvailability: null,
      canEditDesign: null,
      canEditPermitting: null,
      canViewAllLocations: null,
    });
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { label: "Service (custom)" },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.defaultCapabilities.canScheduleInstalls).toBe(true); // capability merge
    expect(def.label).toBe("Service (custom)"); // definition merge
    expect(def.description).toBe(ROLES.SERVICE.description); // unchanged
  });

  it("badge partial override merges color only, keeps abbrev", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "SERVICE",
      override: { badge: { color: "purple" } },
    });
    const def = await resolveRoleDefinition("SERVICE");
    expect(def.badge.color).toBe("purple");
    expect(def.badge.abbrev).toBe(ROLES.SERVICE.badge.abbrev);
  });

  it("caps landingCards at 10 on read (matches LANDING_CARDS_MAX)", async () => {
    const manyCards = Array.from({ length: 15 }, (_, i) => ({
      href: `/dashboards/x-${i}`,
      title: `T${i}`,
      description: "d",
      tag: "T",
      tagColor: "blue",
    }));
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { landingCards: manyCards },
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    expect(def.landingCards).toHaveLength(10);
  });

  it("malformed JSONB override (wrong types) falls back to code defaults and does not throw", async () => {
    mockDefFindUnique.mockResolvedValue({
      role: "OPERATIONS",
      override: { allowedRoutes: "not an array" }, // wrong shape
    });
    const def = await resolveRoleDefinition("OPERATIONS");
    // Bad field ignored; others still resolve from code.
    expect(def.allowedRoutes).toEqual(ROLES.OPERATIONS.allowedRoutes);
    expect(def.suites).toEqual(ROLES.OPERATIONS.suites);
  });

  it("invalidateRoleCache(role) busts the cache so a subsequent call re-reads the DB", async () => {
    mockDefFindUnique.mockResolvedValueOnce(null);
    await resolveRoleDefinition("OPERATIONS");
    // Second call without invalidate would return the cached value without hitting DB.
    mockDefFindUnique.mockResolvedValueOnce({
      role: "OPERATIONS",
      override: { label: "Ops (renamed)" },
    });
    invalidateRoleCache("OPERATIONS");
    const def2 = await resolveRoleDefinition("OPERATIONS");
    expect(def2.label).toBe("Ops (renamed)");
  });

  it("calling resolveRoleDefinition('OWNER') directly does NOT apply an EXECUTIVE override (documents the contract)", async () => {
    // Per spec §Resolver changes: resolveRoleDefinition does NOT normalize.
    // Normalization is the contract of resolveUserAccessWithOverrides only.
    // So an override stored under EXECUTIVE does NOT affect a direct OWNER lookup.
    mockDefFindUnique.mockImplementation(({ where }: { where: { role: string } }) =>
      Promise.resolve(
        where.role === "EXECUTIVE"
          ? { role: "EXECUTIVE", override: { label: "Exec (custom)" } }
          : null,
      ),
    );
    const ownerDef = await resolveRoleDefinition("OWNER");
    // OWNER's own base label (from ROLES.OWNER) is "Owner". EXECUTIVE's override
    // is "Exec (custom)". OWNER lookup should return the OWNER base, unmodified.
    expect(ownerDef.label).toBe(ROLES.OWNER.label);
    expect(ownerDef.label).not.toBe("Exec (custom)");
  });
});
