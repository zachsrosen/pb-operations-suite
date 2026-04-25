import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { sharedInboxRedirectUri } from "../connect/route";

function verifyState(
  state: string,
): { email: string; inbox: string } | { error: string } {
  const parts = state.split(":");
  if (parts.length !== 5) return { error: "malformed state" };
  const [email, inbox, nonce, expiryStr, sig] = parts;
  const payload = `${email}:${inbox}:${nonce}:${expiryStr}`;
  const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
  const expected = crypto
    .createHmac("sha256", key)
    .update(payload)
    .digest("hex");
  if (sig !== expected) return { error: "state signature mismatch" };
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) {
    return { error: "state expired" };
  }
  return { email, inbox };
}

/**
 * OAuth callback for the shared-inbox consent flow.
 *
 * Google redirects here after the admin grants (or declines) gmail.readonly
 * consent. On success:
 *   1. Verify the signed `state` (contains the target inbox address)
 *   2. Exchange the `code` for access + refresh tokens
 *   3. Fetch /userinfo to verify the Google account actually matches
 *      the target inbox (protects against the admin accidentally signing
 *      in as themselves instead of the shared inbox)
 *   4. Upsert the SharedInboxCredential row keyed by inboxAddress
 *   5. Redirect back to the admin page with a status message
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const redirectBack = (status: "ok" | "error", message: string) => {
    const back = new URL("/dashboards/admin/shared-inboxes", url);
    back.searchParams.set("status", status);
    back.searchParams.set("message", message);
    return NextResponse.redirect(back);
  };

  if (errorParam) {
    return redirectBack("error", `Google denied consent: ${errorParam}`);
  }
  if (!code || !state) {
    return redirectBack("error", "Missing code or state");
  }

  const stateResult = verifyState(state);
  if ("error" in stateResult) {
    return redirectBack("error", stateResult.error);
  }
  const { inbox: targetInbox, email: adminEmail } = stateResult;

  // Exchange code for tokens
  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    return redirectBack(
      "error",
      "COMMS_GOOGLE_CLIENT_ID/SECRET not configured on server",
    );
  }

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: sharedInboxRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResp.ok) {
    const body = await tokenResp.text().catch(() => "");
    return redirectBack(
      "error",
      `Token exchange failed: ${tokenResp.status} ${body.slice(0, 200)}`,
    );
  }
  const tokenBody = (await tokenResp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokenBody.access_token || !tokenBody.refresh_token) {
    return redirectBack(
      "error",
      "Token response missing access_token or refresh_token (try again with prompt=consent)",
    );
  }

  // Verify who we actually got consent from
  const userinfoResp = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
  );
  if (!userinfoResp.ok) {
    return redirectBack(
      "error",
      `Failed to verify Google account: ${userinfoResp.status}`,
    );
  }
  const userinfo = (await userinfoResp.json()) as { email?: string };
  const signedInEmail = (userinfo.email ?? "").toLowerCase();
  if (signedInEmail !== targetInbox.toLowerCase()) {
    return redirectBack(
      "error",
      `You signed in as ${signedInEmail || "unknown"} but tried to connect ${targetInbox}. Sign in AS the shared inbox account (use Google's "Use another account" or switch profiles first), then try again.`,
    );
  }

  const tokenExpiry = Date.now() + (tokenBody.expires_in ?? 3600) * 1000;
  await prisma.sharedInboxCredential.upsert({
    where: { inboxAddress: targetInbox },
    create: {
      inboxAddress: targetInbox,
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      tokenExpiry: BigInt(tokenExpiry),
      scopes: tokenBody.scope ?? "",
      connectedBy: adminEmail,
    },
    update: {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      tokenExpiry: BigInt(tokenExpiry),
      scopes: tokenBody.scope ?? "",
      connectedBy: adminEmail,
      lastRefreshAt: new Date(),
      lastRefreshErr: null,
    },
  });

  return redirectBack("ok", `Connected ${targetInbox}`);
}
