/**
 * Gmail draft create/update/send helpers.
 * Uses raw fetch against Gmail REST API.
 */

import { getValidCommsAccessToken } from "./comms-token";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type DraftResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

function buildRawMimeMessage(opts: {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push("");
  lines.push(opts.body);

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

// Allowlisted Gmail API actions — URL is always built from constants
type GmailAction =
  | { action: "create" }
  | { action: "update"; draftId: string }
  | { action: "send" };

function buildGmailUrl(act: GmailAction): string {
  switch (act.action) {
    case "create":
      return `${GMAIL_BASE}/drafts`;
    case "update":
      return `${GMAIL_BASE}/drafts/${encodeURIComponent(act.draftId)}`;
    case "send":
      return `${GMAIL_BASE}/drafts/send`;
  }
}

async function gmailDraftFetch<T>(
  userId: string,
  act: GmailAction,
  method: string,
  body?: Record<string, unknown>
): Promise<DraftResult<T>> {
  const url = buildGmailUrl(act);

  const tokenResult = await getValidCommsAccessToken(userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (resp.status === 401) {
    // Retry once with fresh token
    const retryToken = await getValidCommsAccessToken(userId);
    if ("disconnected" in retryToken) return { disconnected: true };
    const retryResp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${retryToken.accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!retryResp.ok) {
      const text = await retryResp.text().catch(() => "");
      return { error: `Gmail draft API ${retryResp.status}: ${text}`.trim() };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Gmail draft API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

export async function createGmailDraft(
  userId: string,
  opts: { to: string; cc?: string; subject: string; body: string; threadId?: string }
): Promise<DraftResult<{ draftId: string; messageId: string }>> {
  const raw = buildRawMimeMessage(opts);
  const result = await gmailDraftFetch<{
    id: string;
    message: { id: string };
  }>(userId, { action: "create" }, "POST", {
    message: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) },
  });

  if ("data" in result && result.data) {
    return {
      data: { draftId: result.data.id, messageId: result.data.message.id },
    };
  }
  return result as DraftResult<{ draftId: string; messageId: string }>;
}

export async function updateGmailDraft(
  userId: string,
  draftId: string,
  opts: { to: string; cc?: string; subject: string; body: string }
): Promise<DraftResult<{ draftId: string }>> {
  const raw = buildRawMimeMessage(opts);
  const result = await gmailDraftFetch<{ id: string }>(
    userId,
    { action: "update", draftId },
    "PUT",
    { message: { raw } }
  );

  if ("data" in result && result.data) return { data: { draftId: result.data.id } };
  return result as DraftResult<{ draftId: string }>;
}

export async function sendGmailDraft(
  userId: string,
  draftId: string
): Promise<DraftResult<{ messageId: string; threadId: string }>> {
  // Gmail send endpoint is POST /gmail/v1/users/me/drafts/send with { id: draftId }
  const result = await gmailDraftFetch<{ id: string; threadId: string }>(
    userId,
    { action: "send" },
    "POST",
    { id: draftId }
  );

  if ("data" in result && result.data) {
    return { data: { messageId: result.data.id, threadId: result.data.threadId } };
  }
  return result as DraftResult<{ messageId: string; threadId: string }>;
}
