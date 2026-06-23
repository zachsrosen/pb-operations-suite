/**
 * EagleView TrueDesign API client (design exports: DXF / DWG / PDF).
 *
 * Distinct from `lib/eagleview.ts` (Measurement Orders API, client-credentials).
 * The TrueDesign **design** export is authorized in a USER context, so this
 * client uses OAuth 2.0 Authorization Code + PKCE with `offline_access`, and
 * stores a rotating refresh token in SystemConfig — same shape as the Enphase
 * integration (`lib/enphase-enlighten.ts`).
 *
 * Mechanism (reverse-engineered 2026-06-19 from the live TrueDesign app):
 *   GET {API_BASE}/api/v1/truedesign/export/{format}/{reportId}/{versionId}
 *     → resolves to a pre-signed S3 URL for SolarDesign-{reportId}.{ext}
 *
 * UNVERIFIED until the one-time OAuth login is done (see spec
 * docs/superpowers/specs/2026-06-19-eagleview-truedesign-cad-pull-design.md):
 *   - OAuth authorize/token host + scope (defaults in core; override via env)
 *   - the design-version list endpoint (path below; confirm + adjust)
 *   - export response shape (redirect vs JSON {url}); both handled
 *   - non-DXF format segments (dxf confirmed)
 *
 * Pure helpers (PKCE, URL building, format map) live in eagleview-truedesign-core.ts.
 */
import { prisma } from "@/lib/db";
import {
  TD_AUTH_BASE,
  TD_API_BASE,
  TD_SCOPE,
  tdBasicAuthHeader,
  buildExportEndpoint,
  type TrueDesignFormat,
} from "@/lib/eagleview-truedesign-core";
import { getRuntimeConfig } from "@/lib/runtime-config-db";

export {
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizeUrl,
  buildExportEndpoint,
  TRUEDESIGN_FORMATS,
  type TrueDesignFormat,
} from "@/lib/eagleview-truedesign-core";

const REFRESH_TOKEN_KEY = "eagleview_truedesign_refresh_token";

/** SystemConfig row key for the TrueDesign OAuth client id (alternative to env). */
const TD_CLIENT_ID_KEY = "eagleview_td_client_id";

/**
 * Resolve the TrueDesign OAuth client id from env (`EAGLEVIEW_TD_CLIENT_ID`, then
 * legacy `EAGLEVIEW_CLIENT_ID`) or the `eagleview_td_client_id` SystemConfig row.
 * The new public app's id is stored in SystemConfig to avoid Vercel's env cap.
 */
export function resolveTdClientId(): Promise<string | undefined> {
  return getRuntimeConfig(TD_CLIENT_ID_KEY, [
    "EAGLEVIEW_TD_CLIENT_ID",
    "EAGLEVIEW_CLIENT_ID",
  ]);
}

/** Token-endpoint headers; only send Basic client auth for confidential clients. */
function tokenHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const basic = tdBasicAuthHeader();
  if (basic) headers.Authorization = basic;
  return headers;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens; persist the refresh token. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: (await resolveTdClientId()) ?? "",
  });
  const res = await fetch(`${TD_AUTH_BASE}/oauth2/v1/token`, {
    method: "POST",
    headers: tokenHeaders(),
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.refresh_token) {
    throw new Error(
      `TrueDesign token exchange failed (${res.status}): ${data.error_description ?? data.error ?? "no refresh_token"}`,
    );
  }
  await prisma.systemConfig.upsert({
    where: { key: REFRESH_TOKEN_KEY },
    create: { key: REFRESH_TOKEN_KEY, value: data.refresh_token },
    update: { value: data.refresh_token },
  });
  return { expiresIn: data.expires_in ?? 3600 };
}

let cachedAccess: { token: string; expiresAtMs: number } | null = null;

/** Get a valid access token, refreshing via the stored refresh token (rotates it). */
export async function getAccessToken(): Promise<string> {
  if (cachedAccess && Date.now() < cachedAccess.expiresAtMs - 60_000) {
    return cachedAccess.token;
  }
  const row = await prisma.systemConfig.findUnique({ where: { key: REFRESH_TOKEN_KEY } });
  const refreshToken = row?.value;
  if (!refreshToken) {
    throw new Error(
      "No TrueDesign refresh token — run the one-time login at /api/admin/eagleview/truedesign/oauth/authorize",
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: TD_SCOPE,
    client_id: (await resolveTdClientId()) ?? "",
  });
  const res = await fetch(`${TD_AUTH_BASE}/oauth2/v1/token`, {
    method: "POST",
    headers: tokenHeaders(),
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `TrueDesign token refresh failed (${res.status}): ${data.error_description ?? data.error ?? "no access_token"}`,
    );
  }
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await prisma.systemConfig.update({
      where: { key: REFRESH_TOKEN_KEY },
      data: { value: data.refresh_token },
    });
  }
  cachedAccess = {
    token: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/**
 * List design version IDs for a report, newest first. NOTE: endpoint path
 * unverified — confirm against the live API during the one-time-login test.
 */
export async function listDesignVersionIds(reportId: string): Promise<string[]> {
  const token = await getAccessToken();
  const res = await fetch(
    `${TD_API_BASE}/api/v1/truedesign/version/${encodeURIComponent(reportId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`TrueDesign version list failed (${res.status})`);
  const data = (await res.json().catch(() => null)) as unknown;
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { versions?: unknown[] })?.versions)
      ? (data as { versions: unknown[] }).versions
      : [];
  return arr
    .map((v) =>
      typeof v === "string"
        ? v
        : (v as { id?: string; versionId?: string })?.id ??
          (v as { versionId?: string })?.versionId ??
          null,
    )
    .filter((v): v is string => !!v);
}

/**
 * Resolve the pre-signed download URL for a format. The export endpoint either
 * 3xx-redirects to S3 or returns JSON `{ url }`; handle both.
 */
export async function getExportDownloadUrl(
  format: TrueDesignFormat,
  reportId: string,
  versionId: string,
): Promise<string> {
  const token = await getAccessToken();
  const res = await fetch(buildExportEndpoint(format, reportId, versionId), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) return loc;
  }
  if (res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      const data = (await res.json().catch(() => ({}))) as { url?: string; downloadUrl?: string };
      const url = data.url ?? data.downloadUrl;
      if (url) return url;
    }
  }
  throw new Error(`TrueDesign export ${format} for ${reportId} failed (${res.status})`);
}

/** Download a file from a (pre-signed) URL. No bearer needed for S3 signed URLs. */
export async function downloadDesignFile(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`TrueDesign file download failed (${res.status})`);
  return res.arrayBuffer();
}
