import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  canAccessRoute,
  getDefaultRouteForRole,
  normalizeRole,
  type UserRole,
} from "@/lib/role-permissions";
// Solar CORS no longer needed — Solar Surveyor served from same origin

// Routes that are always accessible (login, auth callbacks)
const ALWAYS_ALLOWED = ["/login", "/api/auth", "/maintenance", "/portal"];
const PUBLIC_API_ROUTES = [
  "/api/deployment",
  "/api/updates/notify",
  "/api/sentry-canary",
  "/api/webhooks/hubspot/design-complete",
  "/api/webhooks/hubspot/ready-to-build",
  "/api/webhooks/hubspot/design-review",
  "/api/webhooks/hubspot/site-survey-readiness",
  "/api/webhooks/hubspot/fdr-check",
  "/api/cron/audit-digest",
  "/api/cron/audit-retention",
  "/api/cron/pipeline-health",
  "/api/cron/daily-focus",
  "/api/cron/eod-summary",
  "/api/portal/survey", // Customer portal — token-validated, no session needed
  "/api/solar/cron/cleanup-pending", // Solar cron — CRON_SECRET validated in route
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
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self';"
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
  const tokenRole = req.auth?.user?.role as UserRole | undefined;
  const cookieRole = req.cookies.get("pb_effective_role")?.value as UserRole | undefined;
  const isImpersonatingCookie = req.cookies.get("pb_is_impersonating")?.value === "1";
  // Impersonation cookie (set server-side, httpOnly) takes precedence only
  // when the authenticated user is ADMIN. This prevents privilege escalation
  // if the cookie is tampered with on a non-admin session.
  // Never let the cookie elevate to ADMIN/OWNER. VIEWER is accepted only
  // while the dedicated impersonation-state cookie is active.
  const isAdminToken = tokenRole === "ADMIN";
  const isSafeCookieRole = cookieRole && cookieRole !== "ADMIN" && cookieRole !== "EXECUTIVE";
  const shouldUseCookieRole =
    isAdminToken && !!isSafeCookieRole && (cookieRole !== "VIEWER" || isImpersonatingCookie);
  // Edge-runtime JWT sync gap: When sign-in happens on edge, syncRoleToToken
  // bails (Prisma is unavailable) and the JWT role stays undefined/VIEWER.
  // AuthSync.tsx later calls POST /api/auth/sync which sets pb_effective_role
  // from the DB. Trust this httpOnly cookie as a fallback so users aren't
  // stuck at VIEWER until their JWT naturally refreshes.
  const isEdgeSyncFallback =
    !shouldUseCookieRole &&
    isLoggedIn &&
    (!tokenRole || tokenRole === "VIEWER") &&
    cookieRole &&
    cookieRole !== "VIEWER" &&
    !isImpersonatingCookie;
  const rawRole = (shouldUseCookieRole ? cookieRole : isEdgeSyncFallback ? cookieRole : tokenRole) || "VIEWER";
  const userRole = normalizeRole(rawRole);

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
    if (!canAccessRoute(userRole, pathname)) {
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
    // Honor callbackUrl if present and same-origin
    const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
    if (callbackUrl) {
      try {
        const target = new URL(callbackUrl, req.url);
        const baseOrigin = new URL(req.url).origin;
        if (target.origin === baseOrigin) {
          return addSecurityHeaders(requestId, NextResponse.redirect(target));
        }
      } catch {
        // Invalid URL — fall through to default route
      }
    }

    const defaultRoute = getDefaultRouteForRole(userRole);
    return addSecurityHeaders(requestId, NextResponse.redirect(new URL(defaultRoute, req.url)));
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
    if (!canAccessRoute(userRole, pathname)) {
      // Redirect to their default allowed page
      const defaultRoute = getDefaultRouteForRole(userRole);
      return addSecurityHeaders(requestId, NextResponse.redirect(new URL(defaultRoute, req.url)));
    }
  }

  return nextWithRequestId(requestId, req);
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
