/**
 * Access token resolver for shared-inbox OAuth credentials.
 *
 * Loads the refresh token from SharedInboxCredential keyed by inbox address,
 * refreshes if the cached access token is expired (or near-expired), and
 * returns a valid access token. Records the refresh outcome so the admin
 * UI can show "last refresh failed" to nudge re-consent.
 *
 * Falls back to returning null (not throwing) so callers can degrade to
 * the Gmail search deep-link gracefully.
 */

import { prisma } from "@/lib/db";

const REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh when <2min left

export async function getStoredSharedInboxToken(
  inboxAddress: string,
): Promise<string | null> {
  const cred = await prisma.sharedInboxCredential.findUnique({
    where: { inboxAddress },
  });
  if (!cred) return null;

  const expiresAtMs = Number(cred.tokenExpiry);
  if (Date.now() + REFRESH_BUFFER_MS < expiresAtMs) {
    return cred.accessToken;
  }

  // Refresh.
  const clientId = process.env.COMMS_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.COMMS_GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: cred.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      await prisma.sharedInboxCredential.update({
        where: { inboxAddress },
        data: {
          lastRefreshErr: `HTTP ${resp.status}: ${body.slice(0, 200)}`,
          lastRefreshAt: new Date(),
        },
      });
      return null;
    }
    const body = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) {
      await prisma.sharedInboxCredential.update({
        where: { inboxAddress },
        data: {
          lastRefreshErr: "refresh response missing access_token",
          lastRefreshAt: new Date(),
        },
      });
      return null;
    }
    const newExpiry = Date.now() + (body.expires_in ?? 3600) * 1000;
    await prisma.sharedInboxCredential.update({
      where: { inboxAddress },
      data: {
        accessToken: body.access_token,
        tokenExpiry: BigInt(newExpiry),
        lastRefreshAt: new Date(),
        lastRefreshErr: null,
      },
    });
    return body.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.sharedInboxCredential
      .update({
        where: { inboxAddress },
        data: {
          lastRefreshErr: `exception: ${msg.slice(0, 200)}`,
          lastRefreshAt: new Date(),
        },
      })
      .catch(() => {});
    return null;
  }
}
