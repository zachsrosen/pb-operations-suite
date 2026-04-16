# Last-Page Redirect After Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember the user's last visited dashboard/suite/sop page in a persistent cookie and redirect them there after sign-in, falling back to role default if the path is no longer accessible.

**Architecture:** A single new library module (`src/lib/last-path-cookie.ts`) owns the cookie name, TTL, path validation, and read/write helpers. `src/middleware.ts` calls the helpers in three places: (a) write on the final authenticated fall-through, (b) read when a logged-in user hits `/login`, (c) read when an unauthenticated user hits `/login` with no `callbackUrl`. No login page changes.

**Tech Stack:** Next.js 16 middleware (edge runtime), NextAuth v5 beta, TypeScript, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-04-16-last-page-redirect-after-login-design.md`

---

## Chunk 1: Cookie helper module

### Task 1: Cookie helper module with validation

**Files:**
- Create: `src/lib/last-path-cookie.ts`
- Create: `src/__tests__/lib/last-path-cookie.test.ts`

The helper has one job: own the cookie name, attributes, rememberable-path matcher, and validation. Middleware composes it; everything else imports from it.

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/lib/last-path-cookie.test.ts
import {
  LAST_PATH_COOKIE_NAME,
  getCookieOptions,
  isRememberablePath,
  isValidStoredPath,
} from "@/lib/last-path-cookie";

describe("last-path-cookie", () => {
  describe("LAST_PATH_COOKIE_NAME", () => {
    it("is pb_last_path", () => {
      expect(LAST_PATH_COOKIE_NAME).toBe("pb_last_path");
    });
  });

  describe("getCookieOptions", () => {
    it("returns httpOnly, lax, rooted at /, 30-day maxAge", () => {
      const opts = getCookieOptions(false);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
    });

    it("sets secure=true in production", () => {
      expect(getCookieOptions(true).secure).toBe(true);
    });

    it("sets secure=false outside production", () => {
      expect(getCookieOptions(false).secure).toBe(false);
    });
  });

  describe("isRememberablePath", () => {
    it.each([
      ["/dashboards/service-tickets", true],
      ["/dashboards/executive", true],
      ["/suites/operations", true],
      ["/sop/ops", true],
      ["/sop", false], // root redirects
      ["/login", false],
      ["/maintenance", false],
      ["/admin/users", false],
      ["/api/deals", false],
      ["/portal/survey/abc", false],
      ["/", false],
      ["", false],
    ])("%s -> %s", (path, expected) => {
      expect(isRememberablePath(path)).toBe(expected);
    });
  });

  describe("isValidStoredPath", () => {
    it("accepts a valid rememberable path", () => {
      expect(isValidStoredPath("/dashboards/service-tickets")).toBe(true);
    });

    it("rejects undefined / empty", () => {
      expect(isValidStoredPath(undefined)).toBe(false);
      expect(isValidStoredPath("")).toBe(false);
    });

    it("rejects paths not starting with /", () => {
      expect(isValidStoredPath("dashboards/foo")).toBe(false);
      expect(isValidStoredPath("https://evil.com/dashboards")).toBe(false);
    });

    it("rejects protocol-relative paths", () => {
      expect(isValidStoredPath("//evil.com/dashboards")).toBe(false);
    });

    it("rejects paths with backslash", () => {
      expect(isValidStoredPath("/dashboards\\foo")).toBe(false);
    });

    it("rejects paths with newline or null byte", () => {
      expect(isValidStoredPath("/dashboards/foo\n")).toBe(false);
      expect(isValidStoredPath("/dashboards/foo\0")).toBe(false);
    });

    it("rejects paths longer than 512 chars", () => {
      const longPath = "/dashboards/" + "x".repeat(600);
      expect(isValidStoredPath(longPath)).toBe(false);
    });

    it("rejects non-rememberable paths even if otherwise valid", () => {
      expect(isValidStoredPath("/admin/users")).toBe(false);
      expect(isValidStoredPath("/api/deals")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/lib/last-path-cookie.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/last-path-cookie.ts
/**
 * Cookie name, policy, and path validation for the "last visited page"
 * redirect feature. See docs/superpowers/specs/2026-04-16-last-page-redirect-after-login-design.md
 */

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/lib/last-path-cookie.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/last-path-cookie.ts src/__tests__/lib/last-path-cookie.test.ts
git commit -m "feat(auth): add last-path cookie helper with validation"
```

