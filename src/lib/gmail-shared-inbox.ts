/**
 * Shared Gmail inbox reader — used by the Permit Hub correspondence tab
 * (and the future IC Hub) to pull recent threads from team-owned Gmail
 * mailboxes like permitsdn@, permitting@, interconnections@.
 *
 * Uses the same Google Workspace service account + domain-wide delegation
 * the email-send path uses (lib/email.ts), just with `gmail.readonly`
 * scope and a different impersonated user.
 *
 * Requirements:
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY set
 *   - The service account must be granted domain-wide delegation for
 *     scope `https://www.googleapis.com/auth/gmail.readonly` in the
 *     Google Workspace admin console.
 *   - The impersonated address (e.g., permitsdn@photonbrothers.com) must
 *     be a real mailbox in the Workspace.
 */

import crypto from "node:crypto";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_CACHE_TTL_MS = 55 * 60 * 1000; // Google tokens live 60min; refresh at 55.

// Module-scoped token cache. A shared Map is fine since this runs in a
// single Node.js process (serverless lambda instance) and tokens are
// per-mailbox. Worst case on cold start: one extra JWT exchange.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharedInboxThread {
  id: string;
  subject: string | null;
  from: string | null;
  fromEmail: string | null;
  to: string | null;
  date: string; // ISO
  snippet: string | null;
  /** Deep-link into Gmail (opens the thread in the mailbox owner's web UI). */
  webUrl: string;
}

// ---------------------------------------------------------------------------
// Service-account JWT → access token (gmail.readonly, impersonating `sub`)
// ---------------------------------------------------------------------------

function base64UrlEncode(value: string | Buffer): string {
  const buf = typeof value === "string" ? Buffer.from(value) : value;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parseServiceAccountPrivateKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN PRIVATE KEY")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  try {
    return Buffer.from(trimmed, "base64").toString("utf8").replace(/\\n/g, "\n");
  } catch {
    return null;
  }
}

export interface TokenError {
  ok: false;
  reason: string;
  status?: number;
  body?: string;
}

export type TokenResult = { ok: true; token: string } | TokenError;

