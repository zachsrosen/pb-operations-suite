/**
 * Solar Surveyor CORS Utilities
 *
 * Handles cross-origin requests from Solar Surveyor frontend.
 * Used by middleware for preflight and by route handlers for response headers.
 *
 * Edge-compatible — no Node.js dependencies.
 */

/**
 * Get the list of allowed origins for Solar Surveyor cross-origin requests.
 * Set via SOLAR_ALLOWED_ORIGINS env var (comma-separated).
 *
 * Production: "https://solar.photonbrothers.com"
 * Dev: "http://localhost:5173"
 * Preview: explicit Vercel preview URLs as needed
 */
function getAllowedOrigins(): string[] {
  const raw = process.env.SOLAR_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Check if a request origin is in the allowed list.
 */
export function isAllowedSolarOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

/**
 * Check if a request path is a Solar API route.
 */
export function isSolarApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/solar");
}

/**
 * CORS headers for Solar Surveyor cross-origin responses.
 * Returns null if origin is not allowed.
 */
export function getSolarCorsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin || !isAllowedSolarOrigin(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "X-CSRF-Token, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}
