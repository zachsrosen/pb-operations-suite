/**
 * Comms token lifecycle management.
 *
 * Handles access token caching, refresh, and invalid_grant detection.
 * See spec: "Token Lifecycle & Refresh" section.
 */

import { prisma } from "./db";
import { commsEncryptToken, commsDecryptToken } from "./comms-crypto";

const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenResult =
  | { accessToken: string; disconnected?: never }
  | { disconnected: true; accessToken?: never };

export async function getValidCommsAccessToken(
  userId: string
): Promise<TokenResult> {
  const row = await prisma.commsGmailToken.findUnique({
    where: { userId },
  });

  if (!row) return { disconnected: true };

  const accessToken = commsDecryptToken(row.gmailAccessToken);
  const refreshToken = commsDecryptToken(row.gmailRefreshToken);
  const expiresAt = Number(row.gmailTokenExpiry);

  // Return cached token if not expired (with buffer)
  if (accessToken && expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    return { accessToken };
  }

  // Refresh the token
  if (!refreshToken) return { disconnected: true };

  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    if (body.error === "invalid_grant") {
      // Refresh token is dead — clear tokens, signal disconnect
      await prisma.commsGmailToken.delete({ where: { userId } }).catch(() => {});
      return { disconnected: true };
    }
    throw new Error(`Token refresh failed: ${resp.status} ${body.error || ""}`);
  }

  const data = await resp.json();
  const newAccessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  const newExpiry = BigInt(Date.now() + expiresIn * 1000);

  await prisma.commsGmailToken.update({
    where: { id: row.id },
    data: {
      gmailAccessToken: commsEncryptToken(newAccessToken),
      gmailTokenExpiry: newExpiry,
      // Update refresh token if Google issued a new one
      ...(data.refresh_token
        ? { gmailRefreshToken: commsEncryptToken(data.refresh_token) }
        : {}),
    },
  });

  return { accessToken: newAccessToken };
}
