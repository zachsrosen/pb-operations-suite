jest.mock("@/lib/db", () => ({ prisma: null }));
import { ROLES, ADMIN_ONLY_ROUTES } from "@/lib/roles";

test("every role can view the workflow map page + api", () => {
  for (const [, def] of Object.entries(ROLES)) {
    const ok =
      def.allowedRoutes.includes("*") ||
      (def.allowedRoutes.includes("/dashboards/workflow-map") &&
        def.allowedRoutes.includes("/api/workflow-map"));
    expect(ok).toBe(true);
  }
});

test("refresh endpoint is admin-only", () => {
  expect(ADMIN_ONLY_ROUTES).toContain("/api/workflow-map/refresh");
});
