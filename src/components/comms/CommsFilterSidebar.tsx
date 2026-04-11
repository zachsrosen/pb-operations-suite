"use client";

import { MiniStat } from "@/components/ui/MetricCard";

interface Props {
  source: string;
  onSourceChange: (source: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  analytics?: {
    unreadCount: number;
    totalMessages: number;
    topSenders: Array<{ email: string; count: number }>;
    chatSpaceCount: number;
  };
}

const SOURCES = [
  { value: "all", label: "All" },
  { value: "gmail", label: "Gmail" },
  { value: "chat", label: "Chat" },
  { value: "hubspot", label: "HubSpot" },
];

export default function CommsFilterSidebar({
  source,
  onSourceChange,
  searchQuery,
  onSearchChange,
  analytics,
}: Props) {
  return (
    <div className="w-56 shrink-0 space-y-4">
      {/* Source tabs */}
      <div className="space-y-1">
        <div className="text-xs font-medium uppercase text-muted">Source</div>
        {SOURCES.map((s) => (
          <button
            key={s.value}
            onClick={() => onSourceChange(s.value)}
            className={`block w-full rounded px-3 py-1.5 text-left text-sm transition-colors ${
              source === s.value
                ? "bg-cyan-600/20 text-cyan-400 font-medium"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-cyan-500 focus:outline-none"
        />
      </div>

      {/* Focus analytics */}
      {analytics && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted">Focus</div>
          <MiniStat
            key={String(analytics.unreadCount)}
            label="Unread"
            value={analytics.unreadCount}
          />
          <MiniStat
            key={String(analytics.totalMessages)}
            label="Messages"
            value={analytics.totalMessages}
          />
          <MiniStat
            key={String(analytics.chatSpaceCount)}
            label="Chat Spaces"
            value={analytics.chatSpaceCount}
          />

          {analytics.topSenders.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-muted">Top Senders</div>
              {analytics.topSenders.slice(0, 3).map((s) => (
                <div
                  key={s.email}
                  className="flex items-center justify-between py-0.5 text-xs"
                >
                  <span className="truncate text-foreground">{s.email}</span>
                  <span className="ml-1 text-muted">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
