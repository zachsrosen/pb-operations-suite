"use client";

import { useMemo } from "react";

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

/* ── Helpers ─────────────────────────────────────────────── */

/** Decode &amp; &lt; &#39; etc. */
function decodeEntities(html: string): string {
  if (!html) return "";
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Extract display name from "Zach Rosen <zach@photonbrothers.com>" */
function parseSender(raw: string): { name: string; email: string } {
  if (!raw) return { name: "Unknown", email: "" };
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/^["']|["']$/g, "").trim(), email: match[2] };
  if (raw.includes("@")) return { name: raw.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email: raw };
  return { name: raw, email: "" };
}

/** Deterministic hue from string for avatar color */
function nameHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

const SOURCE_CONFIG = {
  gmail: { label: "Gmail", dotColor: "#ef4444" },
  hubspot: { label: "HubSpot", dotColor: "#f97316" },
  chat: { label: "Chat", dotColor: "#22c55e" },
} as const;

/* ── Component ───────────────────────────────────────────── */

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
  const { name, email } = useMemo(() => parseSender(from), [from]);
  const initial = name.charAt(0).toUpperCase();
  const hue = useMemo(() => nameHue(email || name), [email, name]);
  const preview = decodeEntities(snippet || text || "");
  const decodedSubject = decodeEntities(subject || "");
  const srcCfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.gmail;

  const displayDate = new Date(date);
  const now = new Date();
  const isToday = displayDate.toDateString() === now.toDateString();
  const timeStr = displayDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = isToday
    ? timeStr
    : `${displayDate.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;

  return (
    <div
      className={`group relative rounded-lg border transition-all duration-200 ${
        isUnread
          ? "border-l-2 border-l-cyan-400 border-t-border/40 border-r-border/40 border-b-border/40 bg-surface"
          : "border-t-border/30 bg-surface/60 hover:bg-surface"
      }`}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        {/* Avatar */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={{
            background: `hsl(${hue}, 45%, 18%)`,
            color: `hsl(${hue}, 60%, 72%)`,
            border: `1px solid hsl(${hue}, 40%, 28%)`,
          }}
        >
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          {/* Row 1: sender + date */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`truncate text-sm ${
                  isUnread ? "font-semibold text-foreground" : "text-foreground/90"
                }`}
              >
                {name}
              </span>
              {/* Source dot */}
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: srcCfg.dotColor }}
                title={srcCfg.label}
              />
              {isUnread && (
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" title="Unread" />
              )}
            </div>
            <span className="shrink-0 text-xs text-muted/70 tabular-nums">{dateStr}</span>
          </div>

          {/* Row 2: subject */}
          {decodedSubject && (
            <div
              className={`mt-0.5 truncate text-[13px] leading-snug ${
                isUnread ? "font-medium text-foreground" : "text-foreground/75"
              }`}
            >
              {decodedSubject}
            </div>
          )}

          {/* Row 2b: chat space name */}
          {spaceName && (
            <div className="mt-0.5 text-xs text-muted/60">in {spaceName}</div>
          )}

          {/* Row 3: preview */}
          <div className="mt-0.5 truncate text-xs leading-relaxed text-muted/60">
            {preview}
          </div>

          {/* Badges */}
          {(hubspotDealUrl || (category && category !== "general") || isStarred) && (
            <div className="mt-1.5 flex items-center gap-1.5">
              {hubspotDealUrl && (
                <a
                  href={hubspotDealUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-400/80 ring-1 ring-orange-500/20 hover:bg-orange-500/20 transition-colors"
                >
                  Deal
                </a>
              )}
              {category && category !== "general" && (
                <span className="rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400/80 ring-1 ring-cyan-500/20">
                  {category.replace("_", " ")}
                </span>
              )}
              {isStarred && (
                <span className="text-amber-400/80 text-xs">&#9733;</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute right-2.5 top-2.5 hidden items-center gap-1 rounded-lg bg-surface-2/90 p-0.5 shadow-card backdrop-blur-sm group-hover:flex">
        {onReply && (
          <button
            onClick={() => onReply(id)}
            className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface transition-colors"
          >
            Reply
          </button>
        )}
        {onAiDraft && (
          <button
            onClick={() => onAiDraft(id)}
            className="rounded-md px-2 py-1 text-xs text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
          >
            AI Draft
          </button>
        )}
        {onMarkRead && isUnread && (
          <button
            onClick={() => onMarkRead(id)}
            className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface transition-colors"
          >
            Read
          </button>
        )}
        {onStar && (
          <button
            onClick={() => onStar(id)}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              isStarred
                ? "text-amber-400 hover:text-amber-300"
                : "text-muted hover:text-amber-400"
            }`}
          >
            {isStarred ? "&#9733;" : "&#9734;"}
          </button>
        )}
      </div>
    </div>
  );
}
