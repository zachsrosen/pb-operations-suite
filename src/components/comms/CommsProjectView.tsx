"use client";

import { useMemo, useState } from "react";

interface ProjectInfo {
  dealName: string;
  dealId: string;
  hubspotUrl: string;
  stage: string;
  amount: number | null;
}

interface ProjectGroup {
  projectId: string;
  info: ProjectInfo | null;
  hubspotDealUrl: string | null;
  messageCount: number;
  unreadCount: number;
  latestDate: string;
  categoryBreakdown: Record<string, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  projectMap?: Record<string, ProjectInfo>;
  onFilterByProject: (projectId: string) => void;
}

/** Extract PROJ-XXXX from subject or snippet */
function extractProjectId(subject: string, snippet: string, text: string): string | null {
  const combined = `${subject} ${snippet} ${text}`;
  const match = combined.match(/PROJ-(\d+)/i);
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

function formatAmount(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  return `$${amount.toLocaleString()}`;
}

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  won: { bg: "rgba(5,150,105,0.12)", text: "#059669" },
  complete: { bg: "rgba(5,150,105,0.12)", text: "#059669" },
  lost: { bg: "rgba(220,38,38,0.12)", text: "#dc2626" },
  cancel: { bg: "rgba(220,38,38,0.12)", text: "#dc2626" },
  hold: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
  blocked: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b" },
};

function stageStyle(stage: string): { bg: string; text: string } {
  const lower = stage.toLowerCase();
  for (const [key, style] of Object.entries(STAGE_COLORS)) {
    if (lower.includes(key)) return style;
  }
  return { bg: "rgba(99,102,241,0.12)", text: "#6366f1" };
}

const CATEGORY_LABELS: Record<string, string> = {
  stage_change: "Stage",
  mention: "@Mentions",
  task: "Tasks",
  comment: "Comments",
  general: "Other",
};

