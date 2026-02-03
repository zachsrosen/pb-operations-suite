import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface SessionData {
  token: string;
  email: string;
  createdAt: number;
}

function isValidSession(cookieValue: string): boolean {
  try {
    const session: SessionData = JSON.parse(cookieValue);

    // Check if session has required fields
    if (!session.token || !session.email || !session.createdAt) {
      return false;
    }

    // Check if session is not expired (7 days)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    if (Date.now() - session.createdAt > maxAge) {
      return false;
    }

    // Validate email domain
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com";
    const domains = allowedDomain.split(",").map((d) => d.trim().toLowerCase());
    const emailValid = domains.some((domain) =>
      session.email.toLowerCase().endsWith(`@${domain}`)
    );

    return emailValid;
  } catch {
    // If parsing fails, check for legacy password-based auth
    const sitePassword = process.env.SITE_PASSWORD;
    if (sitePassword && cookieValue === sitePassword) {
      return true;
    }
    return false;
  }
}

export function middleware(request: NextRequest) {
  // Skip API routes (they have their own auth)
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip static files
  if (
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname.startsWith("/static/") ||
    request.nextUrl.pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check if auth is required
  const sitePassword = process.env.SITE_PASSWORD;
  const resendApiKey = process.env.RESEND_API_KEY;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;

  // If neither password nor email auth is configured, allow access
  if (!sitePassword && !resendApiKey && !allowedDomain) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get("pb-auth");

  if (authCookie?.value && isValidSession(authCookie.value)) {
    return NextResponse.next();
  }

  // Redirect to login page
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (login page)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|login).*)",
  ],
};
