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
const GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

type TokenResult =
  | { accessToken: string; disconnected?: never }
  | { disconnected: true; accessToken?: never };

/**
 * Verify that the Gmail mailbox behind a token matches the PB user's email.
 * - If gmailEmail is already stored: compare directly (fast path).
 * - If gmailEmail is null (legacy token): call the Gmail profile API to
 *   check, then backfill on match or disconnect on mismatch.
 * Returns true if the token is safe to use, false if it was deleted.
 */
async function verifyMailboxIdentity(
  row: { id: number; userId: string; gmailEmail: string | null },
  userEmail: string | null | undefined,
  currentAccessToken: string
): Promise<boolean> {
  if (!userEmail) return true; // Can't verify without a user email — allow

  // Fast path: gmailEmail already recorded
  if (row.gmailEmail) {
    if (row.gmailEmail.toLowerCase() === userEmail.toLowerCase()) return true;
    await prisma.commsGmailToken.delete({ where: { userId: row.userId } }).catch(() => {});
    return false;
  }

  // Legacy token without gmailEmail — call Gmail profile to check + backfill
  try {
    const profileResp = await fetch(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${currentAccessToken}` },
    });
    if (!profileResp.ok) {
      // Can't verify — fail closed: disconnect so user reconnects properly
      await prisma.commsGmailToken.delete({ where: { userId: row.userId } }).catch(() => {});
      return false;
    }
    const profile = await profileResp.json();
    const gmailEmail = (profile.emailAddress || "").toLowerCase();

    if (gmailEmail && gmailEmail !== userEmail.toLowerCase()) {
      // Mismatch — delete and disconnect
      await prisma.commsGmailToken.delete({ where: { userId: row.userId } }).catch(() => {});
      return false;
    }

    // Match — backfill gmailEmail so future checks skip the API call
    if (gmailEmail) {
      await prisma.commsGmailToken
        .update({ where: { id: row.id }, data: { gmailEmail } })
        .catch(() => {});
    }
    return true;
  } catch {
    // Network error verifying identity — fail closed
    await prisma.commsGmailToken.delete({ where: { userId: row.userId } }).catch(() => {});
    return false;
  }
}

export async function getValidCommsAccessToken(
  userId: string
): Promise<TokenResult> {
  const [row, user] = await Promise.all([
    prisma.commsGmailToken.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  ]);

  if (!row) return { disconnected: true };

  const accessToken = commsDecryptToken(row.gmailAccessToken);
  const refreshToken = commsDecryptToken(row.gmailRefreshToken);
  const expiresAt = Number(row.gmailTokenExpiry);

  // If the token is still valid, verify identity before returning it
  if (accessToken && expiresAt > Date.now() + TOKEN_BUFFER_MS) {
    const ok = await verifyMailboxIdentity(row, user?.email, accessToken);
    if (!ok) return { disconnected: true };
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

  // Verify identity with the freshly refreshed token before persisting
  const identityOk = await verifyMailboxIdentity(row, user?.email, newAccessToken);
  if (!identityOk) return { disconnected: true };

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
