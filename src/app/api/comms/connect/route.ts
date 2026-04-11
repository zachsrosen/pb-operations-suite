import { NextResponse } from "next/server";
import crypto from "crypto";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { commsDecryptToken } from "@/lib/comms-crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.users.readstate.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
].join(" ");

function signState(payload: string): string {
  const key = process.env.COMMS_TOKEN_ENCRYPTION_KEY || "";
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

/** GET: Initiate OAuth flow with CSRF-signed state */
export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const redirectUri = `${process.env.AUTH_URL || "http://localhost:3000"}/api/comms/connect/callback`;

  // CSRF state: userId + nonce + expiry, HMAC-signed
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  const statePayload = `${user.id}:${nonce}:${expiresAt}`;
  const signature = signState(statePayload);
  const state = `${statePayload}:${signature}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return NextResponse.json({ authUrl: authUrl.toString() });
}

/** DELETE: Disconnect Gmail — revoke token and delete records */
export async function DELETE() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = await prisma.commsGmailToken.findUnique({
    where: { userId: user.id },
  });

  if (token) {
    // Revoke with Google
    const refreshToken = commsDecryptToken(token.gmailRefreshToken);
    if (refreshToken) {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: "POST" }
      ).catch(() => {});
    }

    await prisma.commsGmailToken.delete({ where: { userId: user.id } });
  }

  await prisma.commsUserState.delete({ where: { userId: user.id } }).catch(() => {});

  return NextResponse.json({ disconnected: true });
}
