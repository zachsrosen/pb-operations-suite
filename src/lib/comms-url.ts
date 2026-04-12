import { NextRequest } from "next/server";

/**
 * Derive the Comms OAuth redirect URI from the incoming request.
 *
 * In production on Vercel the most reliable source is the request's own
 * `x-forwarded-host` / `host` header — the same mechanism NextAuth v5 uses
 * internally so it works on custom domains, preview deploys, and localhost.
 *
 * Falls back through AUTH_URL / NEXTAUTH_URL / VERCEL_URL env vars.
 */
export function commsRedirectUri(req: NextRequest): string {
  const base = getBaseUrl(req);
  return `${base}/api/comms/connect/callback`;
}

function getBaseUrl(req: NextRequest): string {
  // 1. Derive from request headers (most reliable on Vercel)
  const proto =
    req.headers.get("x-forwarded-proto") || (req.nextUrl.protocol === "https:" ? "https" : "http");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;

  // 2. Explicit env vars (same precedence as rest of codebase)
  if (process.env.AUTH_URL) return process.env.AUTH_URL;
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  // 3. Development fallback
  return "http://localhost:3000";
}