---

## Chunk 2: Middleware write path

### Task 2: Write the cookie on authenticated dashboard/suite/sop page views

**Files:**
- Modify: `src/middleware.ts` (final return around line 289)
- Create: `src/__tests__/lib/last-path-cookie-middleware-write.test.ts`

We add the write at the single final fall-through return — after auth, maintenance, role-fail redirects, `ALWAYS_ALLOWED`, `canAccessRoute`, etc. all pass. We do **not** modify `nextWithRequestId`; the write happens inline.

Middleware uses NextAuth's `auth` wrapper and is hard to unit-test end-to-end. Instead, the test targets a small exported helper — `writeLastPathCookie(response, pathname, isProduction)` — that we add to `last-path-cookie.ts` and call from middleware. This keeps middleware focused on orchestration and gives us deterministic coverage.

- [ ] **Step 1: Write failing test for the write helper**

```typescript
// src/__tests__/lib/last-path-cookie-middleware-write.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/lib/last-path-cookie-middleware-write.test.ts`
Expected: FAIL — `writeLastPathCookie` is not exported.

- [ ] **Step 3: Add `writeLastPathCookie` to the helper module**

Append to `src/lib/last-path-cookie.ts`:

```typescript
import type { NextResponse } from "next/server";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/lib/last-path-cookie-middleware-write.test.ts`
Expected: PASS — all 8 cases green.

- [ ] **Step 5: Wire into middleware at the final return**

Modify `src/middleware.ts`. Add the import near the existing `role-permissions` import:

```typescript
import {
  LAST_PATH_COOKIE_NAME,
  writeLastPathCookie,
} from "@/lib/last-path-cookie";
```

Replace the final `return nextWithRequestId(requestId, req);` (around line 289) with:

```typescript
  const response = nextWithRequestId(requestId, req);
  writeLastPathCookie(
    response,
    pathname,
    process.env.NODE_ENV === "production"
  );
  return response;
```

Leave every other `nextWithRequestId` call site unchanged — the cookie is only written at this one final branch where we know auth + maintenance + role checks all passed.

- [ ] **Step 6: Verify middleware still compiles and existing tests pass**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all existing tests still pass (new tests also green).

- [ ] **Step 7: Commit**

```bash
git add src/lib/last-path-cookie.ts src/__tests__/lib/last-path-cookie-middleware-write.test.ts src/middleware.ts
git commit -m "feat(auth): write last-path cookie on authenticated page views"
```

---

## Chunk 3: Middleware read path — logged-in on /login

### Task 3: Redirect logged-in users on `/login` to their cookie path

**Files:**
- Modify: `src/middleware.ts` (logged-in-on-login block, lines 243-259)
- Create: `src/__tests__/lib/last-path-cookie-resolve.test.ts`

This covers the "user signs out explicitly, signs back in" case. After NextAuth completes sign-in it lands the user on `/login`; middleware sees they're logged in and redirects.

Today's order: explicit `?callbackUrl=` → `getDefaultRouteForRole(userRole)`.
New order: explicit `?callbackUrl=` → cookie path (if valid + role can access) → role default.

We add a second small helper, `resolveRedirectFromCookie(cookieValue, userRole, canAccessRoute)`, that encapsulates validation + role check. It returns either the path to redirect to or `null`. Testing it in isolation is much easier than simulating middleware.

- [ ] **Step 1: Write failing test for the resolver**

```typescript
// src/__tests__/lib/last-path-cookie-resolve.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/lib/last-path-cookie-resolve.test.ts`
Expected: FAIL — `resolveRedirectFromCookie` is not exported.

- [ ] **Step 3: Add the resolver to the helper module**

Append to `src/lib/last-path-cookie.ts`:

```typescript
import type { UserRole } from "@/lib/role-permissions";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/lib/last-path-cookie-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the logged-in-on-login block in middleware**

Modify `src/middleware.ts`. Extend the import added in Task 2:

```typescript
import {
  LAST_PATH_COOKIE_NAME,
  resolveRedirectFromCookie,
  writeLastPathCookie,
} from "@/lib/last-path-cookie";
```

Find the block starting at `// Redirect logged-in users away from login page` (around line 243). Replace the entire block — from that comment through the closing `return addSecurityHeaders(...)` of the role-default branch — with:

```typescript
  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
    // 1. Honor explicit callbackUrl if present and same-origin
    const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
    if (callbackUrl) {
      try {
        const target = new URL(callbackUrl, req.url);
        const baseOrigin = new URL(req.url).origin;
        if (target.origin === baseOrigin) {
          return addSecurityHeaders(requestId, NextResponse.redirect(target));
        }
      } catch {
        // Invalid URL — fall through to cookie/default
      }
    }

    // 2. Try the last-path cookie
    const lastPath = req.cookies.get(LAST_PATH_COOKIE_NAME)?.value;
    const resolved = resolveRedirectFromCookie(lastPath, userRole, canAccessRoute);
    if (resolved) {
      return addSecurityHeaders(
        requestId,
        NextResponse.redirect(new URL(resolved, req.url))
      );
    }

    // 3. Fall back to role default
    const defaultRoute = getDefaultRouteForRole(userRole);
    return addSecurityHeaders(
      requestId,
      NextResponse.redirect(new URL(defaultRoute, req.url))
    );
  }
```

- [ ] **Step 6: Type-check and run tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/last-path-cookie.ts src/__tests__/lib/last-path-cookie-resolve.test.ts src/middleware.ts
git commit -m "feat(auth): use last-path cookie when logged-in user hits /login"
```

---

## Chunk 4: Middleware read path — unauthenticated on /login

### Task 4: Rewrite unauthenticated `/login` to include `callbackUrl` from cookie

**Files:**
- Modify: `src/middleware.ts`
- (Extend existing) `src/__tests__/lib/last-path-cookie-resolve.test.ts`

This handles the "user closed tab after a session timeout, came back later to bare `/login`" case. When an unauthenticated user hits `/login` with no `callbackUrl` query param, but a valid `pb_last_path` cookie is present, we 307-redirect to `/login?callbackUrl=<cookie>`. NextAuth's sign-in flow then honors the callbackUrl as it already does today.

**Loop prevention:** the rewrite requires `!searchParams.has("callbackUrl")`, so after the redirect the next request has `callbackUrl=...` and this branch is skipped.

Note: at this point in middleware we do NOT know the role (user is unauthenticated). We still run path validation via `isValidStoredPath`. The role check happens after sign-in when the user hits `/login?callbackUrl=...` while logged in — Task 3's block validates before redirecting. If the cookie path is stale for the user's role, they fall through to role default there.

- [ ] **Step 1: Write failing tests for the unauthenticated rewrite resolver**

We already have `resolveRedirectFromCookie`, but it requires a role. For the unauthenticated case we need the weaker path-only form. Add test cases to the existing resolve test file:

```typescript
// Append to src/__tests__/lib/last-path-cookie-resolve.test.ts
import { resolveCallbackPathFromCookie } from "@/lib/last-path-cookie";

