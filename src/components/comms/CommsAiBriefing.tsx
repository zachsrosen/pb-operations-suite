"use client";

import { useState } from "react";

interface Props {
  analytics?: {
    unreadCount?: number;
    unreadGmail?: number;
    unreadHubspot?: number;
    unreadChat?: number;
    mentionCount?: number;
    taskCount?: number;
    starredCount?: number;
    stageChangeCount?: number;
  };
}

export default function CommsAiBriefing({ analytics }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [briefing, setBriefing] = useState<{
    headline: string;
    priorities: string[];
    risks: string[];
    suggestion: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBriefing() {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/comms/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "briefing",
          analytics,
        }),
      });
      if (!resp.ok) throw new Error("Failed to generate briefing");
      const data = await resp.json();
      setBriefing(data.briefing || {
        headline: `You have ${analytics?.unreadCount ?? 0} unread messages across your inbox.`,
        priorities: [
          analytics?.mentionCount ? `${analytics.mentionCount} @mentions need your attention` : null,
          analytics?.taskCount ? `${analytics.taskCount} tasks are waiting for action` : null,
          analytics?.stageChangeCount ? `${analytics.stageChangeCount} deal stage changes to review` : null,
          analytics?.unreadHubspot ? `${analytics.unreadHubspot} HubSpot notifications unread` : null,
        ].filter(Boolean) as string[],
        risks: [],
        suggestion: "Focus on @mentions and tasks first — they typically need the quickest response.",
      });
    } catch {
      // Fallback: generate a local summary from analytics
      setBriefing({
        headline: `You have ${analytics?.unreadCount ?? 0} unread messages across your inbox.`,
        priorities: [
          analytics?.mentionCount ? `${analytics.mentionCount} @mentions need your attention` : null,
          analytics?.taskCount ? `${analytics.taskCount} tasks are waiting for action` : null,
          analytics?.stageChangeCount ? `${analytics.stageChangeCount} deal stage changes to review` : null,
          analytics?.unreadHubspot ? `${analytics.unreadHubspot} HubSpot notifications unread` : null,
          analytics?.unreadChat ? `${analytics.unreadChat} unread Chat messages` : null,
        ].filter(Boolean) as string[],
        risks: [],
        suggestion: "Focus on @mentions and tasks first — they typically need the quickest response.",
      });
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-[#0c1425] to-[#162033] p-4 mb-4 border border-cyan-500/10">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white/90">
          <span className="text-base">&#129504;</span>
          AI Inbox Briefing
        </h3>
        <button
          onClick={runBriefing}
          disabled={isLoading}
          className="rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Analyzing..." : briefing ? "Refresh" : "Analyze Inbox"}
        </button>
      </div>

      {isLoading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
          Analyzing your inbox patterns...
        </div>
      )}

      {error && (
        <div className="mt-3 text-xs text-red-400">{error}</div>
      )}

      {briefing && !isLoading && (
        <div className="mt-3 space-y-3">
          <p className="text-base font-bold text-white leading-snug">
            {briefing.headline}
          </p>
          {briefing.priorities.length > 0 && (
            <ul className="space-y-1.5">
              {briefing.priorities.map((p, i) => (
                <li
                  key={i}
                  className="rounded-md bg-white/5 px-3 py-2 text-[13px] text-slate-300 border-l-2 border-cyan-500"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}
          {briefing.risks.length > 0 && (
            <ul className="space-y-1.5">
              {briefing.risks.map((r, i) => (
                <li
                  key={i}
                  className="rounded-md bg-red-500/5 px-3 py-2 text-[13px] text-red-300 border-l-2 border-red-500"
                >
                  {r}
                </li>
              ))}
            </ul>
          )}
          {briefing.suggestion && (
            <p className="text-[13px] italic text-cyan-300/70">
              {briefing.suggestion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
