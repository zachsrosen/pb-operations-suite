# Last-Page Redirect After Login

**Date:** 2026-04-16
**Status:** Draft

## Problem

Users are reporting that after signing out (explicitly or via session timeout) and signing back in, they land on their role's default route — not the dashboard they were previously working in. For users who rely on deep-linked dashboards (e.g., a PM who lives in `/dashboards/pi-action-queue`, an ops lead in `/dashboards/service-tickets`), finding their way back requires clicking through the suite switcher each time. The suite system has dozens of dashboards across 8 suites, and role defaults only cover the most common starting point per role.

There are two distinct cases:

1. **Explicit sign-out.** `UserMenu.tsx:125` calls `signOut({ callbackUrl: "/login" })` with no record of where the user was. The login page then falls back to role default on sign-in.
2. **Session timeout.** NextAuth invalidates the session mid-navigation. Middleware at `src/middleware.ts:268-271` redirects to `/login?callbackUrl=<current-path>`, which works correctly — *if* the user signs back in during that redirect. If they close the tab and return later to a bare `/` or `/login`, the callbackUrl is gone and they land on role default.

## Solution

A persistent server-side cookie (`pb_last_path`) that remembers the last "rememberable" page the user visited. Written by middleware on every qualifying page view, read during the post-login redirect as a fallback *after* the explicit `?callbackUrl=` param but *before* the role default.

This survives browser close, covers both the explicit logout and timeout cases uniformly, and does not require any NextAuth changes.

## Cookie Policy

### Name and attributes

- **Name:** `pb_last_path`
- **Value:** URL pathname only (no query string, no hash, no origin). Max 512 chars.
- **httpOnly:** true (not readable by client JS)
- **sameSite:** `lax`
- **secure:** true in production, false in dev
- **path:** `/`
- **maxAge:** 30 days, refreshed on every qualifying page view (rolling window)

### Rememberable paths (write the cookie)

A path is rememberable if it matches ANY of:
- `/dashboards/*`
- `/suites/*`
- `/sop/*` (but not `/sop` root — they get redirected anyway)

### Non-rememberable paths (skip writing)

Explicitly do not overwrite the cookie for:
- `/login`, `/maintenance`, `/portal/*`
- `/api/*` (all API routes)
- `/admin/*` (admin tooling — user may be impersonating)
- Static files (already excluded from middleware matcher)
- Any path that ultimately redirects (we write on `next()`, not `redirect()`)

### When is the cookie written?

In middleware, **only at the final `return nextWithRequestId(requestId, req)` call at line 289** — after all auth, maintenance, role, and `canAccessRoute` checks have passed. This is the single fall-through branch for authenticated users on non-API, non-login, non-protected-static paths. Writing only there guarantees we never cache a path the user was blocked from.

Do **not** modify `nextWithRequestId`. `nextWithRequestId` is called from many branches (auth routes, static files, public API, impersonation API, protected static files, API fall-through). Writing the cookie there would pollute cases we explicitly exclude. Instead, at the final return site, capture the response, call `response.cookies.set("pb_last_path", pathname, { ...attrs })` if `pathname` matches the rememberable patterns, then return it.

