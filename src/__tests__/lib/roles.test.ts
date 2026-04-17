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
