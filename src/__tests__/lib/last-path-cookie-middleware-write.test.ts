import { NextResponse } from "next/server";
import {
  writeLastPathCookie,
  LAST_PATH_COOKIE_NAME,
} from "@/lib/last-path-cookie";

function cookieFromResponse(response: NextResponse, name: string) {
  return response.cookies.get(name);
}

describe("writeLastPathCookie", () => {
  it("writes the cookie for a /dashboards/* path", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/dashboards/service-tickets", false);
    const cookie = cookieFromResponse(response, LAST_PATH_COOKIE_NAME);
    expect(cookie?.value).toBe("/dashboards/service-tickets");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.secure).toBe(false);
  });

  it("writes the cookie for a /suites/* path", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/suites/operations", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)?.value).toBe(
      "/suites/operations"
    );
  });

  it("writes the cookie for a /sop/* path", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/sop/ops", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)?.value).toBe(
      "/sop/ops"
    );
  });

  it("does NOT write the cookie for /api/*", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/api/deals", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)).toBeUndefined();
  });

  it("does NOT write the cookie for /admin/*", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/admin/users", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)).toBeUndefined();
  });

  it("does NOT write the cookie for /login", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/login", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)).toBeUndefined();
  });

  it("does NOT write the cookie for /", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/", false);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)).toBeUndefined();
  });

  it("uses secure=true when isProduction=true", () => {
    const response = NextResponse.next();
    writeLastPathCookie(response, "/dashboards/foo", true);
    expect(cookieFromResponse(response, LAST_PATH_COOKIE_NAME)?.secure).toBe(
      true
    );
  });
});