async function getReadonlyTokenVerbose(
  impersonateEmail: string,
): Promise<TokenResult> {
  const cached = tokenCache.get(impersonateEmail);
  if (cached && cached.expiresAt > Date.now())
    return { ok: true, token: cached.token };

  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = parseServiceAccountPrivateKey(
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
  if (!serviceAccountEmail) {
    return { ok: false, reason: "GOOGLE_SERVICE_ACCOUNT_EMAIL not set" };
  }
  if (!privateKey) {
    return { ok: false, reason: "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set or invalid" };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccountEmail,
    sub: impersonateEmail,
    scope: GMAIL_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signatureInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signatureInput)
    .sign(privateKey);
  const jwt = `${signatureInput}.${base64UrlEncode(signature)}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenResp.ok) {
    const bodyText = await tokenResp.text().catch(() => "");
    return {
      ok: false,
      reason: `Token exchange failed (HTTP ${tokenResp.status})`,
      status: tokenResp.status,
      body: bodyText.slice(0, 500),
    };
  }
  const body = (await tokenResp.json()) as { access_token?: string };
  if (!body.access_token) {
    return { ok: false, reason: "Token response missing access_token" };
  }

  tokenCache.set(impersonateEmail, {
    token: body.access_token,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
  return { ok: true, token: body.access_token };
}

/**
 * Exposed for diagnostic endpoints — callers can surface the structured
 * failure reason in HTTP responses when debugging (Vercel's log viewer
 * truncates message bodies at ~80 chars).
 */
export async function probeSharedInboxToken(
  impersonateEmail: string,
): Promise<TokenResult> {
  return getReadonlyTokenVerbose(impersonateEmail);
}

// Note: kept thin typed wrapper only for future callers that don't want
// the verbose diagnostic shape. Currently unused internally — every call
// site uses the verbose variant so errors get logged.

// ---------------------------------------------------------------------------
// Thread fetch
// ---------------------------------------------------------------------------

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailThreadList {
  threads?: Array<{ id: string; snippet?: string; historyId?: string }>;
}

interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  const match = headers.find((h) => h.name.toLowerCase() === target);
  return match?.value ?? null;
}

function parseFrom(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const bracketMatch = raw.match(/<([^>]+)>/);
  if (bracketMatch) {
    const email = bracketMatch[1].trim();
    const name = raw.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || null;
    return { name, email };
  }
  return { name: null, email: raw.trim() };
}

/**
 * Build a Gmail search query that matches threads mentioning EITHER the
 * AHJ/utility email OR the site address. Context clauses are OR'd so a
 * thread hits if any identifier matches; this is more forgiving than
 * requiring all of them (Peter often has threads with the AHJ that
 * don't mention the address verbatim, and vice versa).
 *
 * Gmail search DSL notes:
 *   - `newer_than:90d` is relative
 *   - `from:` / `to:` are operators
 *   - Address is searched unquoted so "6323 Galeta Dr" also matches
 *     "6323 Galeta Drive" etc. — stemming is loose enough that this is
 *     usually broader than quoting
 */
export function buildGmailThreadQuery(opts: {
  ahjEmail?: string | null;
  address?: string | null;
  lookbackDays?: number;
}): string {
  const contextClauses: string[] = [];
  if (opts.ahjEmail) {
    contextClauses.push(`from:${opts.ahjEmail}`);
    contextClauses.push(`to:${opts.ahjEmail}`);
  }
  if (opts.address) {
    // Use the street number + street name only. City/state/zip rarely
    // appear verbatim in email bodies and over-constrain the match.
    const firstLine = opts.address.split(",")[0].trim();
    if (firstLine) {
      // Escape any double quotes; Gmail tokenizes the rest without them.
      contextClauses.push(`"${firstLine.replace(/"/g, '\\"')}"`);
    }
  }

  const outer: string[] = [];
  if (contextClauses.length > 0) {
    outer.push(`(${contextClauses.join(" OR ")})`);
  }
  if (opts.lookbackDays) {
    outer.push(`newer_than:${opts.lookbackDays}d`);
  }
  return outer.join(" ");
}

// ---------------------------------------------------------------------------
// Region routing
// ---------------------------------------------------------------------------

export type InboxRegion = "co" | "ca";
export type InboxTeam = "permit" | "ic";

/**
 * Returns the configured shared-inbox address for the given team + region,
 * or null if not configured. Mailbox addresses come from env vars set
 * at deploy time (see .env.example).
 */
