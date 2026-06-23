/**
 * Pure (prisma-free) helpers for the TrueDesign API client: PKCE, OAuth URL
 * building, export endpoint + format mapping, config. Kept separate from
 * `eagleview-truedesign.ts` so it stays unit-testable (importing `@/lib/db`
 * into a test drags in the generated Prisma client, which Jest can't parse).
 */
import { createHash, randomBytes } from "crypto";

/** OAuth host (authorize + token). Same host family as the Measurement token endpoint. */
export const TD_AUTH_BASE =
  process.env.EAGLEVIEW_TD_AUTH_BASE ?? "https://apicenter.eagleview.com";
/** TrueDesign solar API base. */
export const TD_API_BASE = process.env.EAGLEVIEW_TD_API_BASE ?? "https://solar-api.eagleview.com";
export const TD_SCOPE = process.env.EAGLEVIEW_TD_SCOPE ?? "offline_access";

export function tdClientId(): string | undefined {
  return process.env.EAGLEVIEW_TD_CLIENT_ID ?? process.env.EAGLEVIEW_CLIENT_ID;
}
export function tdClientSecret(): string | undefined {
  return process.env.EAGLEVIEW_TD_CLIENT_SECRET ?? process.env.EAGLEVIEW_CLIENT_SECRET;
}
/**
 * HTTP Basic client-authentication header for the token endpoint, or `undefined`
 * for a PUBLIC (PKCE, no-secret) client. The PB TrueDesign app is a public SPA
 * client, so no secret exists — sending `Basic <clientId>:` with an empty secret
 * makes the token endpoint reject the request, so we omit the header entirely and
 * rely on `client_id` + PKCE in the body. Confidential clients (secret set) still
 * get the header.
 */
export function tdBasicAuthHeader(): string | undefined {
  const secret = tdClientSecret();
  if (!secret) return undefined;
  return "Basic " + Buffer.from(`${tdClientId()}:${secret}`).toString("base64");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically-random PKCE code verifier (43–128 chars). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 code challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** Map an export format to the stored Drive-file column + file extension + mime. */
export const TRUEDESIGN_FORMATS = {
  dxf: { ext: "dxf", column: "dxfDriveFileId", mime: "application/dxf" },
  dwg: { ext: "dwg", column: "dwgDriveFileId", mime: "application/acad" },
  pdf: { ext: "pdf", column: "designPdfDriveFileId", mime: "application/pdf" },
} as const;
export type TrueDesignFormat = keyof typeof TRUEDESIGN_FORMATS;

/** Build the export endpoint URL (the call that resolves to the pre-signed S3 URL). */
export function buildExportEndpoint(
  format: TrueDesignFormat,
  reportId: string,
  versionId: string,
): string {
  return `${TD_API_BASE}/api/v1/truedesign/export/${format}/${encodeURIComponent(reportId)}/${encodeURIComponent(versionId)}`;
}

/**
 * Build the OAuth Authorization Code + PKCE authorize URL. The `clientId` is
 * passed in (not read from env here) so the caller can resolve it from env OR a
 * SystemConfig row — see `resolveTdClientId` in eagleview-truedesign.ts.
 */
export function buildAuthorizeUrl(
  redirectUri: string,
  codeChallenge: string,
  state: string,
  clientId: string | undefined,
): string {
  if (!clientId) throw new Error("EagleView TrueDesign client id not configured");
  const u = new URL(`${TD_AUTH_BASE}/oauth2/v1/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", TD_SCOPE);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return u.toString();
}
