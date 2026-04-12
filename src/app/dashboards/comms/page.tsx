"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import CommsConnectBanner from "@/components/comms/CommsConnectBanner";
import CommsFilterSidebar from "@/components/comms/CommsFilterSidebar";
import CommsMessageCard from "@/components/comms/CommsMessageCard";
import CommsDraftDrawer from "@/components/comms/CommsDraftDrawer";
import { queryKeys } from "@/lib/query-keys";

export default function CommsPage() {
  const queryClient = useQueryClient();
  const [source, setSource] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gmailPage, setGmailPage] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerKey, setDrawerKey] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [replyTarget, setReplyTarget] = useState<any>(null);

  // Check connection status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: queryKeys.comms.status(),
    queryFn: () => fetch("/api/comms/status").then((r) => r.json()),
    staleTime: 60_000,
  });

  // Fetch messages — tell the server whether we have cached data so it can
  // safely return { unchanged: true } on idle polls without blanking first loads.
  const messagesQueryKey = queryKeys.comms.messages({ source, q: searchQuery, page: gmailPage || "" });
  const { data, isLoading } = useQuery({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const prev = queryClient.getQueryData(messagesQueryKey);
      const params = new URLSearchParams({ source });
      if (searchQuery) params.set("q", searchQuery);
      if (gmailPage) params.set("page", gmailPage);
      // Signal to server that we have a local snapshot it can rely on
      if (prev) params.set("hasCache", "1");
      const json = await fetch(`/api/comms/messages?${params}`).then((r) => r.json());
      if (json.unchanged) {
        // Server confirmed nothing changed — keep previous data
        return prev ?? json;
      }
      return json;
    },
    enabled: status?.connected === true,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const handleReply = useCallback((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = data?.messages?.find((m: any) => m.id === id);
    if (msg) {
      setReplyTarget({
        from: msg.fromEmail || msg.senderEmail || msg.from || msg.sender,
        subject: msg.subject || "",
        snippet: msg.snippet || msg.text || "",
        threadId: msg.threadId,
        messageId: msg.id,
      });
      setDrawerKey((k) => k + 1); // Reset drawer state on new reply
      setDrawerOpen(true);
    }
  }, [data]);

  const handleAiDraft = useCallback((id: string) => {
    handleReply(id); // Open drawer, then user clicks AI Draft inside
  }, [handleReply]);

  const handleNewDraft = useCallback(() => {
    setReplyTarget(null);
    setDrawerKey((k) => k + 1); // Reset drawer state
    setDrawerOpen(true);
  }, []);

  // Handle bulk actions — invalidate messages query after mutation
  async function handleMarkRead(id: string) {
    await fetch("/api/comms/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", messageIds: [id] }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.comms.root });
  }

  async function handleStar(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = data?.messages?.find((m: any) => m.id === id);
    const action = msg?.isStarred ? "unstar" : "star";
    await fetch("/api/comms/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, messageIds: [id] }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.comms.root });
  }

  if (statusLoading) {
    return (
      <DashboardShell title="Comms" accentColor="cyan">
        <div className="flex items-center justify-center py-20 text-muted">
          Loading...
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="Comms"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      {/* Not connected or impersonating */}
      {(!status?.connected || status?.impersonating) && (
        <CommsConnectBanner impersonating={status?.impersonating} />
      )}

      {/* Connected — show inbox */}
      {status?.connected && !status?.impersonating && (
        <div className="flex gap-6">
          <CommsFilterSidebar
            source={source}
            onSourceChange={setSource}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            analytics={data?.analytics}
          />

          <div className="min-w-0 flex-1 space-y-1.5">
            {/* Header with new draft button */}
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted/60">
                  {data?.analytics?.totalMessages ?? 0} messages
                </span>
                {(data?.analytics?.unreadCount ?? 0) > 0 && (
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/20">
                    {data.analytics.unreadCount} unread
                  </span>
                )}
              </div>
              <button
                onClick={handleNewDraft}
                className="rounded-lg bg-cyan-600/90 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 transition-colors shadow-sm"
              >
                + New Draft
              </button>
            </div>

            {/* Messages */}
            {isLoading && (
              <div className="py-8 text-center text-muted">
                Fetching messages...
              </div>
            )}

            {!isLoading && (!data?.messages || data.messages.length === 0) && (
              <div className="py-8 text-center text-sm text-muted">
                No messages to display.
              </div>
            )}

            {data?.disconnected && <CommsConnectBanner />}

            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data?.messages?.map((msg: any) => (
              <CommsMessageCard
                key={msg.id}
                id={msg.id}
                source={msg.source}
                from={msg.from || msg.sender || ""}
                subject={msg.subject}
                text={msg.text}
                snippet={msg.snippet}
                date={msg.date}
                isUnread={msg.isUnread}
                isStarred={msg.isStarred}
                hubspotDealUrl={msg.hubspotDealUrl}
                category={msg.category}
                spaceName={msg.spaceName}
                onReply={msg.source !== "chat" ? handleReply : undefined}
                onAiDraft={msg.source !== "chat" ? handleAiDraft : undefined}
                onMarkRead={msg.source !== "chat" ? handleMarkRead : undefined}
                onStar={msg.source !== "chat" ? handleStar : undefined}
              />
            ))}

            {/* Load more */}
            {data?.pagination?.gmailNextPage && (
              <div className="py-4 text-center">
                <button
                  onClick={() => setGmailPage(data.pagination.gmailNextPage)}
                  className="text-sm text-cyan-400 hover:text-cyan-300"
                >
                  Load more messages
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Draft drawer — key resets form state on new reply */}
      <CommsDraftDrawer
        key={drawerKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        replyTo={replyTarget}
      />
    </DashboardShell>
  );
}
