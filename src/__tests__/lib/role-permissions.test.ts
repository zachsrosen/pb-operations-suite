import { canAccessRoute } from "@/lib/role-permissions";

describe("canAccessRoute - new suite structure", () => {
  // Intelligence suite access
  it("allows OPERATIONS_MANAGER to access Intelligence dashboards", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/at-risk")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/capacity")).toBe(false);
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

  it("allows VIEWER to access home", () => {
    expect(canAccessRoute("VIEWER", "/")).toBe(true);
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
    expect(canAccessRoute("DESIGNER", "/suites/operations")).toBe(true);
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

  // Forecasting API for scheduler ghost events
  it("allows scheduler-accessible roles to access /api/forecasting", () => {
    expect(canAccessRoute("OPERATIONS", "/api/forecasting")).toBe(true);
    expect(canAccessRoute("OPERATIONS", "/api/forecasting/timeline")).toBe(true);
    expect(canAccessRoute("TECH_OPS", "/api/forecasting")).toBe(true);
    expect(canAccessRoute("TECH_OPS", "/api/forecasting/timeline")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/api/forecasting")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/api/forecasting")).toBe(true);
    expect(canAccessRoute("MANAGER", "/api/forecasting")).toBe(true);
  });

  // Preconstruction metrics access
  it("allows OPERATIONS_MANAGER to access preconstruction metrics", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/preconstruction-metrics")).toBe(true);
  });

  it("allows PROJECT_MANAGER to access preconstruction metrics", () => {
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/preconstruction-metrics")).toBe(true);
  });

  it("blocks OPERATIONS from preconstruction metrics", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/preconstruction-metrics")).toBe(false);
  });

  it("blocks SALES from preconstruction metrics", () => {
    expect(canAccessRoute("SALES", "/dashboards/preconstruction-metrics")).toBe(false);
  });

  // Construction suite card routes (hotfix 2026-03-24)
  describe("construction suite cards visible to ops roles", () => {
    const routes = [
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/construction-scheduler",
      "/api/hubspot/qc-metrics",
    ];
    for (const route of routes) {
      it(`OPERATIONS can access ${route}`, () => {
        expect(canAccessRoute("OPERATIONS", route)).toBe(true);
      });
      it(`OPERATIONS_MANAGER can access ${route}`, () => {
        expect(canAccessRoute("OPERATIONS_MANAGER", route)).toBe(true);
      });
    }
  });

  // Site survey execution route (hotfix 2026-03-24)
  describe("site-survey execution visible to ops roles", () => {
    it("OPERATIONS can access /dashboards/site-survey", () => {
      expect(canAccessRoute("OPERATIONS", "/dashboards/site-survey")).toBe(true);
    });
    it("OPERATIONS_MANAGER can access /dashboards/site-survey", () => {
      expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/site-survey")).toBe(true);
    });
  });

  // Product comparison is admin-only (ADMIN_ONLY_ROUTES overrides allowedRoutes)
  describe("admin-only routes blocked for ops roles", () => {
    it("OPERATIONS cannot access /dashboards/product-comparison (admin-only)", () => {
      expect(canAccessRoute("OPERATIONS", "/dashboards/product-comparison")).toBe(false);
    });
    it("OPERATIONS_MANAGER cannot access /dashboards/product-comparison (admin-only)", () => {
      expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/product-comparison")).toBe(false);
    });
    it("ADMIN can access /dashboards/product-comparison", () => {
      expect(canAccessRoute("ADMIN", "/dashboards/product-comparison")).toBe(true);
    });
  });

  // QC metrics API accessible to all roles with construction-metrics dashboard
  describe("qc-metrics API matches construction-metrics dashboard access", () => {
    const rolesWithDashboard = [
      "PROJECT_MANAGER",
      "TECH_OPS",
      "MANAGER",
    ] as const;
    for (const role of rolesWithDashboard) {
      it(`${role} can access /api/hubspot/qc-metrics`, () => {
        expect(canAccessRoute(role, "/api/hubspot/qc-metrics")).toBe(true);
      });
    }

    it("SALES cannot access /api/hubspot/qc-metrics", () => {
      expect(canAccessRoute("SALES", "/api/hubspot/qc-metrics")).toBe(false);
    });
    it("VIEWER cannot access /api/hubspot/qc-metrics", () => {
      expect(canAccessRoute("VIEWER", "/api/hubspot/qc-metrics")).toBe(false);
    });
  });
});
