/**
 * GET /api/admin/eagleview/truedesign/oauth/authorize
 *
 * One-time TrueDesign API login (OAuth Authorization Code + PKCE). Generates a
 * PKCE verifier, stashes it in an httpOnly cookie, and redirects to EagleView's
 * authorize screen. The callback exchanges the code for a refresh token stored
 * in SystemConfig. Admin-only (covered by the /api/admin/* prefix check).
 *
 * Register this route's sibling /callback URL as the redirect URI on the
 * EagleView OAuth app.
 */
import { NextResponse } from "next/server";
import { buildAuthorizeUrl, generateCodeVerifier, codeChallengeS256 } from "@/lib/eagleview-truedesign-core";
import { resolveTdClientId } from "@/lib/eagleview-truedesign";

export const dynamic = "force-dynamic";

const COOKIE = "ev_td_pkce_verifier";

export async function GET() {
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);
  const state = generateCodeVerifier().slice(0, 16);
  const redirectUri = `${process.env.AUTH_URL ?? "https://pbtechops.com"}/api/admin/eagleview/truedesign/oauth/callback`;

  let authUrl: string;
  try {
    const clientId = await resolveTdClientId();
    authUrl = buildAuthorizeUrl(redirectUri, challenge, state, clientId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "authorize_url_failed" },
      { status: 500 },
    );
  }

  const res = NextResponse.redirect(authUrl);
  // PKCE verifier must survive the round trip; httpOnly + short-lived.
  res.cookies.set(COOKIE, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/admin/eagleview/truedesign/oauth",
    maxAge: 600,
  });
  return res;
}
