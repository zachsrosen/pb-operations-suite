import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/generated/prisma/enums";
import {
  getDefaultRouteForRole,
  normalizeRole,
  isPathAllowedByAccess,
  resolveUserAccess,
} from "@/lib/user-access";
import {
  LAST_PATH_COOKIE_NAME,
  resolveCallbackPathFromCookie,
  resolveRedirectFromCookie,
  writeLastPathCookie,
} from "@/lib/last-path-cookie";
// Solar CORS no longer needed — Solar Surveyor served from same origin

// Routes that are always accessible (login, auth callbacks)
const ALWAYS_ALLOWED = ["/login", "/api/auth", "/maintenance", "/portal", "/estimator"];
const PUBLIC_API_ROUTES = [
  "/api/deployment",
  "/api/updates/notify",
  "/api/sentry-canary",
  "/api/webhooks/hubspot/design-complete",
  "/api/webhooks/hubspot/ready-to-build",
  "/api/webhooks/hubspot/design-review",
  "/api/webhooks/hubspot/site-survey-readiness",
  "/api/webhooks/hubspot/fdr-check",
  "/api/webhooks/hubspot/install-review",
  "/api/webhooks/hubspot/property",
  "/api/cron/audit-digest",
  "/api/cron/property-reconcile",
  "/api/cron/audit-retention",
  "/api/cron/pipeline-health",
  "/api/cron/daily-focus",
  "/api/cron/eod-summary",
  "/api/cron/deal-sync", // Deal mirror batch sync — CRON_SECRET validated in route
  "/api/webhooks/hubspot/deal-sync", // Deal mirror webhook — HubSpot signature validated in route
  "/api/portal/survey", // Customer portal — token-validated, no session needed
  "/api/solar/cron/cleanup-pending", // Solar cron — CRON_SECRET validated in route
  "/api/on-call/calendar", // On-call iCal feed — pool icalToken validated in route
  "/api/estimator", // Public customer-facing estimator v2
  "/api/cron/estimator-cleanup", // Estimator TTL cleanup — CRON_SECRET validated in route
  "/api/cron/estimator-hubspot-reconcile", // Estimator HubSpot retry — CRON_SECRET validated in route
  "/api/cron/adders-sync", // Adder catalog → OpenSolar sync — CRON_SECRET validated in route
  "/api/inngest", // Inngest Cloud → app handshake; signing-key validated by the serve handler
  "/api/webhooks/zuper/admin-workflows", // Zuper webhook → admin workflow fan-out; bearer-validated in route
  "/api/cron/admin-workflow-cleanup", // Mark stale admin-workflow runs as FAILED — CRON_SECRET validated in route
  "/api/cron/admin-workflow-cron-dispatch", // Fire CRON-triggered admin workflows — CRON_SECRET validated in route
  "/api/cron/compliance-shadow-cleanup", // Compliance v2 shadow table TTL cleanup — CRON_SECRET validated in route
  "/api/cron/permit-hub-drafts-cleanup", // Permit Hub draft TTL cleanup — CRON_SECRET validated in route
  "/api/cron/permit-hub-inbox-probe", // On-demand shared-inbox diagnostic — CRON_SECRET validated in route
  "/api/admin/shared-inbox/callback", // Google OAuth callback — state-HMAC validated in route (not session-authed)
];
const MACHINE_TOKEN_ALLOWED_ROUTES = ["/api/bom", "/api/products/seed", "/api/install-review", "/api/zuper/sync-cache"] as const;

function isMachineTokenAllowedRoute(pathname: string): boolean {
  return MACHINE_TOKEN_ALLOWED_ROUTES.some((allowed) =>
    pathname === allowed || pathname.startsWith(`${allowed}/`)
  );
}

// Generate a short request ID for correlation across logs
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// Security headers for all responses
function addSecurityHeaders(requestId: string, response: NextResponse): NextResponse {
  // Request correlation ID for tracing
  response.headers.set("X-Request-Id", requestId);

  // Prevent clickjacking — SAMEORIGIN allows PB Ops pages to frame PB Ops content
  // (e.g., /dashboards/solar-surveyor iframe may redirect through PB Ops login)
  response.headers.set("X-Frame-Options", "SAMEORIGIN");

  // Prevent MIME type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // XSS protection (legacy, but still useful)
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer policy - don't leak sensitive URL info
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy - disable sensitive features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );

  // Content Security Policy - allow same origin, inline styles/scripts for Next.js
  // Note: unsafe-inline required for Next.js inline scripts; unsafe-eval removed for security
  // Google Maps JS API requires maps.googleapis.com (scripts) + maps.gstatic.com (resources)
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://maps.googleapis.com https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https:; worker-src 'self' blob:; frame-src 'self' https://www.google.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self';"
  );

  // Strict Transport Security (HTTPS only in production)
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  return response;
}