export function getSharedInboxAddress(
  team: InboxTeam,
  region: InboxRegion,
): string | null {
  const key =
    team === "permit"
      ? region === "co"
        ? "PERMIT_INBOX_CO"
        : "PERMIT_INBOX_CA"
      : region === "co"
        ? "IC_INBOX_CO"
        : "IC_INBOX_CA";
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export interface FetchSharedInboxOpts {
  mailbox: string; // impersonated inbox address
  query: string; // Gmail search DSL
  maxThreads?: number; // default 10
}

/**
 * Fetch up to N recent threads from the shared inbox that match `query`.
 * Returns [] on any misconfiguration or API failure (never throws) so
 * the correspondence tab gracefully falls back to the Gmail search deep-link.
 */
export async function fetchSharedInboxThreads(
  opts: FetchSharedInboxOpts,
): Promise<SharedInboxThread[]> {
  const { mailbox, query, maxThreads = 10 } = opts;

  // Prefer stored per-inbox OAuth token (workaround for blocked
  // Workspace domain-wide-delegation). Falls back to service-account
  // impersonation which still requires DWD gmail.readonly scope.
  let token: string | null = null;
  try {
    const { getStoredSharedInboxToken } = await import("@/lib/shared-inbox-token");
    token = await getStoredSharedInboxToken(mailbox);
  } catch (err) {
    console.error(
      `[gmail-shared-inbox] stored-token lookup failed for ${mailbox}:`,
      err,
    );
  }

  if (!token) {
    const tokenResult = await getReadonlyTokenVerbose(mailbox);
    if (!tokenResult.ok) {
      console.error(
        `[gmail-shared-inbox] no stored OAuth creds AND service-account token failed for ${mailbox}: ${tokenResult.reason}${tokenResult.body ? ` — ${tokenResult.body}` : ""}`,
      );
      return [];
    }
    token = tokenResult.token;
  }

  try {
    const encodedMailbox = encodeURIComponent(mailbox);

    // 1. List matching threads.
    const listUrl = new URL(
      `${GMAIL_API_BASE}/users/${encodedMailbox}/threads`,
    );
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", String(maxThreads));

    const listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResp.ok) {
      const body = await listResp.text().catch(() => "");
      console.error(
        `[gmail-shared-inbox] threads.list failed for ${mailbox} (HTTP ${listResp.status}): ${body.slice(0, 500)}`,
      );
      return [];
    }
    const listBody = (await listResp.json()) as GmailThreadList;
    const threadIds = (listBody.threads ?? []).map((t) => t.id);
    if (threadIds.length === 0) {
      console.log(
        `[gmail-shared-inbox] 0 threads matched query for ${mailbox}: ${query}`,
      );
      return [];
    }

    // 2. For each thread, fetch the latest message's metadata. Using
    //    format=metadata keeps payloads small (no HTML body).
    const threadPromises = threadIds.map(async (id) => {
      const url = new URL(
        `${GMAIL_API_BASE}/users/${encodedMailbox}/threads/${id}`,
      );
      url.searchParams.set("format", "metadata");
      url.searchParams.append("metadataHeaders", "From");
      url.searchParams.append("metadataHeaders", "To");
      url.searchParams.append("metadataHeaders", "Subject");
      url.searchParams.append("metadataHeaders", "Date");

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return null;
      const body = (await resp.json()) as GmailThread;
      const messages = body.messages ?? [];
      if (messages.length === 0) return null;
      const latest = messages[messages.length - 1];
      const headers = latest.payload?.headers;

      const fromHeader = getHeader(headers, "From");
      const { name: fromName, email: fromEmail } = parseFrom(fromHeader);
      const date = latest.internalDate
        ? new Date(Number(latest.internalDate)).toISOString()
        : new Date().toISOString();

      const thread: SharedInboxThread = {
        id,
        subject: getHeader(headers, "Subject"),
        from: fromName ?? fromEmail,
        fromEmail,
        to: getHeader(headers, "To"),
        date,
        snippet: latest.snippet ?? null,
        webUrl: `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#inbox/${id}`,
      };
      return thread;
    });

    const resolved = await Promise.all(threadPromises);
    const threads = resolved.filter((t): t is SharedInboxThread => t !== null);
    threads.sort((a, b) => (a.date < b.date ? 1 : -1));
    return threads;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Full message body fetch (for PE email sync and similar use-cases)
// ---------------------------------------------------------------------------

export interface SharedInboxMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string; // ISO 8601
  plainTextBody: string;
}

export type FetchMessagesResult =
  | { ok: true; messages: SharedInboxMessage[] }
  | { ok: false; error: string };

/**
 * Fetch full messages (including plaintext body) from a shared inbox.
 * Unlike `fetchSharedInboxThreads()` which only returns metadata + snippets,
 * this fetches the full message payload for parsing email body content.
 *
 * Returns a discriminated union so callers can distinguish "no emails" from
 * "Gmail unreachable".
 */
export async function fetchSharedInboxMessages(opts: {
  mailbox: string;
  query: string;
  maxMessages?: number;
}): Promise<FetchMessagesResult> {
  const { mailbox, query, maxMessages = 100 } = opts;

  // Auth: same stored-token-first, service-account-fallback pattern
  let token: string | null = null;
  try {
    const { getStoredSharedInboxToken } = await import(
      "@/lib/shared-inbox-token"
    );
    token = await getStoredSharedInboxToken(mailbox);
  } catch (err) {
    console.error(
      `[gmail-shared-inbox] stored-token lookup failed for ${mailbox}:`,
      err,
    );
  }

  if (!token) {
    const tokenResult = await getReadonlyTokenVerbose(mailbox);
    if (!tokenResult.ok) {
      return {
        ok: false,
        error: `Auth failed for ${mailbox}: ${tokenResult.reason}${tokenResult.body ? ` — ${tokenResult.body}` : ""}`,
      };
    }
    token = tokenResult.token;
  }

  const encodedMailbox = encodeURIComponent(mailbox);

  // 1. List message IDs matching the query
  const listUrl = new URL(
    `${GMAIL_API_BASE}/users/${encodedMailbox}/messages`,
  );
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(maxMessages));

  let listResp: Response;
  try {
    listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { ok: false, error: `Network error listing messages: ${err}` };
  }

  if (!listResp.ok) {
    const body = await listResp.text().catch(() => "");
    return {
      ok: false,
      error: `messages.list failed (HTTP ${listResp.status}): ${body.slice(0, 300)}`,
    };
  }

  const listBody = (await listResp.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  const messageIds = listBody.messages ?? [];
  if (messageIds.length === 0) {
    return { ok: true, messages: [] };
  }

  // 2. Fetch each message with full payload (sequential to respect rate limits)
  const messages: SharedInboxMessage[] = [];

  for (const { id } of messageIds) {
    const msgUrl = `${GMAIL_API_BASE}/users/${encodedMailbox}/messages/${id}?format=full`;
    let msgResp: Response;
    try {
      msgResp = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      console.warn(`[gmail-shared-inbox] failed to fetch message ${id}`);
      continue;
    }
    if (!msgResp.ok) {
      console.warn(
        `[gmail-shared-inbox] message ${id} fetch failed (HTTP ${msgResp.status})`,
      );
      continue;
    }

    const msg = (await msgResp.json()) as GmailMessage;
    const payload = msg.payload;
    if (!payload) continue;

    // Extract plaintext body
    const plainText = extractPlainTextBody(payload);
    if (!plainText) continue;

    // Extract headers
    const headers = payload.headers;
    const subject = getHeader(headers, "Subject") ?? "";
    const from = getHeader(headers, "From") ?? "";
    const dateHeader = getHeader(headers, "Date");
    const date = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();

    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      subject,
      from,
      date,
      plainTextBody: plainText,
    });
  }

  // Sort oldest-first (chronological order for safe upsert)
  messages.sort((a, b) => (a.date < b.date ? -1 : 1));

  return { ok: true, messages };
}

