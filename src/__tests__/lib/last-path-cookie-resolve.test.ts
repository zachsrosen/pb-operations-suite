import { resolveRedirectFromCookie } from "@/lib/last-path-cookie";
import type { UserRole } from "@/lib/role-permissions";

function fakeCanAccess(allowed: Set<string>) {
  return (_role: UserRole, path: string) => allowed.has(path);
}

describe("resolveRedirectFromCookie", () => {
  it("returns null when cookie is missing", () => {
    expect(
      resolveRedirectFromCookie(undefined, "ADMIN", fakeCanAccess(new Set()))
    ).toBeNull();
    expect(
      resolveRedirectFromCookie("", "ADMIN", fakeCanAccess(new Set()))
    ).toBeNull();
  });

  it("returns null when cookie fails path validation", () => {
    expect(
      resolveRedirectFromCookie(
        "//evil.com/dashboards",
        "ADMIN",
        fakeCanAccess(new Set(["//evil.com/dashboards"]))
      )
    ).toBeNull();
    expect(
      resolveRedirectFromCookie(
        "/admin/users",
        "ADMIN",
        fakeCanAccess(new Set(["/admin/users"]))
      )
    ).toBeNull();
  });

  it("returns null when role cannot access the path", () => {
    expect(
      resolveRedirectFromCookie(
        "/dashboards/executive",
        "SALES",
        fakeCanAccess(new Set())
      )
    ).toBeNull();
  });

  it("returns the path when valid and role has access", () => {
    expect(
      resolveRedirectFromCookie(
        "/dashboards/service-tickets",
        "OPERATIONS",
        fakeCanAccess(new Set(["/dashboards/service-tickets"]))
      )
    ).toBe("/dashboards/service-tickets");
  });
});