/**
 * Create a NextResponse.next() that forwards the request ID in request headers.
 * Route handlers can then read x-request-id for Sentry correlation.
 */

function nextWithRequestId(
  requestId: string,
  request: NextRequest,
  forwardedHeaders?: Record<string, string>
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  if (forwardedHeaders) {
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      requestHeaders.set(key, value);
    }
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  addSecurityHeaders(requestId, response);
  return response;
}

export default auth((req) => {
  const requestId = generateRequestId();
  const pathname = req.nextUrl.pathname;

  const isLoggedIn = !!req.auth;
  const tokenUser = req.auth?.user as
    | {
        roles?: UserRole[];
        extraAllowedRoutes?: string[];
        extraDeniedRoutes?: string[];
      }
    | undefined;
  const tokenRoles = tokenUser?.roles;
  // Option D extras are per-user; impersonation does NOT carry them (if an
  // admin impersonates, they see the target role's access minus the target
  // user's extras, which is safer — impersonation is a read-only lens).
  const tokenExtraAllowed = tokenUser?.extraAllowedRoutes ?? [];
  const tokenExtraDenied = tokenUser?.extraDeniedRoutes ?? [];
  // Impersonation: admin sets pb_effective_roles (JSON array) via /api/admin/impersonate.
  // Only respected when the JWT confirms the user is ADMIN.
  const cookieRolesRaw = req.cookies.get("pb_effective_roles")?.value;
  let cookieRoles: UserRole[] | undefined;
  if (cookieRolesRaw) {
    try {
      const parsed = JSON.parse(cookieRolesRaw);
      if (Array.isArray(parsed) && parsed.every((r) => typeof r === "string")) {
        cookieRoles = parsed as UserRole[];
      }
    } catch {
      // Malformed cookie — ignore.
    }
  }
  const isImpersonatingCookie = req.cookies.get("pb_is_impersonating")?.value === "1";
  // Cookie override is only respected when the JWT confirms ADMIN and the cookie
  // roles don't attempt to elevate to ADMIN/EXECUTIVE. VIEWER requires the
  // impersonation flag to prevent accidental VIEWER lock-out on stale cookies.
  const isAdminToken = tokenRoles?.includes("ADMIN") ?? false;
  const isSafeCookieRoles = cookieRoles &&
    !cookieRoles.some((r) => r === "ADMIN" || r === "EXECUTIVE");
  const shouldUseCookieRoles =
    isAdminToken &&
    !!isSafeCookieRoles &&
    (!(cookieRoles?.every((r) => r === "VIEWER")) || isImpersonatingCookie);
  const effectiveRoles: UserRole[] =
    shouldUseCookieRoles && cookieRoles && cookieRoles.length > 0
      ? cookieRoles
      : tokenRoles && tokenRoles.length > 0
        ? tokenRoles
        : ["VIEWER"];
  const userRole = normalizeRole(effectiveRoles[0] ?? "VIEWER");
  const access = resolveUserAccess({
    // Pass email so the super-admin break-glass bypass in resolveUserAccess
    // fires at the edge too — otherwise middleware would block a super admin
    // whose role was broken by a bad override, defeating the safeguard.
    //
    // EXCEPTION: during impersonation (`shouldUseCookieRoles` is true), we
    // withhold the super-admin email so the bypass does NOT fire. The whole
    // point of impersonation is to see the app exactly as the target user
    // sees it — if break-glass always wins, a super admin can never actually
    // test another user's view. Stopping impersonation (clearing the cookie)
    // restores break-glass access immediately since email starts flowing
    // again. Worst-case recovery during a lockout: stop impersonating, then
    // fix the bad override from the UI.
    email: shouldUseCookieRoles ? null : (req.auth?.user?.email ?? null),
    roles: effectiveRoles,
    // Impersonation suppresses extras — admins see role-only access, not the
    // impersonated user's per-user overrides. (Extras are piped from JWT which
    // belongs to the real admin session, so we'd be applying the admin's
    // extras to someone else's role anyway — which is wrong.)
    extraAllowedRoutes: shouldUseCookieRoles ? [] : tokenExtraAllowed,
    extraDeniedRoutes: shouldUseCookieRoles ? [] : tokenExtraDenied,
  });
  const isPathAllowed = (path: string) => isPathAllowedByAccess(access, path);
  const canAccessRouteAdapter = (_role: UserRole, path: string) =>
    isPathAllowedByAccess(access, path);

  // Set Sentry context for edge-level errors
  Sentry.getCurrentScope().setTag("request_id", requestId);
  if (isLoggedIn && req.auth?.user) {
    Sentry.setUser({
      email: req.auth.user.email ?? undefined,
      username: req.auth.user.name ?? undefined,
    });
  }

  const isLoginPage = pathname === "/login";
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const isPublicApiRoute = PUBLIC_API_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  const isImpersonationApiRoute = pathname === "/api/admin/impersonate";
  const isMaintenancePage = pathname === "/maintenance";
  const isProtectedStaticFile = pathname === "/sop-guide.html" || pathname.startsWith("/prototypes/");
  const isStaticFile =
    !isProtectedStaticFile && (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    /\/[^/]+\.[^/]+$/.test(pathname));

  // Check for maintenance mode
  const maintenanceMode = process.env.MAINTENANCE_MODE === "true";

  // If maintenance mode is ON, redirect all non-maintenance pages to /maintenance
  if (maintenanceMode && !isMaintenancePage && !isStaticFile && !isApiRoute) {
    return addSecurityHeaders(requestId, NextResponse.redirect(new URL("/maintenance", req.url)));
  }

  // If maintenance mode is OFF and user is on maintenance page, redirect to home
  if (!maintenanceMode && isMaintenancePage) {
    return addSecurityHeaders(requestId, NextResponse.redirect(new URL("/", req.url)));
  }

  // Always allow auth routes and static files
  if (isAuthRoute || isStaticFile) {
    return nextWithRequestId(requestId, req);
  }

  // API routes - require authentication + role-based access
  if (isApiRoute) {
    if (isPublicApiRoute) {
      return nextWithRequestId(requestId, req);
    }

    // Allow auth endpoints without session check
    if (pathname.startsWith("/api/auth")) {
      return nextWithRequestId(requestId, req);
    }

    // Allow machine-to-machine access via API_SECRET_TOKEN Bearer token
    const apiSecretToken = process.env.API_SECRET_TOKEN;
    const authHeader = req.headers.get("authorization");
    if (apiSecretToken && authHeader === `Bearer ${apiSecretToken}`) {
      if (!isMachineTokenAllowedRoute(pathname)) {
        const response = NextResponse.json(
          { error: "Forbidden - API token is not allowed for this route" },
          { status: 403 }
        );
        return addSecurityHeaders(requestId, response);
      }
      return nextWithRequestId(requestId, req, { "x-api-token-authenticated": "1" });
    }

    // IT team read-only export token — scoped strictly to /api/it/* so the
    // key can be rotated independently of API_SECRET_TOKEN and cannot write
    // to BOM/Zuper endpoints.
    const itExportToken = process.env.IT_EXPORT_TOKEN;
    if (itExportToken && authHeader === `Bearer ${itExportToken}` && pathname.startsWith("/api/it/")) {
      return nextWithRequestId(requestId, req, { "x-it-export-authenticated": "1" });
    }

    // For other API routes, require authentication
    if (!isLoggedIn) {
      const response = NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
      addSecurityHeaders(requestId, response);
      return response;
    }

    // Allow authenticated users to check/exit impersonation state.
    // The route handler itself enforces admin requirements for start/stop.
    if (isImpersonationApiRoute) {
      return nextWithRequestId(requestId, req);
    }

    // Enforce role-based API access (check if the role can access this API path)
    if (!isPathAllowed(pathname)) {
      const response = NextResponse.json(
        { error: "Forbidden - Insufficient permissions" },
        { status: 403 }
      );
      addSecurityHeaders(requestId, response);
      return response;
    }

    return nextWithRequestId(requestId, req);
  }

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
    const resolved = resolveRedirectFromCookie(lastPath, userRole, canAccessRouteAdapter);
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

  // Public page routes (portal, etc.) — allow regardless of auth status
  if (!isLoginPage && ALWAYS_ALLOWED.some(route => pathname.startsWith(route))) {
    return nextWithRequestId(requestId, req);
  }

  // Redirect non-logged-in users to login
  if (!isLoginPage && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return addSecurityHeaders(requestId, NextResponse.redirect(loginUrl));
  }

  // Auth-protected static files — any logged-in user can access (no role check)
  if (isProtectedStaticFile && isLoggedIn) {
    return nextWithRequestId(requestId, req);
  }

  // Role-based access control for ALL roles (not just SALES)
  if (isLoggedIn && !isLoginPage) {
    // Check role permissions
    if (!isPathAllowed(pathname)) {
      // Redirect to their default allowed page
      const defaultRoute = getDefaultRouteForRole(userRole);
      return addSecurityHeaders(requestId, NextResponse.redirect(new URL(defaultRoute, req.url)));
    }
  }

  const response = nextWithRequestId(requestId, req);
  writeLastPathCookie(
    response,
    pathname,
    process.env.NODE_ENV === "production"
  );
  return response;
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
