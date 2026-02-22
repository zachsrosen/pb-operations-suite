import { canAccessRoute } from "@/lib/role-permissions";

describe("canAccessRoute - new suite structure", () => {
  // Intelligence suite access
  it("allows OPERATIONS_MANAGER to access Intelligence dashboards", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/at-risk")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/capacity")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/suites/intelligence")).toBe(true);
  });

  it("allows PROJECT_MANAGER to access Intelligence dashboards", () => {
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/pipeline")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/project-management")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/suites/intelligence")).toBe(true);
  });

  it("blocks OPERATIONS from Intelligence dashboards", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/at-risk")).toBe(false);
    expect(canAccessRoute("OPERATIONS", "/suites/intelligence")).toBe(false);
  });

  it("blocks SALES from suite browsing", () => {
    expect(canAccessRoute("SALES", "/suites/operations")).toBe(false);
    expect(canAccessRoute("SALES", "/suites/intelligence")).toBe(false);
  });

  // Home access for role-based landing
  it("allows all non-VIEWER roles to access home", () => {
    expect(canAccessRoute("OPERATIONS", "/")).toBe(true);
    expect(canAccessRoute("TECH_OPS", "/")).toBe(true);
    expect(canAccessRoute("SALES", "/")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/")).toBe(true);
  });

  it("blocks VIEWER from home", () => {
    expect(canAccessRoute("VIEWER", "/")).toBe(false);
  });

  // BOM History access
  it("allows OPERATIONS to access BOM and BOM History", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/bom")).toBe(true);
    expect(canAccessRoute("OPERATIONS", "/dashboards/bom/history")).toBe(true);
  });

  // Admin-only dashboards
  it("blocks non-admin from Zuper Compliance", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/zuper-compliance")).toBe(false);
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/mobile")).toBe(false);
  });

  it("allows ADMIN to access admin-only dashboards", () => {
    expect(canAccessRoute("ADMIN", "/dashboards/zuper-compliance")).toBe(true);
    expect(canAccessRoute("ADMIN", "/dashboards/mobile")).toBe(true);
  });

  // Legacy role normalization still works
  it("normalizes MANAGER to PROJECT_MANAGER access", () => {
    expect(canAccessRoute("MANAGER", "/")).toBe(true);
    expect(canAccessRoute("MANAGER", "/suites/intelligence")).toBe(true);
  });

  it("normalizes DESIGNER to TECH_OPS access", () => {
    expect(canAccessRoute("DESIGNER", "/")).toBe(true);
    expect(canAccessRoute("DESIGNER", "/suites/department")).toBe(true);
  });

  // SALES gets sales pipeline
  it("allows SALES to access Sales Pipeline and Site Survey Scheduler", () => {
    expect(canAccessRoute("SALES", "/dashboards/sales")).toBe(true);
    expect(canAccessRoute("SALES", "/dashboards/site-survey-scheduler")).toBe(true);
  });

  // D&R routes
  it("allows OPERATIONS to access D&R pipeline", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/dnr")).toBe(true);
  });
});
