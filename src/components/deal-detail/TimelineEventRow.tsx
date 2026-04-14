"use client";

import { useState, useMemo } from "react";
import { sanitizeEngagementHtml } from "@/lib/sanitize-engagement-html";
import type { TimelineEvent, TimelineEventType } from "./types";

const EVENT_CONFIG: Record<TimelineEventType, { icon: string; color: string; label: string }> = {
  note:         { icon: "\u{1F4DD}", color: "text-orange-500", label: "Note" },
  sync:         { icon: "\u{1F504}", color: "text-blue-500",   label: "Sync" },
  zuper:        { icon: "\u{1F527}", color: "text-green-500",  label: "Zuper" },
  photo:        { icon: "\u{1F4F7}", color: "text-purple-500", label: "Photo" },
  email:        { icon: "\u2709\uFE0F",  color: "text-cyan-500",   label: "Email" },
  call:         { icon: "\u{1F4DE}", color: "text-cyan-500",   label: "Call" },
  meeting:      { icon: "\u{1F4C5}", color: "text-cyan-500",   label: "Meeting" },
  hubspot_note: { icon: "\u{1F4CB}", color: "text-cyan-500",   label: "HubSpot Note" },
};

const SYNC_STATUS_ICONS: Record<string, { icon: string; title: string }> = {
  SYNCED:  { icon: "\u2713", title: "Synced" },
  PENDING: { icon: "\u27F3", title: "Syncing..." },
  FAILED:  { icon: "\u2717", title: "Sync failed" },
  SKIPPED: { icon: "\u2014", title: "No linked jobs" },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function SyncChangesDiff({ changes }: { changes: Record<string, [unknown, unknown]> }) {
  return (
    <div className="mt-1 space-y-0.5">
      {Object.entries(changes).map(([field, pair]) => {
        const oldVal = (pair as [unknown, unknown])[0];
        const newVal = (pair as [unknown, unknown])[1];
        return (
          <div key={field} className="text-[10px]">
            <span className="font-medium text-muted">{field}:</span>{" "}
            <span className="text-red-400 line-through">{String(oldVal ?? "\u2014")}</span>{" "}
            <span className="text-emerald-400">{String(newVal ?? "\u2014")}</span>
          </div>
        );
      })}
    </div>
  );
}

// Event types whose detail bodies contain HubSpot HTML
const HTML_BODY_TYPES = new Set<TimelineEventType>(["email", "call", "meeting", "hubspot_note"]);

export default function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const config = EVENT_CONFIG[event.type];
  const isHtmlBody = HTML_BODY_TYPES.has(event.type);
  const sanitizedDetail = useMemo(
    () => isHtmlBody ? sanitizeEngagementHtml(event.detail) : "",
    [event.detail, isHtmlBody],
  );
  const hasDetail = isHtmlBody ? sanitizedDetail.length > 0 : !!event.detail;
  const meta = event.metadata ?? {};

  // Sync change detail
  const changes = meta.changes as Record<string, [unknown, unknown]> | undefined;
  const hasSyncChanges = event.type === "sync" && !!changes && Object.keys(changes).length > 0;

  // Note sync indicators
  const hubspotStatus = meta.hubspotSyncStatus as string | undefined;
  const zuperStatus = meta.zuperSyncStatus as string | undefined;
  const showSyncStatus = event.type === "note" && (hubspotStatus || zuperStatus);

  return (
    <div className="flex gap-3 py-2">
      {/* Left icon */}
      <div className={`shrink-0 pt-0.5 text-sm ${config.color}`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium text-foreground truncate">
              {event.title}
            </span>
            {showSyncStatus && (
              <span className="flex items-center gap-0.5 shrink-0">
                {hubspotStatus && (
                  <span
                    className={`text-[10px] ${hubspotStatus === "SYNCED" ? "text-emerald-500" : hubspotStatus === "FAILED" ? "text-red-500" : "text-yellow-500"}`}
                    title={`HubSpot: ${SYNC_STATUS_ICONS[hubspotStatus]?.title ?? hubspotStatus}`}
                  >
                    {SYNC_STATUS_ICONS[hubspotStatus]?.icon ?? "?"}
                  </span>
                )}
                {zuperStatus && zuperStatus !== "SKIPPED" && (
                  <span
                    className={`text-[10px] ${zuperStatus === "SYNCED" ? "text-emerald-500" : zuperStatus === "FAILED" ? "text-red-500" : "text-yellow-500"}`}
                    title={`Zuper: ${SYNC_STATUS_ICONS[zuperStatus]?.title ?? zuperStatus}`}
                  >
                    {SYNC_STATUS_ICONS[zuperStatus]?.icon ?? "?"}
                  </span>
                )}
              </span>
            )}
          </div>
          <span
            className="shrink-0 text-[10px] text-muted"
            title={new Date(event.timestamp).toLocaleString()}
          >
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>

        {/* Expandable detail */}
        {(hasDetail || hasSyncChanges) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-0.5 text-[10px] text-muted hover:text-foreground transition-colors"
          >
            {expanded ? "Hide details \u25B4" : "Show details \u25BE"}
          </button>
        )}

        {expanded && hasDetail && event.type !== "sync" && (
          isHtmlBody ? (
            <TimelineHtmlBody html={sanitizedDetail} />
          ) : (
            <p className="mt-1 text-xs text-muted whitespace-pre-wrap leading-relaxed">
              {event.detail}
            </p>
          )
        )}

        {expanded && hasSyncChanges && (
          <SyncChangesDiff changes={changes!} />
        )}

        {/* Photo thumbnail */}
        {expanded && event.type === "photo" && typeof meta.url === "string" && (
          <img
            src={meta.url}
            alt={event.detail ?? "Site photo"}
            className="mt-1 h-20 w-20 rounded object-cover"
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
}

/** Renders pre-sanitized engagement HTML (sanitized via sanitize-html library). */
function TimelineHtmlBody({ html }: { html: string }) {
  return (
    <div
      className="mt-1 rounded border border-t-border bg-surface p-2 text-xs text-muted leading-relaxed max-h-60 overflow-y-auto [&_a]:text-orange-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded [&_p]:mb-1 [&_br+br]:hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
