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
  let unchanged = false;

  if (includeGmail) {
    // No-change fast path
    if (state?.gmailHistoryId && !page && !query) {
      const changes = await checkGmailChanges(user.id, state.gmailHistoryId);
      if ("disconnected" in changes && changes.disconnected) {
        return NextResponse.json({ disconnected: true });
      }
      if (!changes.changed) {
        unchanged = true;
      }
    }

    if (!unchanged) {
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

  // --- Chat ---
  let chatMessages: CommsChatMessage[] = [];
  let chatSpaceCount = 0;

  if (includeChat && !unchanged) {
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

  // If both Gmail unchanged and Chat returned empty (no-change fast path)
  if (unchanged && chatMessages.length === 0) {
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

  // Compute focus analytics
  const unreadCount = gmailMessages.filter((m) => m.isUnread).length;
  const senderCounts = new Map<string, number>();
  for (const m of gmailMessages) {
    senderCounts.set(m.fromEmail, (senderCounts.get(m.fromEmail) || 0) + 1);
  }
  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([email, count]) => ({ email, count }));

  return NextResponse.json({
    messages: unified,
    analytics: {
      unreadCount,
      totalMessages: unified.length,
      topSenders,
      chatSpaceCount,
    },
    pagination: {
      gmailNextPage: gmailNextPage || null,
    },
    lastUpdated: new Date().toISOString(),
  });
}