/**
 * Recursively walk the MIME tree to find the text/plain body and decode it.
 */
function extractPlainTextBody(part: GmailMessagePart): string | null {
  // Direct text/plain at this level
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf-8");
  }

  // Multipart — recurse into parts
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractPlainTextBody(child);
      if (text) return text;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Attachment listing + download
// ---------------------------------------------------------------------------

export interface SharedInboxAttachment {
  messageId: string;
  threadId: string;
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string; // opaque Gmail attachment handle; pass to downloadSharedInboxAttachment
  /** Headers from the parent message — useful for callers that need date/subject context. */
  messageSubject: string;
  messageDate: string; // ISO
  messageFrom: string;
}

export interface FetchAttachmentsOpts {
  mailbox: string;
  query: string;
  maxMessages?: number;
  /** Filter — only return attachments whose mimeType matches this regex. */
  mimeTypePattern?: RegExp;
}

export type FetchAttachmentsResult =
  | { ok: true; attachments: SharedInboxAttachment[] }
  | { ok: false; error: string };

/**
 * Search a shared inbox by query and return every attachment matching the
 * (optional) mime-type filter. Walks the MIME tree of each matched message
 * so it picks up attachments nested in multipart/alternative or
 * multipart/related parts.
 *
 * Returns attachment metadata only — call `downloadSharedInboxAttachment`
 * with the (messageId, attachmentId) pair to fetch the actual bytes.
 */
