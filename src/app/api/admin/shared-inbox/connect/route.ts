import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireApiAuth } from "@/lib/api-auth";

/**
 * GET /api/admin/shared-inbox/connect?inbox=permitsdn@photonbrothers.com
 *
 * Kicks off the Google OAuth consent flow for a shared team mailbox.
 * The admin (ADMIN role) picks an inbox, gets redirected to Google with
 * `login_hint` set to that address — Google shows its "sign in as" UI
 * with the hinted address pre-filled. The admin signs in as the SHARED
 * INBOX account (password known to whoever owns it, usually the team
 * lead) and grants consent for gmail.readonly.
 *
 * This is the workaround for Workspace domain-wide-delegation being
 * blocked on super-admin approval. One-time consent per inbox; tokens
 * refresh automatically via the stored refresh token.
 *
 * Reuses COMMS_GOOGLE_CLIENT_ID (same GCP project as the main OAuth
 * client). The new redirect URI
 * `/api/admin/shared-inbox/callback` must be added to the OAuth client's
 * Authorized redirect URIs in Google Cloud Console.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

function signState(payload: string): string {
  const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

export function sharedInboxRedirectUri(req: NextRequest): string {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.nextUrl.protocol === "https:" ? "https" : "http");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}/api/admin/shared-inbox/callback`;
  if (process.env.AUTH_URL)
    return `${process.env.AUTH_URL}/api/admin/shared-inbox/callback`;
  return "http://localhost:3000/api/admin/shared-inbox/callback";
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const inbox = url.searchParams.get("inbox");
  if (!inbox || !inbox.includes("@")) {
    return NextResponse.json(
      { error: "inbox query param required (email address)" },
      { status: 400 },
    );
  }

  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  if (!clientId) {
    return NextResponse.json(
      { error: "COMMS_GOOGLE_CLIENT_ID not configured" },
      { status: 500 },
    );
  }

  const redirectUri = sharedInboxRedirectUri(req);
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000;
  // state = <admin-user-email>:<target-inbox>:<nonce>:<expiry>:<sig>
  const statePayload = `${auth.email}:${inbox}:${nonce}:${expiresAt}`;
  const state = `${statePayload}:${signState(statePayload)}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // force refresh_token issuance
  authUrl.searchParams.set("login_hint", inbox); // pre-fill the inbox address
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
