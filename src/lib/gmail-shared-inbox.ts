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

async function getReadonlyToken(impersonateEmail: string): Promise<string | null> {
  const cached = tokenCache.get(impersonateEmail);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = parseServiceAccountPrivateKey(
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
  if (!serviceAccountEmail || !privateKey) return null;

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
  if (!tokenResp.ok) return null;
  const body = (await tokenResp.json()) as { access_token?: string };
  if (!body.access_token) return null;

  tokenCache.set(impersonateEmail, {
    token: body.access_token,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Thread fetch
// ---------------------------------------------------------------------------

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string };
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
 * Build a Gmail search query that matches threads mentioning either the
 * AHJ email address OR the site address. Gmail's search DSL is forgiving
 * with quoted phrases and from:/to: operators.
 */
export function buildGmailThreadQuery(opts: {
  ahjEmail?: string | null;
  address?: string | null;
  lookbackDays?: number;
}): string {
  const clauses: string[] = [];
  if (opts.ahjEmail) {
    clauses.push(`(from:${opts.ahjEmail} OR to:${opts.ahjEmail})`);
  }
  if (opts.address) {
    // Quote the first line only — "123 Main St" is a specific enough match;
    // including city/state/zip over-constrains and misses threads where the
    // sender abbreviated.
    const firstLine = opts.address.split(",")[0].trim();
    if (firstLine) {
      // Escape quotes in the address (unlikely but safe).
      const safe = firstLine.replace(/"/g, '\\"');
      clauses.push(`"${safe}"`);
    }
  }
  if (opts.lookbackDays) {
    clauses.push(`newer_than:${opts.lookbackDays}d`);
  }
  return clauses.join(" ");
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

  const token = await getReadonlyToken(mailbox);
  if (!token) return [];

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
    if (!listResp.ok) return [];
    const listBody = (await listResp.json()) as GmailThreadList;
    const threadIds = (listBody.threads ?? []).map((t) => t.id);
    if (threadIds.length === 0) return [];

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
