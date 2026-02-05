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
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  // If maintenance mode is OFF and user is on maintenance page, redirect to home
  if (!maintenanceMode && isMaintenancePage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Always allow auth routes and static files
  if (isAuthRoute || isStaticFile) {
    return NextResponse.next();
  }

  // Allow API routes (they can have their own auth)
  if (isApiRoute) {
    return NextResponse.next();
  }

  // Redirect logged-in users away from login page
  if (isLoginPage && isLoggedIn) {
    // SALES users go to survey scheduler, others go to home
    if (userRole === "SALES") {
      return NextResponse.redirect(new URL("/dashboards/site-survey-scheduler", req.url));
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Redirect non-logged-in users to login
  if (!isLoginPage && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based access control for SALES users
  if (isLoggedIn && userRole === "SALES") {
    const canAccess = SALES_ALLOWED_ROUTES.some(route => pathname.startsWith(route));
    if (!canAccess) {
      // Redirect SALES users to their allowed page
      return NextResponse.redirect(new URL("/dashboards/site-survey-scheduler", req.url));
    }
  }

  return NextResponse.next();
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