Unauthenticated users never reach this branch (they're redirected at line 268-271), so no auth check is needed at the write site.

### When is the cookie read?

Two places, both in middleware. The `/login` page itself is **not** modified; all cookie reading happens in middleware. This keeps the auth flow in one place and avoids implementation thrash between middleware and server-component approaches.

**Read 1: `/login` when user is already logged in** (existing redirect at lines 243-259).

Current order: explicit `?callbackUrl=` → role default.
New order: explicit `?callbackUrl=` → `pb_last_path` → role default.

If the cookie is present and the path validates and `canAccessRoute(userRole, cookiePath)` passes, redirect there. Otherwise fall through to role default.

**Read 2: `/login` when user is unauthenticated, no `callbackUrl`, cookie present** (new branch, inserted before line 263).

This is the "user closed tab during a timed-out session and came back fresh" case. The unauthenticated user lands on `/login` with no query params and no session. Today, middleware falls through to `nextWithRequestId` (line 264) and the login page uses its default `"/"`.

New behavior: if `pathname === "/login" && !isLoggedIn && !searchParams.has("callbackUrl") && pb_last_path cookie exists && cookie value validates`, issue a 307 redirect to `/login?callbackUrl=<cookie>`. The login page then respects the `callbackUrl` through NextAuth's signIn as it already does today.

**Loop prevention.** The rewrite condition includes `!searchParams.has("callbackUrl")`, so after the rewrite lands the user back on `/login?callbackUrl=...`, the condition is false and we fall through normally. No loop.

**Why not have the login page read the cookie directly?** The login page runs as a React server component, which *can* read httpOnly cookies, but that would split the redirect logic between two files and create a second code path that needs to stay in sync with middleware's validation and role checks. Keeping it all in middleware is simpler.

### Role access check before redirect

Before redirecting a user to `pb_last_path`, call `canAccessRoute(userRole, cookiePath)`. If the role no longer has access to that path (e.g., user was demoted, or cookie path is stale), fall back to role default. This is the same check the middleware already does for general route access.

`getDefaultRouteForRole(userRole)` is guaranteed to return a path the role can access — that's its contract. So the fallback chain (cookie fails → role default) is terminal and will never itself redirect. No second redirect round-trip.

### Path validation

The cookie value is treated as untrusted input:
- Must start with `/`
- Must not start with `//` (prevents protocol-relative URL escape)
- Must not contain `\`, newline, or null bytes
- Must match one of the rememberable path patterns (re-validated on read — paranoia against future pattern changes)
- If validation fails, ignore the cookie and use role default

## Edge Cases

### Admin impersonation

Admins who impersonate another user get a `pb_effective_role` cookie. The middleware already uses the effective role for `canAccessRoute`. The last-path cookie is written under whichever role is effective at the time of the page view — we don't try to track "real user identity" separately. This means:

- Admin A impersonates user B, navigates to `/dashboards/pi-action-queue`. Cookie written.
- Admin A stops impersonating, signs out, signs back in later. Cookie still says `/dashboards/pi-action-queue`. Admin A's role is ADMIN (access to all routes), so `canAccessRoute` passes and they land there.

This is correct behavior: the cookie is per-browser state, not per-user-identity state. If admin A wanted to return to their own last page, they shouldn't have been impersonating. If they want to jump to an impersonation-era view, that's fine too.

### OWNER / EXECUTIVE roles

`normalizeRole()` in `role-permissions.ts` maps OWNER → EXECUTIVE. Both have `*` route access in `ROLE_ROUTES`. The feature is effectively a no-op for them (role default works fine), but the cookie still writes and reads normally — they just always pass the `canAccessRoute` check.

### User on `/login` when already logged in

Current behavior: middleware redirects to `callbackUrl` or role default. With this feature: middleware redirects to `callbackUrl` → cookie path (if accessible) → role default. Behavior-equivalent for users who just navigated away and came back; strictly better for users with a stale cookie (same as today in the worst case).

### Same-origin enforcement

Already handled at lines 248-250 for `callbackUrl`. The cookie stores pathname only (no origin), so the redirect target is constructed as `new URL(cookiePath, req.url)` which is same-origin by construction.

### Cookie size / quota

30-day rolling + 512-char max + one path per user = well under cookie size limits (4KB). No impact on other cookies.

### SALES users

SALES role has very limited route access (`/scheduler`, `/api/deals/scheduler`, etc.). Their `pb_last_path` will usually be `/dashboards/scheduler`, which is also their role default. The feature is a no-op for them, which is fine.

### VIEWER users

Default role for new sign-ups. Limited access. Same as SALES — feature is a harmless no-op.

### Portal users (token-validated, no session)

Portal routes are in `ALWAYS_ALLOWED` and never hit the authenticated user branch. Cookie is never written for them. Correct.

### Logout from non-rememberable path

If a user explicitly signs out from `/admin/users`, the cookie still holds their last dashboard view (e.g., `/dashboards/pi-action-queue` from an hour ago). On sign-in, they go there. That's what we want — admin pages are tooling, not "where you work."

## Testing

- Middleware unit tests for:
  - Cookie is written on `/dashboards/foo` for authenticated user
  - Cookie is NOT written on `/api/*`, `/admin/*`, `/login`, `/maintenance`
  - Cookie is NOT written when redirecting (auth fail, maintenance mode, role fail)
  - Cookie is read on `/login` with no `callbackUrl` when user is unauthenticated (redirect to `/login?callbackUrl=<cookie>`)
  - Cookie is read on `/login` when user is already logged in (redirect straight to cookie path)
  - Explicit `?callbackUrl=` takes precedence over cookie
  - Cookie path that fails `canAccessRoute` is ignored at read time (even if cookie was valid when written)
  - Cookie value with `\\`, `//`, protocol-relative, or non-rememberable path is rejected at read time
  - Redirect loop prevention: after `/login?callbackUrl=<cookie>` lands, middleware does NOT re-rewrite
- Manual test:
  - Sign in → navigate to `/dashboards/service-tickets` → sign out → sign in → land on `/dashboards/service-tickets`
  - Sign in → navigate to `/dashboards/service-tickets` → close tab for 5+ minutes until session times out → open `/login` → sign in → land on `/dashboards/service-tickets`
  - Set cookie to `/dashboards/executive` → sign in as SALES → land on SALES default (not `/dashboards/executive`)

## Out-of-Scope Flow

`/api/auth/logout` is a server-side GET route that logs a LOGOUT activity and redirects to `/login`. **`UserMenu.tsx` does not use this route** — it calls NextAuth's client-side `signOut({ callbackUrl: "/login" })` directly. This feature touches the NextAuth flow (middleware-level), not the `/api/auth/logout` route. That route is orthogonal and stays as-is.

## Rollout

Single PR. No feature flag needed — the fallback chain (callbackUrl → cookie → role default) is strictly additive. If the cookie logic misbehaves, users still get the role default they get today.

## Non-Goals

- Remembering query strings or hash fragments (keep it simple; pathname only)
- Remembering scroll position
- Remembering across devices (cookie is per-browser)
- Multi-tab "most recent active" logic
- Remembering `/admin/*` paths (intentional — admin tooling is not "where you work")
