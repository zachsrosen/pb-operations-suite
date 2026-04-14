"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import NoteComposer from "./NoteComposer";
import TimelineEventRow from "./TimelineEventRow";
import type { TimelinePage } from "./types";

interface ActivityFeedProps {
  dealId: string;
}

export default function ActivityFeed({ dealId }: ActivityFeedProps) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [pages, setPages] = useState<TimelinePage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Guard against stale query responses overwriting pages when showAll toggles.
  // The ref tracks which mode the latest query was initiated for — only responses
  // matching the current mode are allowed to write to pages state.
  const modeRef = useRef(showAll);
  modeRef.current = showAll;

  // First page query — include showAll in key so toggling refetches correctly
  const firstPageQuery = useQuery({
    queryKey: [...queryKeys.dealTimeline.events(dealId), showAll],
    queryFn: async () => {
      const modeAtStart = showAll;
      const url = `/api/deals/${dealId}/timeline${showAll ? "?all=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      const data: TimelinePage = await res.json();
      // Only write to pages if the mode hasn't changed since this fetch started
      if (modeRef.current === modeAtStart) {
        setPages([data]);
      }
      return data;
    },
    staleTime: 30_000,
  });

  // Load more pages
  const loadMore = useCallback(async () => {
    const lastPage = pages[pages.length - 1];
    if (!lastPage?.nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const modeAtStart = showAll;
      const params = new URLSearchParams();
      params.set("cursorTs", lastPage.nextCursor.ts);
      params.set("cursorId", lastPage.nextCursor.id);
      if (showAll) params.set("all", "true");

      const res = await fetch(`/api/deals/${dealId}/timeline?${params}`);
      if (res.ok && modeRef.current === modeAtStart) {
        const data: TimelinePage = await res.json();
        setPages((prev) => [...prev, data]);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false);
    }
  }, [pages, dealId, showAll, loadingMore]);

  const handleNoteCreated = useCallback(() => {
    // Refetch first page to show the new note
    queryClient.invalidateQueries({ queryKey: queryKeys.dealTimeline.events(dealId) });
  }, [queryClient, dealId]);

  const handleShowAll = useCallback(() => {
    setShowAll(true);
    setPages([]);
    // No manual invalidation needed — the query key includes showAll,
    // so React Query automatically fetches for the new key
  }, []);

  // Merge all loaded pages
  const allEvents = pages.flatMap((p) => p.events);
  const hasMore = pages[pages.length - 1]?.nextCursor != null;
  const isLoading = firstPageQuery.isLoading;

  return (
    <div className="space-y-3">
      <NoteComposer dealId={dealId} onNoteCreated={handleNoteCreated} />

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <span className="animate-spin">{"\u27F3"}</span> Loading activity...
        </div>
      )}

      {!isLoading && allEvents.length === 0 && (
        <p className="py-4 text-center text-xs text-muted">
          {showAll ? "No activity yet." : "No recent activity."}
        </p>
      )}

      {allEvents.length > 0 && (
        <div className="divide-y divide-t-border">
          {allEvents.map((event) => (
            <TimelineEventRow key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Load more / Show all */}
      <div className="flex items-center justify-center gap-3 py-2">
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        )}
        {!showAll && (
          <button
            onClick={handleShowAll}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Show all history
          </button>
        )}
      </div>
    </div>
  );
}
