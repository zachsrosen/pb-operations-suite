/**
 * GET /api/admin/eagleview/truedesign/oauth/callback
 *
 * OAuth Authorization Code + PKCE callback. Reads the code + the PKCE verifier
 * cookie set by /authorize, exchanges them for tokens, and persists the refresh
 * token to SystemConfig (`eagleview_truedesign_refresh_token`). Admin-only.
 */
import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/eagleview-truedesign";

export const dynamic = "force-dynamic";

const COOKIE = "ev_td_pkce_verifier";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    return NextResponse.json({ error: err, detail: url.searchParams.get("error_description") }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const verifier = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!verifier) {
    return NextResponse.json(
      { error: "Missing PKCE verifier cookie — restart at /api/admin/eagleview/truedesign/oauth/authorize" },
      { status: 400 },
    );
  }

  const redirectUri = `${process.env.AUTH_URL ?? "https://pbtechops.com"}/api/admin/eagleview/truedesign/oauth/callback`;
  try {
    const { expiresIn } = await exchangeCodeForTokens(code, decodeURIComponent(verifier), redirectUri);
    const html = `<!DOCTYPE html><html><head><title>TrueDesign OAuth Complete</title></head>
      <body style="font-family:system-ui;padding:2rem;">
        <h1>EagleView TrueDesign OAuth complete</h1>
        <p>Refresh token saved. Access token valid for ${expiresIn}s.</p>
        <p>Set the <code>eagleview_truedesign_pull_enabled</code> SystemConfig flag to "true" to enable the pull.</p>
        <p><a href="/dashboards/admin">&larr; Back to Admin</a></p>
      </body></html>`;
    const res = new NextResponse(html, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
    res.cookies.set(COOKIE, "", { path: "/api/admin/eagleview/truedesign/oauth", maxAge: 0 });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: "Token exchange failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 502 },
    );
  }
}
