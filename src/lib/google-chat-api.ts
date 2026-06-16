/**
 * Google Chat API Client
 *
 * Posts messages to Google Chat spaces/threads using the service account.
 * Used for async responses (the webhook returns immediately, then this
 * module posts the real answer once Claude finishes).
 *
 * Auth: Same JWT-signing pattern as google-calendar.ts — service account
 * email + private key → signed JWT → exchange for access token.
 */

import crypto from "crypto";

const CHAT_API_BASE = "https://chat.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

// ── Token cache (same approach as google-calendar.ts) ──

let _cachedToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function signRS256(data: string, privateKey: string): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKey, "base64");
  return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Parse the service account private key, which may be stored either as a
 * raw PEM (with escaped \n) or base64-encoded. Mirrors the logic used by
 * google-calendar.ts so the same env var works for both integrations.
 */
function parseServiceAccountPrivateKey(serviceAccountKey: string): string | null {
  const normalizedRaw = serviceAccountKey.replace(/\\n/g, "\n").trim();
  if (normalizedRaw.includes("-----BEGIN")) {
    return normalizedRaw;
  }
  const decoded = Buffer.from(serviceAccountKey, "base64").toString("utf-8");
  const normalizedDecoded = decoded.replace(/\\n/g, "\n").trim();
  if (normalizedDecoded.includes("-----BEGIN")) {
    return normalizedDecoded;
  }
  return null;
}

function getServiceAccountCreds() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google service account not configured");
  const privateKey = parseServiceAccountPrivateKey(rawKey);
  if (!privateKey) {
    throw new Error("Google service account private key could not be parsed");
  }
  return { email, privateKey };
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (5-min buffer)
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 300_000) {
    return _cachedToken.token;
  }

  const { email, privateKey } = getServiceAccountCreds();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: CHAT_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await signRS256(signatureInput, privateKey);
  const jwt = `${signatureInput}.${signature}`;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || "unknown"}`);
  }

  _cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return _cachedToken.token;
}

// ── Public API ──

interface PostMessageParams {
  spaceName: string;      // e.g. "spaces/abc123"
  threadName?: string;    // e.g. "spaces/abc123/threads/def456"
  text: string;
}

/**
 * Post a message to a Google Chat space/thread.
 * If threadName is provided, replies in that thread.
 */
export async function postGoogleChatMessage(params: PostMessageParams): Promise<void> {
  const token = await getAccessToken();

  const url = new URL(`${CHAT_API_BASE}/${params.spaceName}/messages`);
  if (params.threadName) {
    url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  }

  const body: Record<string, unknown> = { text: params.text };
  if (params.threadName) {
    body.thread = { name: params.threadName };
  }

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "unknown");
    console.error(`[google-chat-api] Failed to post message: ${resp.status} ${errText}`);
    throw new Error(`Google Chat API error: ${resp.status} ${errText}`.slice(0, 800));
  }
}

export interface GoogleChatSpace {
  name: string;          // "spaces/abc123"
  displayName: string;   // human-readable room name ("" for DMs)
  type: string;          // "ROOM" | "DM" (legacy spaceType)
}

/**
 * List every space the bot is a member of (paginated). The bot's chat.bot
 * token only returns spaces it belongs to — so this is how we resolve a
 * configured room name (e.g. "Tech Ops") to its space id at runtime.
 */
export async function listGoogleChatSpaces(): Promise<GoogleChatSpace[]> {
  const token = await getAccessToken();
  const spaces: GoogleChatSpace[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${CHAT_API_BASE}/spaces`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown");
      throw new Error(`Google Chat spaces.list error: ${resp.status} ${errText}`.slice(0, 800));
    }

    const data = (await resp.json()) as {
      spaces?: Array<{ name?: string; displayName?: string; type?: string; spaceType?: string }>;
      nextPageToken?: string;
    };
    for (const s of data.spaces ?? []) {
      if (!s.name) continue;
      spaces.push({
        name: s.name,
        displayName: s.displayName ?? "",
        type: s.spaceType ?? s.type ?? "",
      });
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return spaces;
}
