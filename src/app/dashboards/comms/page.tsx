"use client";

import { Suspense, useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import CommsConnectBanner from "@/components/comms/CommsConnectBanner";
import CommsKpiCards from "@/components/comms/CommsKpiCards";
import CommsAiBriefing from "@/components/comms/CommsAiBriefing";
import CommsInlineFilters from "@/components/comms/CommsInlineFilters";
import CommsIncomingFeed from "@/components/comms/CommsIncomingFeed";
import CommsBulkBar from "@/components/comms/CommsBulkBar";
import CommsMessageCard from "@/components/comms/CommsMessageCard";
import CommsDraftDrawer from "@/components/comms/CommsDraftDrawer";
import CommsProjectView from "@/components/comms/CommsProjectView";
import { queryKeys } from "@/lib/query-keys";

export default function CommsPage() {
  return (
    <Suspense>
      <CommsPageInner />
    </Suspense>
  );
}

function CommsPageInner() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // Show email mismatch error from OAuth callback
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "email_mismatch") {
      const expected = searchParams.get("expected") || "your PB account";
      const got = searchParams.get("got") || "a different account";
      setConnectError(
        `Gmail connection rejected — you signed in as ${got} but your PB account is ${expected}. Please reconnect with the correct Google account.`
      );
    }
  }, [searchParams]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [sourcesEnabled, setSourcesEnabled] = useState<Record<string, boolean>>({
    gmail: true,
    hubspot: true,
    chat: true,
  });
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [sortBy, setSortBy] = useState<"date" | "sender">("date");
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"inbox" | "project">("inbox");

  // Pagination
  const [gmailPage, setGmailPage] = useState<string | undefined>();

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Draft drawer
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

  // Fetch messages
  const messagesQueryKey = queryKeys.comms.messages({ q: searchQuery, page: gmailPage || "" });
  const { data, isLoading } = useQuery({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const prev = queryClient.getQueryData(messagesQueryKey);
      const params = new URLSearchParams({ source: "all" });
      if (searchQuery) params.set("q", searchQuery);
      if (gmailPage) params.set("page", gmailPage);
      if (prev) params.set("hasCache", "1");
      const json = await fetch(`/api/comms/messages?${params}`).then((r) => r.json());
      if (json.unchanged) return prev ?? json;
      return json;
    },
    enabled: status?.connected === true,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Apply client-side filters to messages
  const filteredMessages = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msgs: any[] = data?.messages || [];

    // Source filter
    msgs = msgs.filter((m: { source: string }) => sourcesEnabled[m.source] !== false);

    // Read status filter
    if (readFilter === "unread") msgs = msgs.filter((m: { isUnread: boolean }) => m.isUnread);
    if (readFilter === "read") msgs = msgs.filter((m: { isUnread: boolean }) => !m.isUnread);

    // KPI filter
    if (kpiFilter) {
      switch (kpiFilter) {
        case "gmail":
          msgs = msgs.filter((m: { source: string; isUnread: boolean }) => m.source === "gmail" && m.isUnread);
          break;
        case "hubspot":
          msgs = msgs.filter((m: { source: string; isUnread: boolean }) => m.source === "hubspot" && m.isUnread);
          break;
        case "chat":
          msgs = msgs.filter((m: { source: string; isUnread: boolean }) => m.source === "chat" && m.isUnread);
          break;
        case "starred":
          msgs = msgs.filter((m: { isStarred: boolean }) => m.isStarred);
          break;
        case "mentions":
          msgs = msgs.filter((m: { category: string; isUnread: boolean }) => m.category === "mention" && m.isUnread);
          break;
        case "tasks":
          msgs = msgs.filter((m: { category: string; isUnread: boolean }) => m.category === "task" && m.isUnread);
          break;
        case "comments":
          msgs = msgs.filter((m: { category: string; isUnread: boolean }) => m.category === "comment" && m.isUnread);
          break;
        case "stage":
          msgs = msgs.filter((m: { category: string; isUnread: boolean }) => m.category === "stage_change" && m.isUnread);
          break;
      }
    }

    // Sort
    if (sortBy === "sender") {
      msgs = [...msgs].sort((a: { from: string }, b: { from: string }) =>
        (a.from || "").localeCompare(b.from || "")
      );
    }
    // date sort is default from server

    return msgs;
  }, [data?.messages, sourcesEnabled, readFilter, sortBy, kpiFilter]);

  // Handlers
  const toggleKpiFilter = useCallback((key: string) => {
    setKpiFilter((prev) => (prev === key ? null : key));
  }, []);

  const toggleSource = useCallback((source: string) => {
    setSourcesEnabled((prev) => ({ ...prev, [source]: !prev[source] }));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSelectedIds(new Set(filteredMessages.map((m: any) => m.id)));
  }, [filteredMessages]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

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
      setDrawerKey((k) => k + 1);
      setDrawerOpen(true);
    }
  }, [data]);

  const handleAiDraft = useCallback((id: string) => {
    handleReply(id);
  }, [handleReply]);

  const handleNewDraft = useCallback(() => {
    setReplyTarget(null);
    setDrawerKey((k) => k + 1);
    setDrawerOpen(true);
  }, []);

  // Bulk + single actions
  const doBulkAction = useCallback(async (action: string, messageIds: string[]) => {
    if (messageIds.length === 0) return;
    await fetch("/api/comms/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, messageIds }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.comms.root });
    setSelectedIds(new Set());
  }, [queryClient]);

  const handleMarkRead = useCallback((id: string) => doBulkAction("mark_read", [id]), [doBulkAction]);
  const handleStar = useCallback((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = data?.messages?.find((m: any) => m.id === id);
    doBulkAction(msg?.isStarred ? "unstar" : "star", [id]);
  }, [data, doBulkAction]);
  const handleArchive = useCallback((id: string) => doBulkAction("archive", [id]), [doBulkAction]);

  const handleBulkMarkRead = useCallback(() => doBulkAction("mark_read", [...selectedIds]), [doBulkAction, selectedIds]);
  const handleBulkArchive = useCallback(() => doBulkAction("archive", [...selectedIds]), [doBulkAction, selectedIds]);
  const handleBulkStar = useCallback(() => doBulkAction("star", [...selectedIds]), [doBulkAction, selectedIds]);

  if (statusLoading) {
    return (
      <DashboardShell title="Comms" accentColor="cyan">
        <div className="flex items-center justify-center gap-2 py-20 text-muted/50">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-border/30 border-t-cyan-400" />
          <span className="text-sm">Loading...</span>
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
      {/* OAuth error banner */}
      {connectError && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{connectError}</span>
          <button
            onClick={() => setConnectError(null)}
            className="text-red-400 hover:text-red-200 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Not connected or impersonating */}
      {(!status?.connected || status?.impersonating) && (
        <CommsConnectBanner impersonating={status?.impersonating} />
      )}

      {/* Connected — full-width inbox */}
      {status?.connected && !status?.impersonating && (
        <>
          {/* AI Briefing */}
          <CommsAiBriefing analytics={data?.analytics} />

          {/* KPI Cards */}
          <CommsKpiCards
            analytics={data?.analytics}
            activeFilter={kpiFilter}
            onFilterToggle={toggleKpiFilter}
          />

          {/* Incoming Feed + Top Senders */}
          <CommsIncomingFeed
            messages={data?.recentMessages || []}
            topSenders={data?.analytics?.topSenders || []}
          />

          {/* Header bar with view toggle + counts + new draft */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              {/* View toggle tabs */}
              <div className="flex items-center gap-0.5 rounded-lg bg-surface-2/30 p-0.5">
                <button
                  onClick={() => setViewMode("inbox")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    viewMode === "inbox"
                      ? "bg-cyan-500/15 text-cyan-400 shadow-sm"
                      : "text-muted/50 hover:text-foreground/70"
                  }`}
                >
                  Inbox
                </button>
                <button
                  onClick={() => setViewMode("project")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    viewMode === "project"
                      ? "bg-emerald-500/15 text-emerald-400 shadow-sm"
                      : "text-muted/50 hover:text-foreground/70"
                  }`}
                >
                  By Project
                </button>
              </div>

              <span className="text-sm text-muted/55">
                {data?.analytics?.totalMessages ?? 0} messages
              </span>
              {(data?.analytics?.unreadCount ?? 0) > 0 && (
                <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-medium text-cyan-400 ring-1 ring-cyan-500/20">
                  {data.analytics.unreadCount} unread
                </span>
              )}
              {kpiFilter && (
                <span className="text-xs text-muted/40">
                  Showing {filteredMessages.length} filtered
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

          {/* Inline Filters (shown for inbox view) */}
          {viewMode === "inbox" && (
            <CommsInlineFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              sourcesEnabled={sourcesEnabled}
              onSourceToggle={toggleSource}
              readFilter={readFilter}
              onReadFilterChange={setReadFilter}
              sortBy={sortBy}
              onSortChange={setSortBy}
              activeKpiFilter={kpiFilter}
              onClearKpiFilter={() => setKpiFilter(null)}
            />
          )}

          {/* Project view */}
          {viewMode === "project" && (
            <CommsProjectView
              messages={data?.messages || []}
              projectMap={data?.projectMap}
              onFilterByProject={(projId) => {
                setSearchQuery(projId);
                setViewMode("inbox");
              }}
            />
          )}

          {/* Inbox view — bulk bar + message list */}
          {viewMode === "inbox" && (
            <>
          {/* Bulk action bar */}
          <CommsBulkBar
            selectedCount={selectedIds.size}
            totalCount={filteredMessages.length}
            onMarkRead={handleBulkMarkRead}
            onArchive={handleBulkArchive}
            onStar={handleBulkStar}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />

          {/* Message list */}
          <div className="rounded-xl border border-t-border/15 bg-surface/30 overflow-hidden shadow-card">
            {/* Count bar */}
            <div className="border-b border-t-border/10 px-4 py-1.5 flex items-center justify-between">
              <div className="text-[11px] text-muted/35">
                Showing {filteredMessages.length} of {data?.analytics?.totalMessages ?? 0}
              </div>
              {selectedIds.size === 0 && filteredMessages.length > 0 && (
                <button
                  onClick={selectAll}
                  className="text-[11px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
                >
                  Select all
                </button>
              )}
            </div>

            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted/50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-border/30 border-t-cyan-400" />
                <span className="text-sm">Fetching messages...</span>
              </div>
            )}

            {!isLoading && filteredMessages.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-sm text-muted/50">No messages to display.</p>
                <p className="mt-1 text-xs text-muted/30">
                  {kpiFilter
                    ? "Try clearing the active filter."
                    : "Try adjusting your filters or search query."}
                </p>
                {kpiFilter && (
                  <button
                    onClick={() => setKpiFilter(null)}
                    className="mt-3 rounded-lg border border-t-border/30 px-3 py-1.5 text-xs text-muted/50 hover:text-foreground hover:border-cyan-500/30 transition-colors"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}

            {data?.disconnected && <CommsConnectBanner />}

            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {filteredMessages.map((msg: any) => (
              <CommsMessageCard
                key={msg.id}
                id={msg.id}
                source={msg.source}
                from={msg.from || msg.sender || ""}
                fromEmail={msg.fromEmail || msg.senderEmail}
                subject={msg.subject}
                text={msg.text}
                snippet={msg.snippet}
                date={msg.date}
                isUnread={msg.isUnread}
                isStarred={msg.isStarred}
                hubspotDealUrl={msg.hubspotDealUrl}
                category={msg.category}
                spaceName={msg.spaceName}
                threadId={msg.threadId}
                to={msg.to}
                isSelected={selectedIds.has(msg.id)}
                onSelect={toggleSelect}
                onReply={msg.source !== "chat" ? handleReply : undefined}
                onAiDraft={msg.source !== "chat" ? handleAiDraft : undefined}
                onMarkRead={msg.source !== "chat" ? handleMarkRead : undefined}
                onStar={msg.source !== "chat" ? handleStar : undefined}
                onArchive={msg.source !== "chat" ? handleArchive : undefined}
              />
            ))}

            {/* Load more */}
            {data?.pagination?.gmailNextPage && (
              <div className="border-t border-t-border/10 py-3 text-center">
                <button
                  onClick={() => setGmailPage(data.pagination.gmailNextPage)}
                  className="text-sm text-cyan-400/70 hover:text-cyan-300 transition-colors"
                >
                  Load more messages
                </button>
              </div>
            )}
          </div>
            </>
          )}
        </>
      )}

      {/* Draft drawer */}
      <CommsDraftDrawer
        key={drawerKey}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        replyTo={replyTarget}
      />
    </DashboardShell>
  );
}
