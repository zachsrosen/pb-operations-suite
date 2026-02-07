import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Routes that SALES role can access
const SALES_ALLOWED_ROUTES = [
  "/dashboards/site-survey-scheduler",
  "/login",
  "/api/projects",
  "/api/zuper",
  "/api/auth",
];

// Routes that are public (no auth required)
const PUBLIC_ROUTES = [
  "/login",
  "/api/auth",
];

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
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';"
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

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const userRole = req.auth?.user?.role || "VIEWER";
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

  // API routes - require authentication except for public endpoints
  if (isApiRoute) {
    // Allow auth endpoints without session check
    if (pathname.startsWith("/api/auth")) {
      return addSecurityHeaders(NextResponse.next());
    }

    // For other API routes, check if user is authenticated
    // Note: Some API routes have their own additional auth (admin routes, etc.)
    if (!isLoggedIn) {
      // Return 401 for unauthenticated API requests
      const response = NextResponse.json(
        { error: "Unauthorized - Please log in" },
        { status: 401 }
      );
      return addSecurityHeaders(response);
    }

    return addSecurityHeaders(NextResponse.next());
  }

  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
    // SALES users go to survey scheduler, others go to home
    if (userRole === "SALES") {
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboards/site-survey-scheduler", req.url)));
    }
    return addSecurityHeaders(NextResponse.redirect(new URL("/", req.url)));
  }

  // Redirect non-logged-in users to login
  if (!isLoginPage && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Role-based access control for SALES users
  if (isLoggedIn && userRole === "SALES") {
    const canAccess = SALES_ALLOWED_ROUTES.some(route => pathname.startsWith(route));
    if (!canAccess) {
      // Redirect SALES users to their allowed page
      return addSecurityHeaders(NextResponse.redirect(new URL("/dashboards/site-survey-scheduler", req.url)));
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
