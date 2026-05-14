"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Engagement } from "@/components/deal-detail/types";

interface PropertyTimelineResponse {
  engagements: Engagement[];
  total: number;
  hasMore: boolean;
}

const TYPE_ICONS: Record<string, string> = {
  note: "\u{1F4DD}",
  email: "\u{1F4E7}",
  call: "\u{1F4DE}",
  meeting: "\u{1F4C5}",
  task: "\u{2705}",
};

function ageLabel(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

function engagementSummary(e: Engagement): string {
  if (e.type === "email") {
    const direction =
      e.from && e.from.includes("@photonbrothers.com") ? "Sent" : "Received";
    return `[${direction}] ${e.subject ?? "No subject"}`;
  }
  if (e.type === "call") {
    const durationStr = e.duration
      ? ` (${Math.round(e.duration / 1000)}s)`
      : "";
    return (e.body ?? "Call") + durationStr;
  }
  if (e.type === "meeting") return e.subject ?? e.body ?? "Meeting";
  if (e.type === "task") return e.subject ?? e.body ?? "Task";
  return e.body ?? "";
}

const PAGE_SIZE = 25;

interface Props {
  hubspotObjectId: string;
}

export default function PropertyActivityTimeline({ hubspotObjectId }: Props) {
  const [offset, setOffset] = useState(0);
  const [accumulated, setAccumulated] = useState<Engagement[]>([]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [...queryKeys.propertyTimeline.events(hubspotObjectId), offset],
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${hubspotObjectId}/timeline?offset=${offset}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PropertyTimelineResponse;
    },
    staleTime: 60_000,
  });

  const loadMore = useCallback(() => {
    if (!data) return;
    setAccumulated((prev) => [...prev, ...data.engagements]);
    setOffset((prev) => prev + PAGE_SIZE);
  }, [data]);

  const isFirstPage = offset === 0;
  const engagements = isFirstPage
    ? data?.engagements ?? []
    : [...accumulated, ...(data?.engagements ?? [])];
  const hasMore = data?.hasMore ?? false;
  const total = data?.total ?? 0;

  if (isLoading && isFirstPage) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-border border-t-cyan-500" />
        Loading activity...
      </div>
    );
  }

  if (engagements.length === 0 && !isFetching) {
    return <div className="text-sm text-muted py-1">No activity yet.</div>;
  }

  return (
    <div>
      <div className="space-y-3 max-h-80 overflow-y-auto">
        {engagements.map((e) => {
          const body = engagementSummary(e);
          return (
            <div key={e.id} className="border-l-2 border-t-border pl-3">
              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <span>{TYPE_ICONS[e.type] ?? "\u{2022}"}</span>
                <span className="capitalize font-medium">{e.type}</span>
                <span className="opacity-40">&middot;</span>
                <span>{ageLabel(e.timestamp)}</span>
              </div>
              <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap">
                {body.replace(/<[^>]*>/g, "")}
              </p>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={isFetching}
          className="mt-3 text-xs text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-50"
        >
          {isFetching
            ? "Loading..."
            : `Show more (${engagements.length} of ${total})`}
        </button>
      )}
    </div>
  );
}
