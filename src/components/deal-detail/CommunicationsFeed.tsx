"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { sanitizeEngagementHtml } from "@/lib/sanitize-engagement-html";
import type { Engagement } from "./types";

interface CommunicationsFeedProps {
  dealId: string;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  email:   { icon: "\u2709\uFE0F",  label: "Email" },
  call:    { icon: "\u{1F4DE}", label: "Call" },
  note:    { icon: "\u{1F4CB}", label: "Note" },
  meeting: { icon: "\u{1F4C5}", label: "Meeting" },
};

function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs % 60}s`;
}

export default function CommunicationsFeed({ dealId }: CommunicationsFeedProps) {
  const [showAll, setShowAll] = useState(false);

  const query = useQuery({
    queryKey: [...queryKeys.dealCommunications.list(dealId), showAll],
    queryFn: async () => {
      const url = `/api/deals/${dealId}/communications${showAll ? "?all=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch communications");
      const data: { engagements: Engagement[] } = await res.json();
      return data.engagements;
    },
    staleTime: 60_000,
  });

  const engagements = query.data ?? [];

  return (
    <div>
      {query.isLoading && (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <span className="animate-spin">{"\u27F3"}</span> Loading communications...
        </div>
      )}

      {!query.isLoading && engagements.length === 0 && (
        <p className="py-4 text-center text-xs text-muted">No communications found.</p>
      )}

      {engagements.length > 0 && (
        <div className="divide-y divide-t-border">
          {engagements.map((eng) => (
            <EngagementRow key={eng.id} engagement={eng} />
          ))}
        </div>
      )}

      {!showAll && !query.isLoading && engagements.length > 0 && (
        <div className="flex justify-center py-2">
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Show all history
          </button>
        </div>
      )}
    </div>
  );
}

function EngagementRow({ engagement }: { engagement: Engagement }) {
  const isNote = engagement.type === "note";
  const [expanded, setExpanded] = useState(isNote);
  const config = TYPE_CONFIG[engagement.type] ?? { icon: "\u{1F4CB}", label: "Other" };
  // Sanitized via sanitize-html (strips scripts, event handlers, dangerous URIs)
  const sanitizedBody = useMemo(
    () => sanitizeEngagementHtml(engagement.body),
    [engagement.body],
  );
  const hasBody = sanitizedBody.length > 0;

  return (
    <div className="flex gap-3 py-2.5">
      <div className="shrink-0 pt-0.5 text-sm text-cyan-500">{config.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground truncate">
            {config.label}
            {engagement.subject ? ` \u2014 ${engagement.subject}` : ""}
          </span>
          <span
            className="shrink-0 text-[10px] text-muted"
            title={new Date(engagement.timestamp).toLocaleString()}
          >
            {new Date(engagement.timestamp).toLocaleDateString()}
          </span>
        </div>

        {/* Meta line */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[10px] text-muted">
          {engagement.from && <span>From: {engagement.from}</span>}
          {engagement.to && engagement.to.length > 0 && (
            <span>To: {engagement.to.join(", ")}</span>
          )}
          {engagement.duration != null && (
            <span>Duration: {formatDuration(engagement.duration)}</span>
          )}
          {engagement.disposition && <span>{engagement.disposition}</span>}
          {engagement.attendees && engagement.attendees.length > 0 && (
            <span>Attendees: {engagement.attendees.length}</span>
          )}
        </div>

        {/* Expandable body — sanitized HTML rendered as markup */}
        {hasBody && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-0.5 text-[10px] text-muted hover:text-foreground transition-colors"
            >
              {expanded ? "Hide \u25B4" : "Show details \u25BE"}
            </button>
            {expanded && (
              <EngagementBody html={sanitizedBody} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Renders sanitized engagement HTML. Content is pre-sanitized via sanitize-html. */
function EngagementBody({ html }: { html: string }) {
  return (
    <div
      className="engagement-body mt-1 rounded border border-t-border bg-surface p-2 text-xs text-muted leading-relaxed max-h-60 overflow-y-auto [&_a]:text-orange-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded [&_p]:mb-1 [&_br+br]:hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
