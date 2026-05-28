/**
 * Google Chat JWT Verification
 *
 * Verifies the JWT that Google Chat sends with every webhook request.
 * Uses jose library with Google's JWKS endpoint for automatic key rotation.
 *
 * Ref: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_CHAT_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";

const EXPECTED_ISSUER = "chat@system.gserviceaccount.com";

// jose caches JWKS keys automatically; createRemoteJWKSet is safe to call once
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(GOOGLE_CHAT_JWKS_URL));
  }
  return _jwks;
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

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: EXPECTED_ISSUER,
      audience: projectNumber,
    });
    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "JWT verification failed",
    };
  }
}
