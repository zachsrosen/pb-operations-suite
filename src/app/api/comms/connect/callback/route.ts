import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { commsEncryptToken } from "@/lib/comms-crypto";
import { commsRedirectUri } from "@/lib/comms-url";

function verifyState(state: string, expectedUserId: string): boolean {
  try {
    const parts = state.split(":");
    if (parts.length !== 4) return false;
    const [userId, nonce, expiresAtStr, signature] = parts;

    // Check expiry
    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) return false;

    // Check user ID matches session
    if (userId !== expectedUserId) return false;

    // Validate hex format before Buffer.from
    if (!/^[0-9a-f]+$/i.test(signature)) return false;

    // Verify HMAC signature
    const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
    const payload = `${userId}:${nonce}:${expiresAtStr}`;
    const expectedSig = crypto
      .createHmac("sha256", key)
      .update(payload)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSig, "hex")
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked || !user) {
    return NextResponse.redirect(new URL("/dashboards/comms?error=auth", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";

  if (!code || !verifyState(state, user.id)) {
    return NextResponse.redirect(
      new URL("/dashboards/comms?error=invalid_state", req.url)
    );
  }

  // Exchange code for tokens
  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";
  const redirectUri = commsRedirectUri(req);

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    return NextResponse.redirect(
      new URL("/dashboards/comms?error=token_exchange", req.url)
    );
  }

  const data = await tokenResp.json();
  const expiresIn = (data.expires_in as number) || 3600;

  // Verify the authorized Gmail account matches the PB Ops user
  const profileResp = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${data.access_token}` } }
  );
  if (profileResp.ok) {
    const profile = await profileResp.json();
    const gmailEmail = (profile.emailAddress || "").toLowerCase();
    const userEmail = (user.email || "").toLowerCase();
    if (gmailEmail && userEmail && gmailEmail !== userEmail) {
      return NextResponse.redirect(
        new URL(
          `/dashboards/comms?error=email_mismatch&expected=${encodeURIComponent(userEmail)}&got=${encodeURIComponent(gmailEmail)}`,
          req.url
        )
      );
    }
  }

  // Upsert token record
  await prisma.commsGmailToken.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      gmailAccessToken: commsEncryptToken(data.access_token),
      gmailRefreshToken: commsEncryptToken(data.refresh_token || ""),
      gmailTokenExpiry: BigInt(Date.now() + expiresIn * 1000),
      chatEnabled: true,
      scopes: data.scope || "",
    },
    update: {
      gmailAccessToken: commsEncryptToken(data.access_token),
      // Only overwrite refresh token if Google actually returns a new one —
      // reconnects often omit it, and blanking the stored token disconnects
      // the user once the access token expires.
      ...(data.refresh_token
        ? { gmailRefreshToken: commsEncryptToken(data.refresh_token) }
        : {}),
      gmailTokenExpiry: BigInt(Date.now() + expiresIn * 1000),
      chatEnabled: true,
      scopes: data.scope || "",
    },
  });

  // Ensure CommsUserState exists
  await prisma.commsUserState.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return NextResponse.redirect(new URL("/dashboards/comms?connected=true", req.url));
}
