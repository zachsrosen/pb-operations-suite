/**
 * Google Chat JWT Verification
 *
 * Verifies the JWT that Google Chat sends with every webhook request.
 * Uses jose library with Google's JWKS endpoint for automatic key rotation.
 *
 * Google Chat signs tokens with EITHER the chat service account JWKS
 * or Google's OAuth2 JWKS (when the app is a Workspace add-on).
 * The audience claim may be the project number OR the endpoint URL,
 * depending on the GCP configuration. We accept both.
 *
 * Ref: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
 */

import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";

// ── JWKS sources ──

const JWKS_SOURCES = [
  {
    label: "chat-service-account",
    url: "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com",
    issuers: ["chat@system.gserviceaccount.com"],
  },
  {
    label: "google-oauth2",
    url: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: [
      "https://accounts.google.com",
      "accounts.google.com",
      "chat@system.gserviceaccount.com",
    ],
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
 * Build the list of acceptable audience values.
 * Google Chat may send the project number OR the endpoint URL as the audience.
 */
function getAcceptedAudiences(projectNumber: string): string[] {
  const audiences = [projectNumber];

  // Also accept the endpoint URL as audience (Workspace add-on mode)
  const endpointUrl = process.env.GOOGLE_CHAT_ENDPOINT_URL;
  if (endpointUrl) {
    audiences.push(endpointUrl);
  }

  // Common endpoint URL patterns
  audiences.push(
    `https://www.pbtechops.com/api/webhooks/google-chat`,
    `https://pbtechops.com/api/webhooks/google-chat`
  );

  return audiences;
}

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

  // Log JWT header + claims for debugging
  try {
    const header = decodeProtectedHeader(token);
    const claims = decodeJwt(token);
    console.log(
      `[google-chat-auth] JWT header: kid=${header.kid} alg=${header.alg}`
    );
    console.log(
      `[google-chat-auth] JWT claims: iss=${claims.iss} aud=${claims.aud} sub=${claims.sub}`
    );
  } catch {
    // non-fatal — proceed with verification
  }

  const audiences = getAcceptedAudiences(projectNumber);

  // Try each JWKS source × issuer combination
  const errors: string[] = [];

  for (const source of JWKS_SOURCES) {
    for (const issuer of source.issuers) {
      try {
        const { payload } = await jwtVerify(token, getJwks(source.url), {
          issuer,
          audience: audiences,
        });
        console.log(
          `[google-chat-auth] Verified via ${source.label} (iss=${payload.iss} aud=${payload.aud})`
        );
        return { valid: true, payload };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        errors.push(`${source.label}/${issuer}: ${msg}`);
      }
    }
  }

  console.error(
    `[google-chat-auth] All verification attempts failed:\n${errors.join("\n")}`
  );

  return {
    valid: false,
    error: `All JWKS sources failed: ${errors.join("; ")}`,
  };
}
