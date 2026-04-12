"use client";

import { useState, useMemo } from "react";

interface CommsMessageCardProps {
  id: string;
  source: "gmail" | "hubspot" | "chat";
  from: string;
  fromEmail?: string;
  subject?: string;
  text?: string;
  snippet?: string;
  date: string;
  isUnread?: boolean;
  isStarred?: boolean;
  hubspotDealUrl?: string;
  category?: string;
  spaceName?: string;
  threadId?: string;
  to?: string;
  // Selection
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  // Actions
  onReply?: (id: string) => void;
  onAiDraft?: (id: string) => void;
  onStar?: (id: string) => void;
  onMarkRead?: (id: string) => void;
  onArchive?: (id: string) => void;
}

/* -- Helpers ------------------------------------------------ */

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

function parseSender(raw: string): { name: string; email: string } {
  if (!raw) return { name: "Unknown", email: "" };
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/^["']|["']$/g, "").trim(), email: match[2] };
  if (raw.includes("@")) return { name: raw.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email: raw };
  return { name: raw, email: "" };
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function nameHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
}

const SOURCE_CONFIG = {
  gmail: { label: "Gmail", color: "#ea4335", bg: "rgba(234,67,53,0.12)", border: "rgba(234,67,53,0.25)" },
  hubspot: { label: "HubSpot", color: "#ff7a59", bg: "rgba(255,122,89,0.12)", border: "rgba(255,122,89,0.25)" },
  chat: { label: "Chat", color: "#0f9d58", bg: "rgba(15,157,88,0.12)", border: "rgba(15,157,88,0.25)" },
} as const;

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  stage_change: { label: "Stage Change", color: "#059669", bg: "rgba(5,150,105,0.12)" },
  mention: { label: "@Mention", color: "#7c3aed", bg: "rgba(124,58,237,0.12)" },
  task: { label: "Task", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  comment: { label: "Comment", color: "#d97706", bg: "rgba(217,119,6,0.12)" },
};

/* -- Component ---------------------------------------------- */

export default function CommsMessageCard({
  id,
  source,
  from,
  fromEmail,
  subject,
  text,
  snippet,
  date,
  isUnread,
  isStarred,
  hubspotDealUrl,
  category,
  spaceName,
  threadId,
  to,
  isSelected,
  onSelect,
  onReply,
  onAiDraft,
  onStar,
  onMarkRead,
  onArchive,
}: CommsMessageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { name, email } = useMemo(() => parseSender(from), [from]);
  const initials = useMemo(() => getInitials(name), [name]);
  const hue = useMemo(() => nameHue(email || name), [email, name]);
  const preview = decodeEntities(snippet || text || "");
  const decodedSubject = decodeEntities(subject || "");
  const srcCfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.gmail;
  const catCfg = category && category !== "general" ? CATEGORY_CONFIG[category] : null;
  const senderEmail = fromEmail || email;

  const displayDate = new Date(date);
  const now = new Date();
  const isToday = displayDate.toDateString() === now.toDateString();
  const timeStr = displayDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = isToday
    ? timeStr
    : `${displayDate.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeStr}`;
  const fullDate = displayDate.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className={`group relative cursor-pointer border-b border-t-border/15 transition-all duration-100 ${
        isSelected ? "bg-cyan-500/5" : ""
      } ${
        isUnread
          ? "border-l-2 border-l-cyan-400 bg-surface/80"
          : "bg-transparent hover:bg-surface/30"
      } ${expanded ? "bg-surface/50" : ""}`}
    >
      {/* Main Row — 4 col: checkbox / avatar / content / time */}
      <div
        className="grid gap-3 px-3 py-2.5"
        style={{ gridTemplateColumns: "28px 36px 1fr auto" }}
      >
        {/* Checkbox */}
        <div className="flex items-start pt-0.5">
          <label
            className={`flex h-7 w-7 items-center justify-center rounded-full border cursor-pointer transition-colors ${
              isSelected
                ? "border-cyan-400 bg-cyan-500/15"
                : "border-t-border/30 bg-surface-2/30 hover:border-cyan-400/50 hover:bg-surface-2/60"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected || false}
              onChange={() => onSelect?.(id)}
              className="h-3.5 w-3.5 accent-cyan-500 cursor-pointer"
            />
          </label>
        </div>

        {/* Avatar */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            background: `hsl(${hue}, 40%, 20%)`,
            color: `hsl(${hue}, 55%, 68%)`,
            border: `1px solid hsl(${hue}, 35%, 30%)`,
          }}
        >
          {initials}
        </div>

        {/* Content */}
        <div className="min-w-0">
          {/* From row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {isUnread && (
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-cyan-400" />
            )}
            <span className={`text-[13px] ${isUnread ? "font-semibold text-foreground" : "text-foreground/75"}`}>
              {name}
            </span>
            {senderEmail && (
              <span className="text-[11px] text-muted/40">{senderEmail}</span>
            )}
            {/* Source tag */}
            <span
              className="rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
              style={{ background: srcCfg.bg, color: srcCfg.color, border: `1px solid ${srcCfg.border}` }}
            >
              {srcCfg.label}
            </span>
            {/* Category badge */}
            {catCfg && (
              <span
                className="rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
                style={{ background: catCfg.bg, color: catCfg.color }}
              >
                {catCfg.label}
              </span>
            )}
            {isStarred && <span className="text-amber-400 text-xs">&#9733;</span>}
            {!isUnread && (
              <span className="rounded bg-surface-2/50 px-1.5 py-px text-[9px] font-medium text-muted/35 uppercase tracking-wide">
                read
              </span>
            )}
          </div>

          {/* Subject */}
          {decodedSubject && (
            <div className={`mt-0.5 text-[13px] leading-snug ${
              isUnread ? "font-medium text-foreground/90" : "text-foreground/55"
            } ${expanded ? "" : "truncate"}`}>
              {decodedSubject}
            </div>
          )}

          {/* Chat space */}
          {spaceName && (
            <div className="mt-0.5 text-[11px] text-muted/45">in {spaceName}</div>
          )}

          {/* Snippet */}
          <div className={`mt-0.5 text-[12px] leading-relaxed text-muted/45 ${
            expanded ? "whitespace-pre-wrap" : "truncate"
          }`}>
            {preview}
          </div>

          {/* Deal info card */}
          {hubspotDealUrl && (
            <a
              href={hubspotDealUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1.5 inline-flex items-center gap-2 rounded-md bg-orange-500/8 px-2.5 py-1.5 text-[11px] ring-1 ring-orange-500/20 hover:bg-orange-500/15 transition-colors"
            >
              <span className="font-semibold text-orange-400">Deal</span>
              <span className="text-muted/50">View in HubSpot</span>
              <svg className="h-3 w-3 text-orange-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}

          {/* Expanded To line */}
          {expanded && to && (
            <div className="mt-1.5 text-[11px] text-muted/40">
              <span className="font-medium text-muted/60">To:</span> {to}
            </div>
          )}

          {/* Action links — visible on hover OR expanded */}
          <div className={`mt-1.5 flex items-center gap-1 flex-wrap ${expanded ? "" : "hidden group-hover:flex"}`}>
            {onReply && (
              <button
                onClick={(e) => { e.stopPropagation(); onReply(id); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-foreground/60 bg-surface-2/40 hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                Reply
              </button>
            )}
            {onAiDraft && (
              <button
                onClick={(e) => { e.stopPropagation(); onAiDraft(id); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-purple-400/80 bg-purple-500/8 hover:bg-purple-500/15 hover:text-purple-300 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                AI Draft
              </button>
            )}
            {onMarkRead && isUnread && (
              <button
                onClick={(e) => { e.stopPropagation(); onMarkRead(id); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-foreground/45 bg-surface-2/30 hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                Mark Read
              </button>
            )}
            {onStar && (
              <button
                onClick={(e) => { e.stopPropagation(); onStar(id); }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  isStarred
                    ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                    : "text-foreground/45 bg-surface-2/30 hover:bg-surface-2 hover:text-amber-400"
                }`}
              >
                {isStarred ? "\u2605 Starred" : "\u2606 Star"}
              </button>
            )}
            {onArchive && (
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(id); }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-foreground/45 bg-surface-2/30 hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                Archive
              </button>
            )}
          </div>

          {/* Expand hint */}
          {!expanded && (
            <div className="mt-1 text-[10px] text-muted/25 hidden group-hover:block">
              Click to expand
            </div>
          )}

          {/* Expanded detail panel */}
          {expanded && (
            <div className="mt-3 border-t border-dashed border-t-border/15 pt-3 space-y-1 text-xs text-muted/45">
              <div>
                <span className="font-semibold text-muted/65">From:</span> {name} &lt;{senderEmail}&gt;
              </div>
              <div>
                <span className="font-semibold text-muted/65">Date:</span> {fullDate}
              </div>
              {to && (
                <div>
                  <span className="font-semibold text-muted/65">To:</span> {to}
                </div>
              )}
              {threadId && (
                <div>
                  <span className="font-semibold text-muted/65">Thread:</span>{" "}
                  <span className="font-mono text-[10px]">{threadId}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time column */}
        <div className="text-right shrink-0 pt-0.5">
          <div className="text-[11px] text-muted/45 tabular-nums">{dateStr}</div>
          {expanded && (
            <div className="mt-0.5 text-[10px] text-muted/30">{fullDate}</div>
          )}
        </div>
      </div>
    </div>
  );
}