export default function CommsProjectView({ messages, projectMap = {}, onFilterByProject }: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleExpand = (projId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projId)) next.delete(projId);
      else next.add(projId);
      return next;
    });
  };

  const groups = useMemo(() => {
    const groupMap = new Map<string, ProjectGroup>();

    for (const m of messages) {
      const projId = extractProjectId(m.subject || "", m.snippet || "", m.text || "");
      if (!projId) continue;

      if (!groupMap.has(projId)) {
        groupMap.set(projId, {
          projectId: projId,
          info: projectMap[projId] || null,
          hubspotDealUrl: null,
          messageCount: 0,
          unreadCount: 0,
          latestDate: m.date,
          categoryBreakdown: {},
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
      // Category breakdown
      const cat = m.category || "general";
      group.categoryBreakdown[cat] = (group.categoryBreakdown[cat] || 0) + 1;
      group.messages.push(m);
    }

    return [...groupMap.values()].sort((a, b) => b.messageCount - a.messageCount);
  }, [messages, projectMap]);

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
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-muted/40">
          {groups.length} projects with {totalProjectMessages} messages
        </span>
        <button
          onClick={() => {
            if (expandedProjects.size === groups.length) {
              setExpandedProjects(new Set());
            } else {
              setExpandedProjects(new Set(groups.map((g) => g.projectId)));
            }
          }}
          className="text-[11px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
        >
          {expandedProjects.size === groups.length ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <div className="rounded-xl border border-t-border/15 bg-surface/30 overflow-hidden shadow-card">
        {groups.map((g) => {
          const isExpanded = expandedProjects.has(g.projectId);
          const dealUrl = g.info?.hubspotUrl || g.hubspotDealUrl;
          const dealName = g.info?.dealName || "";
          const stage = g.info?.stage || "";
          const amount = g.info?.amount;
          const breakdown = Object.entries(g.categoryBreakdown)
            .map(([k, v]) => `${v} ${CATEGORY_LABELS[k] || k}`)
            .join(" · ");

          return (
            <div key={g.projectId} className="border-b border-t-border/10 last:border-b-0">
              {/* Group header */}
              <div
                onClick={() => toggleExpand(g.projectId)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  isExpanded
                    ? "bg-gradient-to-r from-emerald-500/10 to-emerald-500/3"
                    : "bg-gradient-to-r from-emerald-500/5 to-transparent hover:from-emerald-500/8"
                }`}
              >
                {/* Expand chevron */}
                <svg
                  className={`h-3.5 w-3.5 text-muted/40 shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
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
                {dealName ? (
                  <span className="text-sm text-foreground/70 truncate min-w-0 flex-1" title={dealName}>
                    — {dealName}
                  </span>
                ) : (
                  <span className="text-sm text-muted/30 italic truncate min-w-0 flex-1">
                    (no deal linked)
                  </span>
                )}

                {/* Stage badge */}
                {stage && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ background: stageStyle(stage).bg, color: stageStyle(stage).text }}
                  >
                    {stage}
                  </span>
                )}

                {/* Amount */}
                {amount != null && amount > 0 && (
                  <span className="text-xs font-bold text-emerald-400 shrink-0">
                    {formatAmount(amount)}
                  </span>
                )}

                {/* Category breakdown */}
                <span className="text-[10px] text-muted/35 shrink-0 hidden lg:inline">
                  {breakdown}
                </span>

                {/* Time */}
                <span className="text-[10px] text-muted/35 shrink-0 tabular-nums">
                  {timeAgo(g.latestDate)}
                </span>

                {/* Unread count */}
                {g.unreadCount > 0 && (
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 shrink-0">
                    {g.unreadCount} unread
                  </span>
                )}

                {/* Email count */}
                <span className="rounded-full bg-surface-2/50 px-2.5 py-0.5 text-[10px] font-medium text-muted/50 ring-1 ring-t-border/20 shrink-0">
                  {g.messageCount}
                </span>

                {/* Action links */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onFilterByProject(g.projectId)}
                    className="rounded-md bg-surface-2/40 px-2 py-1 text-[10px] font-medium text-foreground/50 hover:bg-surface-2 hover:text-foreground transition-colors"
                  >
                    Filter
                  </button>
                  {dealUrl && (
                    <a
                      href={dealUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-orange-500/8 px-2 py-1 text-[10px] font-medium text-orange-400/70 hover:bg-orange-500/15 hover:text-orange-400 transition-colors"
                    >
                      <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      HubSpot
                    </a>
                  )}
                  <a
                    href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(g.projectId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md bg-red-500/8 px-2 py-1 text-[10px] font-medium text-red-400/70 hover:bg-red-500/15 hover:text-red-400 transition-colors"
                  >
                    Gmail
                  </a>
                </div>
              </div>

              {/* Expanded messages */}
              {isExpanded && (
                <div className="border-t border-t-border/10 bg-surface/20">
                  {g.messages.map((m) => {
                    const senderName = (m.from || m.sender || "")
                      .split("<")[0]
                      ?.trim()
                      ?.replace(/["']/g, "") || "Unknown";
                    const sourceColor = m.source === "hubspot"
                      ? { bg: "rgba(255,122,89,0.12)", text: "#ff7a59" }
                      : m.source === "chat"
                      ? { bg: "rgba(15,157,88,0.12)", text: "#0f9d58" }
                      : { bg: "rgba(234,67,53,0.12)", text: "#ea4335" };

                    return (
                      <div
                        key={m.id}
                        className={`flex items-start gap-3 px-5 py-2.5 border-b border-t-border/5 last:border-b-0 transition-colors hover:bg-surface/30 ${
                          m.isUnread ? "bg-surface/40 border-l-2 border-l-cyan-400" : ""
                        }`}
                      >
                        {/* Unread dot */}
                        <div className="w-3 pt-1.5 shrink-0">
                          {m.isUnread && (
                            <span className="block h-2 w-2 rounded-full bg-cyan-400" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs ${m.isUnread ? "font-semibold text-foreground" : "text-foreground/60"}`}>
                              {senderName}
                            </span>
                            {(m.fromEmail || m.senderEmail) && (
                              <span className="text-[10px] text-muted/35">{m.fromEmail || m.senderEmail}</span>
                            )}
                            <span
                              className="rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide"
                              style={{ background: sourceColor.bg, color: sourceColor.text }}
                            >
                              {m.source}
                            </span>
                            {m.category && m.category !== "general" && (
                              <span className="rounded bg-cyan-500/10 px-1 py-px text-[8px] font-medium text-cyan-400/70">
                                {CATEGORY_LABELS[m.category] || m.category}
                              </span>
                            )}
                            {m.isStarred && <span className="text-amber-400 text-[10px]">&#9733;</span>}
                          </div>
                          <div className={`mt-0.5 text-[12px] leading-snug ${m.isUnread ? "text-foreground/80" : "text-foreground/45"} truncate`}>
                            {m.subject || "(no subject)"}
                          </div>
                          {(m.snippet || m.text) && (
                            <div className="mt-0.5 text-[11px] text-muted/35 truncate">
                              {m.snippet || m.text}
                            </div>
                          )}
                        </div>

                        {/* Date */}
                        <div className="text-right shrink-0 pt-0.5">
                          <div className="text-[10px] text-muted/40 tabular-nums">
                            {new Date(m.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                          </div>
                          <div className="text-[9px] text-muted/25 tabular-nums">
                            {new Date(m.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
