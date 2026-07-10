/**
 * Role allowlist reachability for the production-check feature.
 * Prefix matching: pathname === allowed || pathname.startsWith(allowed + "/").
 */

import { ROLES } from "@/lib/roles";

const API_PATH = "/api/service/production-check";
const PAGE_PATH = "/dashboards/production-issues";

function canReach(allowedRoutes: string[], pathname: string): boolean {
  if (allowedRoutes.includes("*")) return true;
  return allowedRoutes.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

describe("production-check route reachability", () => {
  it("SERVICE can reach the production-issues dashboard (hosts the panel)", () => {
    expect(canReach(ROLES.SERVICE.allowedRoutes, PAGE_PATH)).toBe(true);
  });

  it("every role that sees the production-issues page can call the production-check API", () => {
    const holes: string[] = [];
    for (const [name, def] of Object.entries(ROLES)) {
      if (!canReach(def.allowedRoutes, PAGE_PATH)) continue;
      if (!canReach(def.allowedRoutes, API_PATH)) holes.push(name);
    }
    expect(holes).toEqual([]);
  });

  it("flow roles (SERVICE, DESIGN, TECH_OPS, PM, OPS_MGR) can reach both the page and the API", () => {
    for (const role of [
      "SERVICE",
      "DESIGN",
      "TECH_OPS",
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
    ] as const) {
      expect({ role, api: canReach(ROLES[role].allowedRoutes, API_PATH) }).toEqual({ role, api: true });
      expect({ role, page: canReach(ROLES[role].allowedRoutes, PAGE_PATH) }).toEqual({ role, page: true });
    }
  });
});