describe("resolveCallbackPathFromCookie", () => {
  it("returns null for missing/empty cookie", () => {
    expect(resolveCallbackPathFromCookie(undefined)).toBeNull();
    expect(resolveCallbackPathFromCookie("")).toBeNull();
  });

  it("returns null for invalid path", () => {
    expect(resolveCallbackPathFromCookie("//evil.com/dashboards")).toBeNull();
    expect(resolveCallbackPathFromCookie("/admin/users")).toBeNull();
    expect(resolveCallbackPathFromCookie("/dashboards/foo\n")).toBeNull();
  });

  it("returns the path when valid", () => {
    expect(
      resolveCallbackPathFromCookie("/dashboards/service-tickets")
    ).toBe("/dashboards/service-tickets");
    expect(resolveCallbackPathFromCookie("/suites/operations")).toBe(
      "/suites/operations"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/lib/last-path-cookie-resolve.test.ts`
Expected: FAIL — `resolveCallbackPathFromCookie` not exported.

- [ ] **Step 3: Add `resolveCallbackPathFromCookie`**

Append to `src/lib/last-path-cookie.ts`:

```typescript
/**
 * Resolve the last-path cookie for use as a pre-signin `callbackUrl`. No
 * role check (we don't know the role yet). The post-signin flow validates
 * role access via `resolveRedirectFromCookie`.
 */
export function resolveCallbackPathFromCookie(
  cookieValue: string | undefined | null
): string | null {
  if (!isValidStoredPath(cookieValue)) return null;
  return cookieValue as string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/lib/last-path-cookie-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the rewrite to middleware**

Modify `src/middleware.ts`. Extend the import list:

```typescript
import {
  LAST_PATH_COOKIE_NAME,
  resolveCallbackPathFromCookie,
  resolveRedirectFromCookie,
  writeLastPathCookie,
} from "@/lib/last-path-cookie";
```

Insert a new branch right **before** the `ALWAYS_ALLOWED` fall-through block (around line 263, `if (!isLoginPage && ALWAYS_ALLOWED.some(...))`). The new branch:

```typescript
  // Unauthenticated user hit bare /login — if a last-path cookie exists
  // and no callbackUrl is already set, rewrite so NextAuth restores it
  // after sign-in. `!searchParams.has("callbackUrl")` prevents loops.
  if (isLoginPage && !isLoggedIn && !req.nextUrl.searchParams.has("callbackUrl")) {
    const lastPath = req.cookies.get(LAST_PATH_COOKIE_NAME)?.value;
    const callbackPath = resolveCallbackPathFromCookie(lastPath);
    if (callbackPath) {
      const redirectUrl = new URL("/login", req.url);
      redirectUrl.searchParams.set("callbackUrl", callbackPath);
      return addSecurityHeaders(requestId, NextResponse.redirect(redirectUrl));
    }
  }
```

- [ ] **Step 6: Type-check and run tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/last-path-cookie.ts src/__tests__/lib/last-path-cookie-resolve.test.ts src/middleware.ts
git commit -m "feat(auth): restore last-path on fresh /login when cookie present"
```

---

## Chunk 5: Manual verification & final commit

### Task 5: Manual test matrix

**Files:** none (manual testing)

Run `npm run dev` and walk through the following scenarios against localhost. Use Chrome devtools → Application → Cookies to inspect `pb_last_path`.

- [ ] **Case A: Explicit sign-out, sign back in**
  1. Sign in, navigate to `/dashboards/service-tickets`.
  2. Verify cookie `pb_last_path=/dashboards/service-tickets`, httpOnly.
  3. Click user menu → Sign out.
  4. Sign back in with Google.
  5. **Expected:** land on `/dashboards/service-tickets`, not the role default.

- [ ] **Case B: Session timeout, come back fresh**
  1. Sign in, navigate to `/dashboards/executive`.
  2. Open devtools → Application → Cookies; delete the session cookie (`next-auth.session-token` or similar).
  3. Navigate to `/login` directly.
  4. **Expected:** URL gets rewritten to `/login?callbackUrl=%2Fdashboards%2Fexecutive`.
  5. Sign in.
  6. **Expected:** land on `/dashboards/executive`.

- [ ] **Case C: Explicit `?callbackUrl=` wins over cookie**
  1. With cookie set to `/dashboards/service-tickets`, sign in via `/login?callbackUrl=/dashboards/pipeline`.
  2. **Expected:** land on `/dashboards/pipeline`.

- [ ] **Case D: Cookie path role fails → role default**
  1. Using dev sign-in or admin, set cookie to `/dashboards/executive`.
  2. Sign out, sign in as SALES.
  3. **Expected:** land on SALES default (`/dashboards/scheduler` or similar), not `/dashboards/executive`.

- [ ] **Case E: Non-rememberable path does not write cookie**
  1. Navigate to `/admin/users`.
  2. **Expected:** cookie value unchanged from prior dashboard visit (stays on the last dashboard path).

- [ ] **Case F: No cookie → role default**
  1. Clear all cookies. Sign in fresh.
  2. **Expected:** land on role default.

- [ ] **Step 1: Record any issues found**

If any case fails, file the issue in this plan under a new task and fix before proceeding. If all pass, continue.

- [ ] **Step 2: Commit a small note to the manual test log (optional)**

No code changes; just proceed.

---

### Task 6: Push and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/last-page-redirect
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(auth): redirect to last-visited page after login" --body "$(cat <<'EOF'
## Summary
- Persistent `pb_last_path` cookie written by middleware on `/dashboards/*`, `/suites/*`, `/sop/*` page views (30-day rolling, httpOnly, sameSite=lax).
- Cookie read in two middleware branches: (1) logged-in user lands on `/login` → redirect straight to cookie path, (2) unauthenticated user hits bare `/login` → URL gets rewritten to `/login?callbackUrl=<cookie>` so NextAuth restores it after sign-in.
- Role access is re-checked on read via `canAccessRoute`; stale paths fall through to `getDefaultRouteForRole`.
- Path validation rejects `//`, `\`, newlines, null bytes, non-rememberable patterns, and over-512-char strings.
- Spec: `docs/superpowers/specs/2026-04-16-last-page-redirect-after-login-design.md`

## Test plan
- [x] `npm test` — new unit tests for helper + resolver pass
- [x] Manual: explicit sign-out + sign-in returns user to last dashboard
- [x] Manual: session timeout + fresh `/login` restores last dashboard via callbackUrl
- [x] Manual: explicit `?callbackUrl=` overrides cookie
- [x] Manual: role downgrade falls back to role default instead of exposing the cookie path

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Share PR URL**

Return the PR URL for user review.

---

## Summary of New & Modified Files

**Created:**
- `src/lib/last-path-cookie.ts` — cookie name, options, path validation, write + resolver helpers
- `src/__tests__/lib/last-path-cookie.test.ts` — validation and options tests
- `src/__tests__/lib/last-path-cookie-middleware-write.test.ts` — write helper tests
- `src/__tests__/lib/last-path-cookie-resolve.test.ts` — resolver tests

**Modified:**
- `src/middleware.ts` — new import, unauthenticated `/login` rewrite branch, logged-in-on-login block extended with cookie read, final return site writes cookie

**No changes to:**
- `src/app/login/page.tsx` — intentional, all cookie logic stays in middleware
- `src/components/UserMenu.tsx` — the existing `signOut({ callbackUrl: "/login" })` still works; middleware handles the redirect post-signin
- `src/app/api/auth/logout/route.ts` — orthogonal
- `src/lib/role-permissions.ts` — we import existing functions only
- NextAuth config — no changes needed

## Notes for the implementer

- **Edge runtime constraint.** `src/middleware.ts` runs in the edge runtime. Do not import node-only modules (fs, path, crypto beyond Web Crypto, etc.) into `last-path-cookie.ts`. The file should have zero runtime dependencies beyond `next/server` types and `@/lib/role-permissions` (the latter is already edge-safe — it's imported from middleware today).
- **`process.env.NODE_ENV`** is available in the edge runtime but resolved at build time. The `getCookieOptions(isProduction)` signature forces the caller to pass it explicitly, which makes the helper testable without monkeypatching `process.env`.
- **Keep `nextWithRequestId` alone.** Many branches call it; only the final fall-through should write the cookie. The protected-static-file branch (around line 276) is intentionally excluded — spec lists static files as non-rememberable, and our final-return-only wiring handles this correctly.
- **Cookie read order in the logged-in-on-login block** is: explicit query param → cookie (validated + role-checked) → role default. Do not reorder.
- **Loop prevention** relies entirely on the `!searchParams.has("callbackUrl")` guard on the unauthenticated rewrite. Do not soften this guard.
- **jsdom `NextResponse.cookies` quirk.** The write-helper test runs under `testEnvironment: "jsdom"`. It asserts `response.cookies.get(name)` returns an object with `httpOnly`, `sameSite`, `secure` fields. If your Next.js/jsdom combo returns those as `undefined`, fall back to parsing `response.headers.get("set-cookie")` with a regex for `HttpOnly`, `SameSite=Lax`, `Secure` tokens. Value-only assertions (`cookie.value === "/dashboards/..."`) should always work.
- **Role enum spellings.** `UserRole` is a string union. Confirmed exact member names used in tests: `"ADMIN"`, `"EXECUTIVE"`, `"OPERATIONS"` (NOT `OPERATIONS_MANAGER`), `"OPERATIONS_MANAGER"`, `"SALES"`, `"SALES_MANAGER"`, `"VIEWER"`, `"PROJECT_MANAGER"`, `"TECH_OPS"`. Use exact casing.
- **Manual Case B cookie name.** NextAuth v5 typically stores the session under `authjs.session-token` (dev) or `__Secure-authjs.session-token` (production). The older `next-auth.session-token` may also be present in transitional states. In Chrome devtools → Application → Cookies, delete anything matching `authjs.*` AND `next-auth.*` for the origin. If the session survives, try a fresh incognito window.
