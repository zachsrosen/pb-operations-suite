/**
 * Cookie name, policy, and path validation for the "last visited page"
 * redirect feature. See docs/superpowers/specs/2026-04-16-last-page-redirect-after-login-design.md
 */
import type { NextResponse } from "next/server";
import type { UserRole } from "@/lib/role-permissions";

export const LAST_PATH_COOKIE_NAME = "pb_last_path";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const MAX_PATH_LENGTH = 512;

/** Path prefixes whose pageviews the cookie should remember. */
const REMEMBERABLE_PREFIXES = ["/dashboards/", "/suites/", "/sop/"] as const;

export interface LastPathCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export function getCookieOptions(isProduction: boolean): LastPathCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  };
}

/**
 * True if the pathname should cause us to write the cookie.
 * Intentionally excludes /sop root (which redirects) and any API/admin/login paths.
 */
export function isRememberablePath(pathname: string): boolean {
  if (!pathname) return false;
  return REMEMBERABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * True if the stored cookie value is safe to use as a redirect target.
 * Rejects non-absolute paths, protocol-relative URLs, control characters,
 * over-long strings, and anything that is not a rememberable path.
 */
export function isValidStoredPath(value: string | undefined | null): boolean {
  if (!value) return false;
  if (value.length > MAX_PATH_LENGTH) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("\n") || value.includes("\r")) return false;
  if (value.includes("\0")) return false;
  return isRememberablePath(value);
}

/**
 * Write the last-path cookie onto the given NextResponse if the pathname
 * is rememberable. No-op otherwise. Safe to call on any response.
 *
 * `isProduction` toggles the `secure` cookie attribute. Pass
 * `process.env.NODE_ENV === "production"` from the caller (middleware
 * runs in the edge runtime where process.env lookups are compile-time).
 */
export function writeLastPathCookie(
  response: NextResponse,
  pathname: string,
  isProduction: boolean
): void {
  if (!isRememberablePath(pathname)) return;
  response.cookies.set(
    LAST_PATH_COOKIE_NAME,
    pathname,
    getCookieOptions(isProduction)
  );
}

/**
 * Resolve the last-path cookie into a safe redirect target, or null if it
 * should be ignored. Caller must pass the role-permission check function
 * so this module doesn't pull role-permissions directly (the caller
 * already has it imported).
 */
export function resolveRedirectFromCookie(
  cookieValue: string | undefined | null,
  userRole: UserRole,
  canAccessRoute: (role: UserRole, path: string) => boolean
): string | null {
  if (!isValidStoredPath(cookieValue)) return null;
  if (!canAccessRoute(userRole, cookieValue as string)) return null;
  return cookieValue as string;
}
