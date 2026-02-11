import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { ROLE_PERMISSIONS, canAccessRoute, type UserRole } from "@/lib/role-permissions";

// Routes that are always accessible (login, auth callbacks)
const ALWAYS_ALLOWED = ["/login", "/api/auth", "/maintenance"];

// Security headers for all responses
function addSecurityHeaders(response: NextResponse): NextResponse {
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
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';"
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
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions || permissions.allowedRoutes.includes("*")) return "/";

  // Find first dashboard route as default landing page
  const dashboardRoute = permissions.allowedRoutes.find(r => r.startsWith("/dashboards/"));
  return dashboardRoute || "/";
}

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const userRole = (req.auth?.user?.role || "VIEWER") as UserRole;
  const pathname = req.nextUrl.pathname;

  const isLoginPage = pathname === "/login";
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isApiRoute = pathname.startsWith("/api/");
  const isMaintenancePage = pathname === "/maintenance";
  const isStaticFile =
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/static/") ||
    pathname.includes(".");

  // Check for maintenance mode
  const maintenanceMode = process.env.MAINTENANCE_MODE === "true";

  // If maintenance mode is ON, redirect all non-maintenance pages to /maintenance
  if (maintenanceMode && !isMaintenancePage && !isStaticFile && !isApiRoute) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/maintenance", req.url)));
  }

  // If maintenance mode is OFF and user is on maintenance page, redirect to home
  if (!maintenanceMode && isMaintenancePage) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/", req.url)));
  }

  // Always allow auth routes and static files
  if (isAuthRoute || isStaticFile) {
    return addSecurityHeaders(NextResponse.next());
  }

  // API routes - require authentication + role-based access
  if (isApiRoute) {
    // Allow auth endpoints without session check
    if (pathname.startsWith("/api/auth")) {
      return addSecurityHeaders(NextResponse.next());
    }

    // For other API routes, require authentication
    if (!isLoggedIn) {
      const response = NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
      return addSecurityHeaders(response);
    }

    // Enforce role-based API access (check if the role can access this API path)
    if (!canAccessRoute(userRole, pathname)) {
      const response = NextResponse.json(
        { error: "Forbidden - Insufficient permissions" },
        { status: 403 }
      );
      return addSecurityHeaders(response);
    }

    return addSecurityHeaders(NextResponse.next());
  }

  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
    const defaultRoute = getDefaultRouteForRole(userRole);
    return addSecurityHeaders(NextResponse.redirect(new URL(defaultRoute, req.url)));
  }

  // Redirect non-logged-in users to login
  if (!isLoginPage && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Role-based access control for ALL roles (not just SALES)
  if (isLoggedIn && !isLoginPage) {
    // Always allow these routes for everyone
    if (ALWAYS_ALLOWED.some(route => pathname.startsWith(route))) {
      return addSecurityHeaders(NextResponse.next());
    }

    // Note: Executive Suite access is enforced client-side in the page component
    // because JWT role is not synced from DB (always defaults to VIEWER in Edge Runtime).
    // The client fetches the real role from /api/auth/sync and redirects if unauthorized.

    // Check role permissions
    if (!canAccessRoute(userRole, pathname)) {
      // Redirect to their default allowed page
      const defaultRoute = getDefaultRouteForRole(userRole);
      return addSecurityHeaders(NextResponse.redirect(new URL(defaultRoute, req.url)));
    }
  }

  return addSecurityHeaders(NextResponse.next());
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
