/**
 * Gmail REST API helpers for the Comms dashboard.
 *
 * Uses raw fetch (no googleapis SDK) matching google-calendar.ts pattern.
 * Every call resolves a valid access token via getValidCommsAccessToken().
 */

import { getValidCommsAccessToken } from "./comms-token";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailApiOptions {
  userId: string;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

export type CommsMessage = {
  id: string;
  threadId: string;
  source: "gmail" | "hubspot";
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
  hubspotDealId?: string;
  hubspotDealUrl?: string;
};

type GmailResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

async function gmailFetch<T>(opts: GmailApiOptions): Promise<GmailResult<T>> {
  const tokenResult = await getValidCommsAccessToken(opts.userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const url = new URL(`${GMAIL_BASE}${opts.path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      // Gmail API expects metadataHeaders as repeated params, not comma-separated
      if (k === "metadataHeaders" && v.includes(",")) {
        for (const header of v.split(",")) {
          url.searchParams.append(k, header.trim());
        }
      } else {
        url.searchParams.set(k, v);
      }
    }
  }

  const resp = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  if (resp.status === 401) {
    // Retry once with fresh token (access token may have just expired)
    const retryToken = await getValidCommsAccessToken(opts.userId);
    if ("disconnected" in retryToken) return { disconnected: true };

    const retryResp = await fetch(url.toString(), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${retryToken.accessToken}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (!retryResp.ok) {
      return { error: `Gmail API ${retryResp.status}` };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Gmail API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

/** Check if inbox has changed since last historyId. Returns null if no changes. */
export async function checkGmailChanges(
  userId: string,
  historyId: string
): Promise<{ changed: boolean; newHistoryId?: string; disconnected?: true }> {
  if (!historyId) return { changed: true };

  const result = await gmailFetch<{ history?: unknown[]; historyId: string }>({
    userId,
    path: "/history",
    params: { startHistoryId: historyId, maxResults: "1" },
  });

  if ("disconnected" in result && result.disconnected) return { changed: false, disconnected: true };
  if ("error" in result && result.error) {
    // 404 = historyId expired, treat as changed
    if (result.error.includes("404")) return { changed: true };
    return { changed: true }; // fail open — fetch anyway
  }

  const data = result.data!;
  const hasChanges = (data.history?.length ?? 0) > 0;
  return {
    changed: hasChanges,
    newHistoryId: data.historyId,
  };
}

function extractHeader(
  headers: Array<{ name: string; value: string }>,
  name: string
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractEmailAddress(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return match ? match[1] : header;
}

function parseGmailMessage(msg: Record<string, any>): CommsMessage {
  const headers: Array<{ name: string; value: string }> =
    msg.payload?.headers || [];
  const from = extractHeader(headers, "From");
  const fromEmail = extractEmailAddress(from);
  const labelIds: string[] = msg.labelIds || [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    source: "gmail", // categorize() upgrades to "hubspot" later
    from,
    fromEmail,
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    snippet: msg.snippet || "",
    date: extractHeader(headers, "Date") ||
      (msg.internalDate
        ? new Date(parseInt(msg.internalDate)).toISOString()
        : new Date().toISOString()),
    isUnread: labelIds.includes("UNREAD"),
    isStarred: labelIds.includes("STARRED"),
    labelIds,
  };
}

/** Fetch a full page of Gmail messages. */
export async function fetchGmailPage(
  userId: string,
  options: {
    pageToken?: string;
    maxResults?: number;
    query?: string;
  } = {}
): Promise<GmailResult<{
  messages: CommsMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
  historyId: string;
}>> {
  const maxResults = options.maxResults || 200;
  const params: Record<string, string> = {
    maxResults: String(maxResults),
    q: options.query || "in:inbox",
  };
  if (options.pageToken) params.pageToken = options.pageToken;

  // Step 1: Get message IDs
  const listResult = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>({ userId, path: "/messages", params });

  if ("disconnected" in listResult && listResult.disconnected) return { disconnected: true };
  if ("error" in listResult && listResult.error) return { error: listResult.error };

  const listData = listResult.data!;
  const ids = listData.messages || [];
  if (ids.length === 0) {
    // Get current historyId from profile
    const profile = await gmailFetch<{ historyId: string }>({
      userId,
      path: "/profile",
    });
    return {
      data: {
        messages: [],
        nextPageToken: listData.nextPageToken,
        resultSizeEstimate: 0,
        historyId: ("data" in profile && profile.data) ? profile.data.historyId : "",
      },
    };
  }

  // Step 2: Batch-fetch message details (larger batches for speed)
  const batchSize = 50;
  const messages: CommsMessage[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((m) =>
        gmailFetch<Record<string, any>>({
          userId,
          path: `/messages/${m.id}`,
          params: { format: "metadata", metadataHeaders: "From,To,Subject,Date" },
        })
      )
    );
    for (const r of batchResults) {
      if ("data" in r && r.data) messages.push(parseGmailMessage(r.data));
    }
  }

  // Get historyId from profile
  const profile = await gmailFetch<{ historyId: string }>({
    userId,
    path: "/profile",
  });

  return {
    data: {
      messages,
      nextPageToken: listData.nextPageToken,
      resultSizeEstimate: listData.resultSizeEstimate || messages.length,
      historyId: ("data" in profile && profile.data) ? profile.data.historyId : "",
    },
  };
}
