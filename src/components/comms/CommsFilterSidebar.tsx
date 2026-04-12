"use client";

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
  { value: "all", label: "All", dot: null },
  { value: "gmail", label: "Gmail", dot: "#ef4444" },
  { value: "chat", label: "Chat", dot: "#22c55e" },
  { value: "hubspot", label: "HubSpot", dot: "#f97316" },
];

/** Extract readable name from email */
function emailToName(email: string): string {
  const local = email.split("@")[0];
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CommsFilterSidebar({
  source,
  onSourceChange,
  searchQuery,
  onSearchChange,
  analytics,
}: Props) {
  return (
    <div className="w-52 shrink-0 space-y-5">
      {/* Source pills */}
      <div className="space-y-0.5">
        <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/50">
          Source
        </div>
        <div className="rounded-lg bg-surface-2/40 p-1 space-y-0.5">
          {SOURCES.map((s) => {
            const isActive = source === s.value;
            return (
              <button
                key={s.value}
                onClick={() => onSourceChange(s.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-all duration-150 ${
                  isActive
                    ? "bg-cyan-500/12 text-cyan-400 font-medium shadow-sm"
                    : "text-muted/70 hover:bg-surface-2/60 hover:text-foreground/80"
                }`}
              >
                {s.dot ? (
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ background: s.dot }}
                  />
                ) : (
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current opacity-50" />
                )}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-t-border/30 bg-surface/60 pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted/40 focus:border-cyan-500/40 focus:bg-surface focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Analytics */}
      {analytics && (
        <div className="space-y-3">
          <div className="px-1 text-[10px] font-semibold uppercase tracking-widest text-muted/50">
            Overview
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg bg-surface-2/30 px-2.5 py-2 text-center">
              <div className="text-lg font-semibold text-cyan-400 tabular-nums">
                {analytics.unreadCount}
              </div>
              <div className="text-[10px] text-muted/50 uppercase tracking-wide">Unread</div>
            </div>
            <div className="rounded-lg bg-surface-2/30 px-2.5 py-2 text-center">
              <div className="text-lg font-semibold text-foreground/80 tabular-nums">
                {analytics.totalMessages}
              </div>
              <div className="text-[10px] text-muted/50 uppercase tracking-wide">Total</div>
            </div>
          </div>

          {analytics.chatSpaceCount > 0 && (
            <div className="rounded-lg bg-surface-2/30 px-2.5 py-2 flex items-center justify-between">
              <span className="text-xs text-muted/60">Chat Spaces</span>
              <span className="text-sm font-medium text-foreground/70 tabular-nums">
                {analytics.chatSpaceCount}
              </span>
            </div>
          )}

          {analytics.topSenders.length > 0 && (
            <div>
              <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/50">
                Top Senders
              </div>
              <div className="space-y-0.5">
                {analytics.topSenders.slice(0, 5).map((s) => (
                  <div
                    key={s.email}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-surface-2/30 transition-colors"
                  >
                    <span className="truncate text-foreground/70" title={s.email}>
                      {emailToName(s.email)}
                    </span>
                    <span className="ml-2 shrink-0 text-muted/50 tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
