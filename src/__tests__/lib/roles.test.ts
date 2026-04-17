import { describe, it, expect } from "@jest/globals";
import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

describe("ROLES map", () => {
  it("has exactly one entry per UserRole enum value", () => {
    const enumValues = Object.values(UserRole);
    const mapKeys = Object.keys(ROLES).sort();
    expect(mapKeys).toEqual([...enumValues].sort());
  });

  it("every normalizesTo target is itself a canonical role (visibleInPicker: true)", () => {
    for (const [role, def] of Object.entries(ROLES)) {
      if (def.normalizesTo !== role) {
        expect(ROLES[def.normalizesTo].visibleInPicker, `${role} normalizes to ${def.normalizesTo} which must be canonical`).toBe(true);
      }
    }
  });

  it("every role has badge color + abbrev", () => {
    for (const [role, def] of Object.entries(ROLES)) {
      expect(def.badge.color, `${role} badge.color`).toMatch(/^[a-z-]+$/);
      expect(def.badge.abbrev, `${role} badge.abbrev`).toBeTruthy();
    }
  });
});
