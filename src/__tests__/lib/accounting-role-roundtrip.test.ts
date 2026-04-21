import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

describe("ACCOUNTING role", () => {
  it("exists in the Prisma UserRole enum", () => {
    expect(UserRole.ACCOUNTING).toBe("ACCOUNTING");
  });

  it("has a RoleDefinition registered in ROLES", () => {
    expect(ROLES.ACCOUNTING).toBeDefined();
    expect(ROLES.ACCOUNTING.suites).toContain("/suites/accounting");
  });

  it("has /dashboards/payment-tracking in allowedRoutes", () => {
    expect(ROLES.ACCOUNTING.allowedRoutes).toContain("/dashboards/payment-tracking");
  });

  it("has /api/accounting in allowedRoutes (prefix covers payment-tracking sub-route)", () => {
    expect(ROLES.ACCOUNTING.allowedRoutes).toContain("/api/accounting");
  });

  it("has no scheduling or editing capabilities", () => {
    const caps = ROLES.ACCOUNTING.defaultCapabilities;
    expect(caps.canScheduleSurveys).toBe(false);
    expect(caps.canScheduleInstalls).toBe(false);
    expect(caps.canScheduleInspections).toBe(false);
    expect(caps.canEditDesign).toBe(false);
    expect(caps.canEditPermitting).toBe(false);
    expect(caps.canManageUsers).toBe(false);
  });
});
