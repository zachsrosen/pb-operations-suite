"use client";

interface CommsMessageCardProps {
  id: string;
  source: "gmail" | "hubspot" | "chat";
  from: string;
  subject?: string;
  text?: string;
  snippet?: string;
  date: string;
  isUnread?: boolean;
  isStarred?: boolean;
  hubspotDealUrl?: string;
  category?: string;
  spaceName?: string;
  onReply?: (id: string) => void;
  onAiDraft?: (id: string) => void;
  onStar?: (id: string) => void;
  onMarkRead?: (id: string) => void;
}

const SOURCE_ICONS: Record<string, string> = {
  gmail: "M",
  hubspot: "H",
  chat: "C",
};

const SOURCE_COLORS: Record<string, string> = {
  gmail: "bg-red-500/20 text-red-400",
  hubspot: "bg-orange-500/20 text-orange-400",
  chat: "bg-green-500/20 text-green-400",
};

export default function CommsMessageCard({
  id,
  source,
  from,
  subject,
  text,
  snippet,
  date,
  isUnread,
  isStarred,
  hubspotDealUrl,
  category,
  spaceName,
  onReply,
  onAiDraft,
  onStar,
  onMarkRead,
}: CommsMessageCardProps) {
  const preview = snippet || text || "";
  const displayDate = new Date(date);
  const timeStr = displayDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const dateStr = displayDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={`group relative rounded-lg border bg-surface p-3 transition-colors hover:bg-surface-2 ${
        isUnread ? "border-cyan-500/30" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Source badge */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            SOURCE_COLORS[source] || "bg-zinc-500/20 text-zinc-400"
          }`}
        >
          {SOURCE_ICONS[source] || "?"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span
              className={`truncate text-sm ${
                isUnread ? "font-semibold text-foreground" : "text-foreground"
              }`}
            >
              {from}
            </span>
            <span className="ml-2 shrink-0 text-xs text-muted">
              {dateStr} {timeStr}
            </span>
          </div>

          {subject && (
            <div className="mt-0.5 truncate text-sm text-foreground">
              {subject}
            </div>
          )}
          {spaceName && (
            <div className="mt-0.5 text-xs text-muted">in {spaceName}</div>
          )}

          <div className="mt-0.5 truncate text-xs text-muted">{preview}</div>

          {/* Badges */}
          <div className="mt-1 flex items-center gap-1.5">
            {hubspotDealUrl && (
              <a
                href={hubspotDealUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400 hover:bg-orange-500/25"
              >
                Deal
              </a>
            )}
            {category && category !== "general" && (
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
                {category.replace("_", " ")}
              </span>
            )}
            {isStarred && (
              <span className="text-yellow-400 text-xs">&#9733;</span>
            )}
          </div>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        {onReply && (
          <button
            onClick={() => onReply(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Reply
          </button>
        )}
        {onAiDraft && (
          <button
            onClick={() => onAiDraft(id)}
            className="rounded bg-cyan-600/20 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-600/30"
          >
            AI Draft
          </button>
        )}
        {onMarkRead && isUnread && (
          <button
            onClick={() => onMarkRead(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Read
          </button>
        )}
        {onStar && (
          <button
            onClick={() => onStar(id)}
            className="rounded bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            {isStarred ? "Unstar" : "Star"}
          </button>
        )}
      </div>
    </div>
  );
}
