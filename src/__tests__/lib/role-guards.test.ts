import { validateRoleEdit } from "@/lib/role-guards";
import type { RoleDefinitionOverridePayload } from "@/lib/role-override-types";

describe("validateRoleEdit — generic invariants", () => {
  it("accepts an empty payload (inherit everything)", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", {})).toEqual([]);
  });

  it("rejects an allowedRoutes entry that does not start with / or *", () => {
    const payload: RoleDefinitionOverridePayload = { allowedRoutes: ["dashboards/foo"] };
    const v = validateRoleEdit("PROJECT_MANAGER", payload);
    expect(v).toHaveLength(1);
    expect(v[0].field).toBe("allowedRoutes");
  });

  it("accepts * as a valid allowedRoute entry", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", { allowedRoutes: ["*"] })).toEqual([]);
  });

  it("rejects a suites entry that does not start with /suites/", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { suites: ["/dashboards/foo"] });
    expect(v[0].field).toBe("suites");
  });

  it("accepts empty arrays (valid override meaning 'no suites/routes/cards')", () => {
    expect(
      validateRoleEdit("SALES", { suites: [], allowedRoutes: [], landingCards: [] }),
    ).toEqual([]);
  });

  it("rejects landingCards with a non-/ href", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      landingCards: [
        {
          href: "dashboards/foo",
          title: "X",
          description: "Y",
          tag: "T",
          tagColor: "blue",
        },
      ],
    });
    expect(v[0].field).toBe("landingCards");
  });

  it("rejects landingCards longer than 10 entries", () => {
    const cards = Array.from({ length: 11 }, (_, i) => ({
      href: `/dashboards/card-${i}`,
      title: `C${i}`,
      description: "D",
      tag: "T",
      tagColor: "blue",
    }));
    const v = validateRoleEdit("PROJECT_MANAGER", { landingCards: cards });
    expect(v[0].field).toBe("landingCards");
  });

  it("rejects badge.color outside the allowed palette", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { badge: { color: "magenta" } });
    expect(v[0].field).toBe("badge");
  });

  it("accepts badge.color from the allowed palette", () => {
    expect(validateRoleEdit("PROJECT_MANAGER", { badge: { color: "indigo" } })).toEqual([]);
  });

  it("rejects badge.abbrev longer than 16 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      badge: { abbrev: "ABCDEFGHIJKLMNOPQ" }, // 17 chars
    });
    expect(v[0].field).toBe("badge");
  });

  it("rejects invalid scope values", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", {
      scope: "company" as unknown as "global",
    });
    expect(v[0].field).toBe("scope");
  });

  it("rejects label longer than 40 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { label: "a".repeat(41) });
    expect(v[0].field).toBe("label");
  });

  it("rejects description longer than 200 chars", () => {
    const v = validateRoleEdit("PROJECT_MANAGER", { description: "a".repeat(201) });
    expect(v[0].field).toBe("description");
  });
});

describe("validateRoleEdit — ADMIN lockout prevention", () => {
  it("rejects ADMIN allowedRoutes that drops both * and /admin", () => {
    const v = validateRoleEdit("ADMIN", { allowedRoutes: ["/dashboards/service"] });
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "allowedRoutes" }),
      ]),
    );
  });

  it("accepts ADMIN allowedRoutes = ['*']", () => {
    expect(validateRoleEdit("ADMIN", { allowedRoutes: ["*"] })).toEqual([]);
  });

  it("accepts ADMIN allowedRoutes that includes /admin AND /api/admin", () => {
    expect(
      validateRoleEdit("ADMIN", {
        allowedRoutes: ["/", "/admin", "/api/admin", "/dashboards/service"],
      }),
    ).toEqual([]);
  });

  it("rejects ADMIN allowedRoutes that has /admin but is missing /api/admin", () => {
    const v = validateRoleEdit("ADMIN", { allowedRoutes: ["/admin"] });
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "allowedRoutes" }),
      ]),
    );
  });

  it("does NOT apply the ADMIN guard to non-ADMIN roles", () => {
    // SALES can legitimately have an allowedRoutes list without /admin
    expect(
      validateRoleEdit("SALES", { allowedRoutes: ["/", "/dashboards/sales"] }),
    ).toEqual([]);
  });

  it("does NOT apply the ADMIN guard when the role's allowedRoutes key is absent (inherit mode)", () => {
    // No override on allowedRoutes means inherit ROLES.ADMIN's allowedRoutes = ["*"],
    // so there's no lockout risk. Guard should pass.
    expect(validateRoleEdit("ADMIN", { label: "Admin (renamed)" })).toEqual([]);
  });
});
