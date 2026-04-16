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

In middleware, after all auth/maintenance/role checks pass and we're about to return `nextWithRequestId()` for a rememberable path. Only for authenticated users — unauthenticated users never reach that branch.

The write uses `response.cookies.set(...)` on the NextResponse returned from `nextWithRequestId`. We extend `nextWithRequestId` to accept an optional cookie write, or do it inline at the call site. Implementation detail for the plan, not the spec.

### When is the cookie read?

Two places, both in middleware:

1. **`/login` when already logged in** (existing redirect at lines 243-259): current order is explicit `?callbackUrl=` → role default. New order: explicit `?callbackUrl=` → `pb_last_path` → role default.
2. **`/login` after fresh sign-in.** NextAuth's signIn callback honors `callbackUrl`. The login page (`src/app/login/page.tsx:15`) currently defaults to `"/"`. We change it to read the cookie via a server component (or pass through the middleware redirect) so the fresh sign-in uses `pb_last_path` too.

Actually the cleaner path: when the user hits `/login` unauthenticated, middleware lets them through. They click "Sign in with Google." NextAuth redirects to `callbackUrl` after sign-in. The login page reads `callbackUrl` from search params, which middleware already set (either from the `/login?callbackUrl=<path>` pattern or from our new `pb_last_path` cookie).

So: in the middleware `if (!isLoginPage && !isLoggedIn)` branch (lines 268-271), we already set `callbackUrl` from the current pathname. We don't touch this — timeout case is already covered.

For the "user closed tab and came back to bare `/login`" case: we add logic to the `/login` page server-side read of the cookie and include it in the signIn `callbackUrl`. Alternative: middleware intercepts `/login` when the user is unauthenticated AND no `callbackUrl` param is set AND the cookie exists — rewrites the URL to include `callbackUrl=<cookie>`. Simpler and keeps everything in middleware.

### Role access check before redirect

Before redirecting a user to `pb_last_path`, call `canAccessRoute(userRole, cookiePath)`. If the role no longer has access to that path (e.g., user was demoted, or cookie path is stale), fall back to role default. This is the same check the middleware already does for general route access.

### Path validation

The cookie value is treated as untrusted input:
- Must start with `/`
- Must not start with `//` (prevents protocol-relative URL escape)
- Must not contain `\`, newline, or null bytes
- Must match one of the rememberable path patterns (re-validated on read — paranoia against future pattern changes)
- If validation fails, ignore the cookie and use role default

## Edge Cases

### Admin impersonation

Admins who impersonate another user get a `pb_effective_role` cookie. The middleware already uses the effective role for `canAccessRoute`. The last-path cookie should still be written (so when the admin stops impersonating and signs back in later, they return to where they were as themselves). The role check on read uses the *current* role at read time — if the admin is no longer impersonating, the effective role is ADMIN, and the check still passes for any dashboard.

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
  - Cookie is read on `/login` with no `callbackUrl` when user is unauthenticated
  - Explicit `?callbackUrl=` takes precedence over cookie
  - Cookie path that fails `canAccessRoute` is ignored
  - Cookie value with `\\`, `//`, or non-dashboard path is rejected
- Manual test:
  - Sign in → navigate to `/dashboards/service-tickets` → sign out → sign in → land on `/dashboards/service-tickets`
  - Sign in → navigate to `/dashboards/service-tickets` → close tab for 5+ minutes until session times out → open `/login` → sign in → land on `/dashboards/service-tickets`
  - Set cookie to `/dashboards/executive` → sign in as SALES → land on SALES default (not `/dashboards/executive`)

## Rollout

Single PR. No feature flag needed — the fallback chain (callbackUrl → cookie → role default) is strictly additive. If the cookie logic misbehaves, users still get the role default they get today.

## Non-Goals

- Remembering query strings or hash fragments (keep it simple; pathname only)
- Remembering scroll position
- Remembering across devices (cookie is per-browser)
- Multi-tab "most recent active" logic
- Remembering `/admin/*` paths (intentional — admin tooling is not "where you work")
