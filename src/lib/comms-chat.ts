/**
 * Google Chat REST API helpers for the Comms dashboard.
 *
 * Bounds: max 30 spaces, 20 messages per space.
 * Returns a bounded recent window every time (no delta filter).
 * chatLastSyncAt used only for no-change fast path.
 */

import { getValidCommsAccessToken } from "./comms-token";

const CHAT_BASE = "https://chat.googleapis.com/v1";
const MAX_SPACES = 50;
const MESSAGES_PER_SPACE = 50;

export type CommsChatMessage = {
  id: string;
  spaceId: string;
  spaceName: string;
  source: "chat";
  sender: string;
  senderEmail: string;
  text: string;
  date: string; // ISO
  threadId?: string;
};

type ChatResult<T> =
  | { data: T; disconnected?: never; error?: never }
  | { disconnected: true; data?: never; error?: never }
  | { error: string; data?: never; disconnected?: never };

async function chatFetch<T>(
  userId: string,
  path: string,
  params?: Record<string, string>
): Promise<ChatResult<T>> {
  const tokenResult = await getValidCommsAccessToken(userId);
  if ("disconnected" in tokenResult) return { disconnected: true };

  const url = new URL(`${CHAT_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
  });

  if (resp.status === 401) {
    // Retry once with fresh token (consistent with gmailFetch pattern)
    const retryToken = await getValidCommsAccessToken(userId);
    if ("disconnected" in retryToken) return { disconnected: true };
    const retryResp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${retryToken.accessToken}` },
    });
    if (!retryResp.ok) {
      const text = await retryResp.text().catch(() => "");
      return { error: `Chat API ${retryResp.status}: ${text}`.trim() };
    }
    return { data: (await retryResp.json()) as T };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { error: `Chat API ${resp.status}: ${text}`.trim() };
  }

  return { data: (await resp.json()) as T };
}

interface ChatSpace {
  name: string; // "spaces/AAAA"
  displayName: string;
  lastActiveTime?: string;
}

interface ChatMessageRaw {
  name: string; // "spaces/AAAA/messages/BBBB"
  sender?: { name?: string; displayName?: string; email?: string };
  text?: string;
  createTime?: string;
  thread?: { name?: string };
}

/** Fetch bounded recent Chat messages across all spaces. */
export async function fetchChatMessages(
  userId: string,
  options: {
    chatLastSyncAt?: Date | null;
  } = {}
): Promise<ChatResult<{
  messages: CommsChatMessage[];
  latestActivityTime: Date | null;
  spaceCount: number;
}>> {
  // Step 1: List user's spaces
  const spacesResult = await chatFetch<{
    spaces?: ChatSpace[];
    nextPageToken?: string;
  }>(userId, "/spaces", { pageSize: String(MAX_SPACES) });

  if ("disconnected" in spacesResult && spacesResult.disconnected) return { disconnected: true };
  if ("error" in spacesResult && spacesResult.error) return { error: spacesResult.error };

  const spacesData = spacesResult.data!;
  const spaces = (spacesData.spaces || []).slice(0, MAX_SPACES);

  if (spaces.length === 0) {
    return { data: { messages: [], latestActivityTime: null, spaceCount: 0 } };
  }

  // No-change fast path: if all spaces have lastActiveTime <= chatLastSyncAt, skip
  if (options.chatLastSyncAt) {
    const syncTime = options.chatLastSyncAt.getTime();
    const anyNew = spaces.some((s) => {
      if (!s.lastActiveTime) return true;
      return new Date(s.lastActiveTime).getTime() > syncTime;
    });
    if (!anyNew) {
      return {
        data: {
          messages: [],
          latestActivityTime: options.chatLastSyncAt,
          spaceCount: spaces.length,
        },
      };
    }
  }

  // Step 2: Fetch latest messages per space (bounded window, no delta filter)
  const allMessages: CommsChatMessage[] = [];
  let latestTime: Date | null = null;

  // Fetch in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < spaces.length; i += batchSize) {
    const batch = spaces.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((space) =>
        chatFetch<{ messages?: ChatMessageRaw[] }>(
          userId,
          `/${space.name}/messages`,
          {
            pageSize: String(MESSAGES_PER_SPACE),
            orderBy: "createTime desc",
          }
        ).then((r) => ({ space, result: r }))
      )
    );

    for (const { space, result } of results) {
      if ("data" in result && result.data?.messages) {
        for (const msg of result.data.messages) {
          const msgDate = msg.createTime
            ? new Date(msg.createTime)
            : new Date();

          if (!latestTime || msgDate > latestTime) {
            latestTime = msgDate;
          }

          allMessages.push({
            id: msg.name || "",
            spaceId: space.name,
            spaceName: space.displayName || space.name,
            source: "chat",
            sender: msg.sender?.displayName || "Unknown",
            senderEmail: msg.sender?.email || "",
            text: msg.text || "",
            date: msgDate.toISOString(),
            threadId: msg.thread?.name,
          });
        }
      }
    }
  }

  // Sort by date descending
  allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    data: {
      messages: allMessages,
      latestActivityTime: latestTime,
      spaceCount: spaces.length,
    },
  };
}
