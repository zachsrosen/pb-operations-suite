import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";
import { checkGmailChanges, fetchGmailPage } from "@/lib/comms-gmail";
import { fetchChatMessages, CommsChatMessage } from "@/lib/comms-chat";
import { categorizeMessages, CategorizedMessage } from "@/lib/comms-categorize";

type UnifiedMessage = CategorizedMessage | (CommsChatMessage & { category: "general" });

export async function GET(req: NextRequest) {
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

  const params = req.nextUrl.searchParams;
  const source = params.get("source") || "all"; // all | gmail | chat | hubspot
  const page = params.get("page") || undefined;
  const query = params.get("q") || undefined;
  // Client signals it already has a cached snapshot — only then is it safe to
  // return { unchanged: true } instead of a full payload.
  const clientHasCache = params.get("hasCache") === "1";

  // Read user state for no-change fast path
  const state = await prisma.commsUserState.findUnique({
    where: { userId: user.id },
  });

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";
  const includeGmail = source === "all" || source === "gmail" || source === "hubspot";
  const includeChat = source === "all" || source === "chat";

  // --- Gmail ---
  let gmailMessages: CategorizedMessage[] = [];
  let gmailNextPage: string | undefined;
  let gmailUnchanged = false;

  if (includeGmail) {
    // No-change fast path — only when client has a snapshot to fall back on
    if (clientHasCache && state?.gmailHistoryId && !page && !query) {
      const changes = await checkGmailChanges(user.id, state.gmailHistoryId);
      if ("disconnected" in changes && changes.disconnected) {
        return NextResponse.json({ disconnected: true });
      }
      if (!changes.changed) {
        gmailUnchanged = true;
      }
    }

    if (!gmailUnchanged) {
      const gmailResult = await fetchGmailPage(user.id, {
        pageToken: page,
        query: query ? `in:inbox ${query}` : "in:inbox",
      });

      if ("disconnected" in gmailResult) {
        return NextResponse.json({ disconnected: true });
      }
      if ("error" in gmailResult) {
        return NextResponse.json({ error: gmailResult.error }, { status: 502 });
      }

      gmailMessages = categorizeMessages(gmailResult.data.messages, portalId);
      gmailNextPage = gmailResult.data.nextPageToken;

      // Update historyId
      if (gmailResult.data.historyId) {
        await prisma.commsUserState.upsert({
          where: { userId: user.id },
          create: { userId: user.id, gmailHistoryId: gmailResult.data.historyId },
          update: { gmailHistoryId: gmailResult.data.historyId },
        });
      }
    }
  }

  // --- Chat (fetched independently of Gmail unchanged flag) ---
  let chatMessages: CommsChatMessage[] = [];
  let chatSpaceCount = 0;

  if (includeChat) {
    const chatResult = await fetchChatMessages(user.id, {
      chatLastSyncAt: state?.chatLastSyncAt,
    });

    if ("data" in chatResult && chatResult.data) {
      chatMessages = chatResult.data.messages;
      chatSpaceCount = chatResult.data.spaceCount;

      if (chatResult.data.latestActivityTime) {
        await prisma.commsUserState.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            chatLastSyncAt: chatResult.data.latestActivityTime,
          },
          update: {
            chatLastSyncAt: chatResult.data.latestActivityTime,
          },
        });
      }
    }
    // Chat errors are non-fatal — just skip Chat messages
  }

  // All active sources report no changes — signal client to keep previous data.
  // Only safe because clientHasCache is required for gmailUnchanged to be true.
  const chatUnchanged = includeChat && chatMessages.length === 0;
  const allUnchanged = includeGmail
    ? gmailUnchanged && (!includeChat || chatUnchanged)
    : clientHasCache && chatUnchanged;
  if (allUnchanged) {
    return NextResponse.json({ unchanged: true });
  }

  // --- Merge & filter ---
  // Filter by source if requested
  let filtered: CategorizedMessage[] = gmailMessages;
  if (source === "hubspot") {
    filtered = gmailMessages.filter((m) => m.source === "hubspot");
  }

  // Interleave Gmail + Chat by timestamp
  const unified: UnifiedMessage[] = [
    ...filtered,
    ...chatMessages.map((c) => ({ ...c, category: "general" as const })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Compute rich analytics for KPI cards
  const unreadGmail = gmailMessages.filter(
    (m) => m.isUnread && m.source === "gmail"
  ).length;
  const unreadHubspot = gmailMessages.filter(
    (m) => m.isUnread && m.source === "hubspot"
  ).length;
  // Chat messages don't have isUnread — treat all as unread for now
  const unreadChat = chatMessages.length;
  const unreadCount = unreadGmail + unreadHubspot + unreadChat;

  // Category breakdowns (from HubSpot categorization)
  const mentionCount = gmailMessages.filter(
    (m) => m.isUnread && (m as CategorizedMessage).category === "mention"
  ).length;
  const taskCount = gmailMessages.filter(
    (m) => m.isUnread && (m as CategorizedMessage).category === "task"
  ).length;
  const commentCount = gmailMessages.filter(
    (m) => m.isUnread && (m as CategorizedMessage).category === "comment"
  ).length;
  const stageChangeCount = gmailMessages.filter(
    (m) => m.isUnread && (m as CategorizedMessage).category === "stage_change"
  ).length;
  const starredCount = gmailMessages.filter((m) => m.isStarred).length;

  // Top senders (unread only, like reference app)
  const senderCounts = new Map<string, number>();
  for (const m of gmailMessages) {
    if (m.isUnread) {
      senderCounts.set(m.fromEmail || "unknown", (senderCounts.get(m.fromEmail || "unknown") || 0) + 1);
    }
  }
  for (const c of chatMessages) {
    senderCounts.set(c.senderEmail || "unknown", (senderCounts.get(c.senderEmail || "unknown") || 0) + 1);
  }
  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([email, count]) => ({ email, count }));

  // Source distribution (for chart data)
  const sourceDistribution = {
    gmail: gmailMessages.filter((m) => m.source === "gmail").length,
    hubspot: gmailMessages.filter((m) => m.source === "hubspot").length,
    chat: chatMessages.length,
  };

  // Recent incoming (last 15 minutes)
  const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
  const recentMessages = unified
    .filter((m) => new Date(m.date).getTime() > fifteenMinAgo)
    .slice(0, 10);

  return NextResponse.json({
    messages: unified,
    analytics: {
      unreadCount,
      unreadGmail,
      unreadHubspot,
      unreadChat,
      mentionCount,
      taskCount,
      commentCount,
      stageChangeCount,
      starredCount,
      totalMessages: unified.length,
      topSenders,
      chatSpaceCount,
      sourceDistribution,
    },
    recentMessages,
    pagination: {
      gmailNextPage: gmailNextPage || null,
    },
    lastUpdated: new Date().toISOString(),
  });
}
