"use client";

import { useMemo, useState } from "react";

interface ProjectGroup {
  projectId: string;
  dealName: string;
  hubspotDealUrl: string | null;
  messageCount: number;
  unreadCount: number;
  latestDate: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  onFilterByProject: (projectId: string) => void;
}

/** Extract PROJ-XXXX from subject or snippet */
function extractProjectId(subject: string, snippet: string): string | null {
  const text = `${subject} ${snippet}`;
  const match = text.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function CommsProjectView({ messages, onFilterByProject }: Props) {
  const [expandedProj, setExpandedProj] = useState<string | null>(null);

  const groups = useMemo(() => {
    const groupMap = new Map<string, ProjectGroup>();

    for (const m of messages) {
      const projId = extractProjectId(m.subject || "", m.snippet || "");
      if (!projId) continue;

      if (!groupMap.has(projId)) {
        groupMap.set(projId, {
          projectId: projId,
          dealName: "",
          hubspotDealUrl: null,
          messageCount: 0,
          unreadCount: 0,
          latestDate: m.date,
          messages: [],
        });
      }

      const group = groupMap.get(projId)!;
      group.messageCount++;
      if (m.isUnread) group.unreadCount++;
      if (new Date(m.date) > new Date(group.latestDate)) {
        group.latestDate = m.date;
      }
      if (!group.hubspotDealUrl && m.hubspotDealUrl) {
        group.hubspotDealUrl = m.hubspotDealUrl;
      }
      group.messages.push(m);
    }

    return [...groupMap.values()].sort((a, b) => b.messageCount - a.messageCount);
  }, [messages]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-t-border/15 bg-surface/30 py-16 text-center">
        <p className="text-sm text-muted/50">No project-tagged emails found.</p>
        <p className="mt-1 text-xs text-muted/30">
          Emails with PROJ-XXXX in the subject will appear here grouped by project.
        </p>
      </div>
    );
  }

  const totalProjectMessages = groups.reduce((s, g) => s + g.messageCount, 0);

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted/40 px-1">
        {groups.length} projects with {totalProjectMessages} messages
      </div>
      <div className="rounded-xl border border-t-border/15 bg-surface/30 overflow-hidden shadow-card">
        {groups.map((g) => {
          const isExpanded = expandedProj === g.projectId;
          return (
            <div key={g.projectId} className="border-b border-t-border/10 last:border-b-0">
              {/* Group header */}
              <div
                onClick={() => setExpandedProj(isExpanded ? null : g.projectId)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer bg-gradient-to-r from-emerald-500/5 to-transparent hover:from-emerald-500/10 transition-colors"
              >
                {/* Expand chevron */}
                <svg
                  className={`h-3.5 w-3.5 text-muted/40 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>

                {/* Project ID */}
                <span className="text-sm font-bold text-emerald-400 shrink-0">
                  {g.projectId}
                </span>

                {/* Deal name */}
                {g.dealName && (
                  <span className="text-sm text-foreground/60 truncate">
                    {g.dealName}
                  </span>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Stats */}
                <span className="text-[11px] text-muted/40 shrink-0">
                  {timeAgo(g.latestDate)}
                </span>

                {g.unreadCount > 0 && (
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                    {g.unreadCount} unread
                  </span>
                )}

                <span className="rounded-full bg-surface-2/50 px-2.5 py-0.5 text-[11px] font-medium text-muted/50 ring-1 ring-t-border/20">
                  {g.messageCount} email{g.messageCount !== 1 ? "s" : ""}
                </span>

                {/* Action links */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onFilterByProject(g.projectId)}
                    className="rounded-md bg-surface-2/40 px-2 py-1 text-[10px] font-medium text-foreground/50 hover:bg-surface-2 hover:text-foreground transition-colors"
                  >
                    Filter
                  </button>
                  <a
                    href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(g.projectId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-red-500/8 px-2 py-1 text-[10px] font-medium text-red-400/70 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                  >
                    Gmail
                  </a>
                  {g.hubspotDealUrl && (
                    <a
                      href={g.hubspotDealUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-orange-500/8 px-2 py-1 text-[10px] font-medium text-orange-400/70 hover:bg-orange-500/15 hover:text-orange-400 transition-colors"
                    >
                      Deal
                    </a>
                  )}
                </div>
              </div>

              {/* Expanded messages */}
              {isExpanded && (
                <div className="border-t border-t-border/10 bg-surface/20">
                  {g.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-start gap-3 px-6 py-2.5 border-b border-t-border/5 last:border-b-0 ${
                        m.isUnread ? "bg-surface/40" : ""
                      }`}
                    >
                      {m.isUnread && (
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-cyan-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${m.isUnread ? "font-semibold text-foreground" : "text-foreground/60"}`}>
                            {(m.from || "").split("<")[0]?.trim()?.replace(/["']/g, "") || "Unknown"}
                          </span>
                          <span
                            className="rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide"
                            style={{
                              background: m.source === "hubspot" ? "rgba(255,122,89,0.12)" : "rgba(234,67,53,0.12)",
                              color: m.source === "hubspot" ? "#ff7a59" : "#ea4335",
                            }}
                          >
                            {m.source}
                          </span>
                        </div>
                        <div className={`text-[12px] ${m.isUnread ? "text-foreground/80" : "text-foreground/45"} truncate`}>
                          {m.subject || "(no subject)"}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted/40 shrink-0 tabular-nums">
                        {new Date(m.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