export async function fetchSharedInboxAttachments(
  opts: FetchAttachmentsOpts,
): Promise<FetchAttachmentsResult> {
  const { mailbox, query, maxMessages = 25, mimeTypePattern = /application\/pdf/i } = opts;

  const token = await getReadonlyToken(mailbox);
  if (!token) {
    return { ok: false, error: `Auth failed for ${mailbox}` };
  }
  const encodedMailbox = encodeURIComponent(mailbox);

  // 1. List matching message IDs
  const listUrl = new URL(`${GMAIL_API_BASE}/users/${encodedMailbox}/messages`);
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(maxMessages));
  const listResp = await fetch(listUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!listResp.ok) {
    const body = await listResp.text().catch(() => "");
    return { ok: false, error: `messages.list failed (HTTP ${listResp.status}): ${body.slice(0, 200)}` };
  }
  const listBody = (await listResp.json()) as { messages?: Array<{ id: string; threadId: string }> };
  const messageIds = listBody.messages ?? [];
  if (messageIds.length === 0) return { ok: true, attachments: [] };

  // 2. Walk each message's MIME tree for attachments
  const attachments: SharedInboxAttachment[] = [];
  for (const { id, threadId } of messageIds) {
    const msgUrl = `${GMAIL_API_BASE}/users/${encodedMailbox}/messages/${id}?format=full`;
    const msgResp = await fetch(msgUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!msgResp.ok) continue;
    const msg = (await msgResp.json()) as GmailMessage;
    if (!msg.payload) continue;

    const subject = getHeader(msg.payload.headers, "Subject") ?? "(no subject)";
    const dateHeader = getHeader(msg.payload.headers, "Date");
    const date = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();
    const from = getHeader(msg.payload.headers, "From") ?? "";

    for (const part of walkMimeParts(msg.payload)) {
      if (!part.body?.attachmentId || !part.filename) continue;
      if (mimeTypePattern && part.mimeType && !mimeTypePattern.test(part.mimeType)) continue;

      attachments.push({
        messageId: msg.id,
        threadId: msg.threadId ?? threadId,
        partId: part.partId ?? "",
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
        messageSubject: subject,
        messageDate: date,
        messageFrom: from,
      });
    }
  }

  return { ok: true, attachments };
}

/**
 * Download an attachment by its Gmail (messageId, attachmentId) pair.
 * Returns the raw bytes as a Buffer — caller decodes / processes.
 */
export async function downloadSharedInboxAttachment(
  mailbox: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const token = await getReadonlyToken(mailbox);
  if (!token) return null;

  const url = `${GMAIL_API_BASE}/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments/${attachmentId}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    console.warn(`[gmail-shared-inbox] attachment download failed (HTTP ${resp.status})`);
    return null;
  }
  const body = (await resp.json()) as { data?: string; size?: number };
  if (!body.data) return null;
  // Gmail returns base64url-encoded payload
  return Buffer.from(body.data, "base64url");
}

/** Recursively walk a MIME tree, yielding every leaf part. */
function* walkMimeParts(part: GmailMessagePart): Generator<GmailMessagePart> {
  yield part;
  if (part.parts) {
    for (const child of part.parts) {
      yield* walkMimeParts(child);
    }
  }
}

/**
 * Internal helper: prefer the user-stored Gmail token if present (avoids JWT
 * exchange), fall back to service-account DWD. Returns null on any failure.
 */
async function getReadonlyToken(mailbox: string): Promise<string | null> {
  try {
    const { getStoredSharedInboxToken } = await import("@/lib/shared-inbox-token");
    const stored = await getStoredSharedInboxToken(mailbox);
    if (stored) return stored;
  } catch {
    // fall through to service account
  }
  const sa = await getReadonlyTokenVerbose(mailbox);
  return sa.ok ? sa.token : null;
}
