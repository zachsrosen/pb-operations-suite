/**
 * Google Chat JWT Verification
 *
 * Verifies the JWT that Google Chat sends with every webhook request.
 * Uses jose library with Google's JWKS endpoint for automatic key rotation.
 *
 * Google Chat signs tokens with EITHER the chat service account JWKS
 * or Google's OAuth2 JWKS (when the app is a Workspace add-on).
 * We try both in sequence.
 *
 * Ref: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
 */

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";

// ── JWKS sources ──

const JWKS_SOURCES = [
  {
    label: "chat-service-account",
    url: "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com",
    issuer: "chat@system.gserviceaccount.com",
  },
  {
    label: "google-oauth2",
    url: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: "https://accounts.google.com",
  },
] as const;

// jose caches JWKS keys automatically; safe to hold module-level singletons
const _jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string) {
  let jwks = _jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    _jwksCache.set(url, jwks);
  }
  return jwks;
}

export type VerifyResult =
  | { valid: true; payload: JWTPayload }
  | { valid: false; error: string };

/**
 * Verify Google Chat webhook JWT.
 * @param authHeader - The raw Authorization header value ("Bearer <token>")
 */
export async function verifyGoogleChatJwt(
  authHeader: string | null
): Promise<VerifyResult> {
  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (!projectNumber) {
    return { valid: false, error: "GOOGLE_CHAT_PROJECT_NUMBER not configured" };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing authorization header" };
  }

  const token = authHeader.slice("Bearer ".length).trim();

  // Log JWT header for debugging key mismatches
  try {
    const header = decodeProtectedHeader(token);
    console.log(
      `[google-chat-auth] JWT header: kid=${header.kid} alg=${header.alg}`
    );
  } catch {
    // non-fatal — proceed with verification
  }

  // Try each JWKS source in order
  const errors: string[] = [];

  for (const source of JWKS_SOURCES) {
    try {
      const { payload } = await jwtVerify(token, getJwks(source.url), {
        issuer: source.issuer,
        audience: projectNumber,
      });
      console.log(
        `[google-chat-auth] Verified via ${source.label} (iss=${payload.iss})`
      );
      return { valid: true, payload };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      errors.push(`${source.label}: ${msg}`);
    }
  }

  return {
    valid: false,
    error: `All JWKS sources failed: ${errors.join("; ")}`,
  };
}
