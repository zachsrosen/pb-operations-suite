"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ActivityTabData } from "@/lib/property-hub";
import type { Engagement } from "@/components/deal-detail/types";

interface Props {
  propertyId: string;
}

const TYPE_ICONS: Record<string, string> = {
  email: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  call: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  note: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  meeting: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  task: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
};

const TYPE_COLORS: Record<string, string> = {
  email: "text-blue-400",
  call: "text-green-400",
  note: "text-yellow-400",
  meeting: "text-purple-400",
  task: "text-orange-400",
};

const TYPE_FILTERS: Engagement["type"][] = [
  "email",
  "call",
  "note",
  "meeting",
  "task",
];

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

export default function PropertyActivityTab({ propertyId }: Props) {
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState<Engagement["type"] | "all">(
    "all",
  );
  const limit = 25;

  const { data, isLoading, error } = useQuery<ActivityTabData>({
    queryKey: queryKeys.propertyHub.tab(propertyId, `activity-${offset}-${typeFilter}`),
    queryFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/hub?tab=activity&offset=${offset}&limit=${limit}`,
      );
      if (!res.ok) throw new Error("Failed to load activity");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-red-400">
        Failed to load activity timeline.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 p-4 rounded-xl bg-surface border border-t-border">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const engagements = data?.engagements ?? [];
  const filtered =
    typeFilter === "all"
      ? engagements
      : engagements.filter((e) => e.type === typeFilter);

  return (
    <div className="space-y-4">
      {/* Type filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            typeFilter === "all"
              ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
              : "bg-surface border-t-border text-muted hover:text-foreground"
          }`}
        >
          All ({data?.total ?? 0})
        </button>
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors capitalize ${
              typeFilter === t
                ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                : "bg-surface border-t-border text-muted hover:text-foreground"
            }`}
          >
            {t}s
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((eng) => (
            <div
              key={eng.id}
              className="flex gap-4 p-4 rounded-xl bg-surface border border-t-border hover:border-blue-500/20 transition-colors"
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-surface-2 ${TYPE_COLORS[eng.type] ?? "text-muted"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={TYPE_ICONS[eng.type] ?? TYPE_ICONS.note}
                  />
                </svg>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted">
                      {eng.type}
                    </span>
                    {eng.subject && (
                      <p className="text-sm font-medium text-foreground truncate mt-0.5">
                        {eng.subject}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted whitespace-nowrap shrink-0">
                    {timeAgo(eng.timestamp)}
                  </span>
                </div>

                {eng.body && (
                  <p className="text-xs text-muted mt-1 line-clamp-2">
                    {stripHtml(eng.body)}
                  </p>
                )}

                {eng.from && (
                  <p className="text-xs text-muted mt-1">
                    From: {eng.from}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-between pt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 text-sm rounded-lg bg-surface border border-t-border text-foreground hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-muted">
            {offset + 1}&ndash;{Math.min(offset + limit, data.total)} of{" "}
            {data.total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={!data.hasMore}
            className="px-3 py-1.5 text-sm rounded-lg bg-surface border border-t-border text-foreground hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
