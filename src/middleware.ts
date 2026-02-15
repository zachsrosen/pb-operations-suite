import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { ROLE_PERMISSIONS, canAccessRoute, normalizeRole, type UserRole } from "@/lib/role-permissions";

// Routes that are always accessible (login, auth callbacks)
const ALWAYS_ALLOWED = ["/login", "/api/auth", "/maintenance"];
const PUBLIC_API_ROUTES = ["/api/deployment"];

// Generate a short request ID for correlation across logs
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// Security headers for all responses
function addSecurityHeaders(requestId: string, response: NextResponse): NextResponse {
  // Request correlation ID for tracing
  response.headers.set("X-Request-Id", requestId);

  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");

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
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
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
 * Get the default redirect route for a role (first dashboard route, or /)
 */
function getDefaultRouteForRole(role: UserRole): string {
  const effectiveRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[effectiveRole];
  if (!permissions || permissions.allowedRoutes.includes("*")) return "/";

  // Prefer suite landing pages when available
  const suiteRoute = permissions.allowedRoutes.find(r => r.startsWith("/suites/"));
  if (suiteRoute) return suiteRoute;

  // Find first dashboard route as default landing page
  const dashboardRoute = permissions.allowedRoutes.find(r => r.startsWith("/dashboards/"));
  if (dashboardRoute) return dashboardRoute;

  // Fallback to the first explicitly allowed route
  return permissions.allowedRoutes[0] || "/";
}

export default auth((req) => {
  const requestId = generateRequestId();
  const isLoggedIn = !!req.auth;
  const tokenRole = req.auth?.user?.role as UserRole | undefined;
  const cookieRole = req.cookies.get("pb_effective_role")?.value as UserRole | undefined;
  // Impersonation cookie (set server-side, httpOnly) takes precedence only
  // when the authenticated user is ADMIN. This prevents privilege escalation
  // if the cookie is tampered with on a non-admin session. Additionally,
  // never let the cookie elevate to ADMIN or OWNER.
  const isAdminToken = tokenRole === "ADMIN";
  const isSafeCookieRole = cookieRole && cookieRole !== "ADMIN" && cookieRole !== "OWNER";
  const rawRole = (isAdminToken && isSafeCookieRole ? cookieRole : tokenRole) || "VIEWER";
  const userRole = normalizeRole(rawRole);
  const pathname = req.nextUrl.pathname;

  const isLoginPage = pathname === "/login";
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const isPublicApiRoute = PUBLIC_API_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
  const isImpersonationApiRoute = pathname === "/api/admin/impersonate";
  const isMaintenancePage = pathname === "/maintenance";
  const isStaticFile =
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    /\/[^/]+\.[^/]+$/.test(pathname);

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
    return addSecurityHeaders(requestId, NextResponse.next());
  }

  // API routes - require authentication + role-based access
  if (isApiRoute) {
    if (isPublicApiRoute) {
      return addSecurityHeaders(requestId, NextResponse.next());
    }

    // Allow auth endpoints without session check
    if (pathname.startsWith("/api/auth")) {
      return addSecurityHeaders(requestId, NextResponse.next());
    }

    // For other API routes, require authentication
    if (!isLoggedIn) {
      const response = NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
      return addSecurityHeaders(requestId, response);
    }

    // Allow authenticated users to check/exit impersonation state.
    // The route handler itself enforces admin requirements for start/stop.
    if (isImpersonationApiRoute) {
      return addSecurityHeaders(requestId, NextResponse.next());
    }

    // Enforce role-based API access (check if the role can access this API path)
    if (!canAccessRoute(userRole, pathname)) {
      const response = NextResponse.json(
        { error: "Forbidden - Insufficient permissions" },
        { status: 403 }
      );
      return addSecurityHeaders(requestId, response);
    }

    return addSecurityHeaders(requestId, NextResponse.next());
  }

  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
    const defaultRoute = getDefaultRouteForRole(userRole);
    return addSecurityHeaders(requestId, NextResponse.redirect(new URL(defaultRoute, req.url)));
  }

  // Redirect non-logged-in users to login
  if (!isLoginPage && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return addSecurityHeaders(requestId, NextResponse.redirect(loginUrl));
  }

  // Role-based access control for ALL roles (not just SALES)
  if (isLoggedIn && !isLoginPage) {
    // Always allow these routes for everyone
    if (ALWAYS_ALLOWED.some(route => pathname.startsWith(route))) {
      return addSecurityHeaders(requestId, NextResponse.next());
    }

    // Check role permissions
    if (!canAccessRoute(userRole, pathname)) {
      // Redirect to their default allowed page
      const defaultRoute = getDefaultRouteForRole(userRole);
      return addSecurityHeaders(requestId, NextResponse.redirect(new URL(defaultRoute, req.url)));
    }
  }

  return addSecurityHeaders(requestId, NextResponse.next());
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
