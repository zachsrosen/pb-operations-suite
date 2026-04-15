"use client";

import { useState, useMemo } from "react";
import { sanitizeEngagementHtml } from "@/lib/sanitize-engagement-html";
import type { TimelineAttachment, TimelineEvent, TimelineEventType } from "./types";

const EVENT_CONFIG: Record<TimelineEventType, { icon: string; color: string; label: string }> = {
  note:         { icon: "\u{1F4DD}", color: "text-orange-500", label: "Note" },
  sync:         { icon: "\u{1F504}", color: "text-blue-500",   label: "Sync" },
  zuper:        { icon: "\u{1F527}", color: "text-green-500",  label: "Zuper" },
  zuper_status: { icon: "\u{1F504}", color: "text-green-500",  label: "Job Status" },
  zuper_note:   { icon: "\u{1F527}", color: "text-green-500",  label: "Zuper Note" },
  bom:          { icon: "\u{1F4E6}", color: "text-purple-500", label: "BOM" },
  schedule:     { icon: "\u{1F4C5}", color: "text-blue-500",   label: "Scheduled" },
  photo:        { icon: "\u{1F4F7}", color: "text-purple-500", label: "Photo" },
  email:        { icon: "\u2709\uFE0F",  color: "text-cyan-500",   label: "Email" },
  call:         { icon: "\u{1F4DE}", color: "text-cyan-500",   label: "Call" },
  meeting:      { icon: "\u{1F4C5}", color: "text-cyan-500",   label: "Meeting" },
  hubspot_note: { icon: "\u{1F4CB}", color: "text-cyan-500",   label: "HubSpot Note" },
  task:         { icon: "\u2611\uFE0F",  color: "text-yellow-500", label: "Task" },
  service_task: { icon: "\u2611\uFE0F",  color: "text-green-500",  label: "Checklist" },
};

const SERVICE_TASK_STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-emerald-500",
  IN_PROGRESS: "text-yellow-500",
  PENDING: "text-muted",
  FAILED: "text-red-500",
  NOT_STARTED: "text-muted",
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

function SyncChangesDiff({
  changes,
  displayChanges,
}: {
  changes?: Record<string, [unknown, unknown]>;
  displayChanges?: Record<string, { label: string; old: unknown; new: unknown }>;
}) {
  // Prefer displayChanges (has human-readable labels)
  if (displayChanges) {
    return (
      <div className="mt-1 space-y-0.5">
        {Object.entries(displayChanges).map(([field, { label, old: oldVal, new: newVal }]) => (
          <div key={field} className="text-[10px]">
            <span className="font-medium text-muted">{label}:</span>{" "}
            <span className="text-red-400 line-through">{String(oldVal ?? "\u2014")}</span>{" "}
            <span className="text-emerald-400">{String(newVal ?? "\u2014")}</span>
          </div>
        ))}
      </div>
    );
  }
  // Fallback: raw changes (old events without displayChanges)
  if (!changes) return null;
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
const HTML_BODY_TYPES = new Set<TimelineEventType>(["email", "call", "meeting", "hubspot_note", "task"]);

// Event types whose bodies should be visible by default
const AUTO_EXPAND_TYPES = new Set<TimelineEventType>(["note", "hubspot_note", "zuper_note"]);

// Event types that may carry file attachments (shown as chips under the detail)
const ATTACHMENT_TYPES = new Set<TimelineEventType>(["zuper_note", "service_task"]);

function AttachmentChips({ attachments }: { attachments: TimelineAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a, i) =>
        a.isImage ? (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block shrink-0"
            title={a.fileName}
          >
            <img
              src={a.url}
              alt={a.fileName}
              className="h-14 w-14 rounded border border-t-border object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={`${a.url}-${i}`}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-t-border bg-surface px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground transition-colors max-w-[200px]"
            title={a.fileName}
          >
            <span>{"\u{1F4CE}"}</span>
            <span className="truncate">{a.fileName}</span>
          </a>
        ),
      )}
    </div>
  );
}

export default function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(AUTO_EXPAND_TYPES.has(event.type));
  const config = EVENT_CONFIG[event.type];
  const isHtmlBody = HTML_BODY_TYPES.has(event.type);
  const sanitizedDetail = useMemo(
    () => isHtmlBody ? sanitizeEngagementHtml(event.detail) : "",
    [event.detail, isHtmlBody],
  );
  const hasDetail = isHtmlBody ? sanitizedDetail.length > 0 : !!event.detail;
  const meta = event.metadata ?? {};

  // Sync change detail
  const displayChanges = meta.displayChanges as Record<string, { label: string; old: unknown; new: unknown }> | undefined;
  const changes = meta.changes as Record<string, [unknown, unknown]> | undefined;
  const hasSyncChanges = event.type === "sync" && !!(displayChanges ? Object.keys(displayChanges).length > 0 : changes && Object.keys(changes).length > 0);

  // Note sync indicators
  const hubspotStatus = meta.hubspotSyncStatus as string | undefined;
  const zuperStatus = meta.zuperSyncStatus as string | undefined;
  const showSyncStatus = event.type === "note" && (hubspotStatus || zuperStatus);

  // Attachments (Zuper notes + service tasks)
  const rawAttachments = meta.attachments;
  const attachments: TimelineAttachment[] = ATTACHMENT_TYPES.has(event.type) && Array.isArray(rawAttachments)
    ? (rawAttachments as TimelineAttachment[])
    : [];
  const hasAttachments = attachments.length > 0;

  // Service task status badge
  const serviceTaskStatus = event.type === "service_task" ? (meta.status as string | undefined) : undefined;

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
            {serviceTaskStatus && (
              <span
                className={`shrink-0 text-[10px] font-medium ${SERVICE_TASK_STATUS_COLORS[serviceTaskStatus] ?? "text-muted"}`}
                title={`Status: ${serviceTaskStatus}`}
              >
                {serviceTaskStatus.replace(/_/g, " ").toLowerCase()}
              </span>
            )}
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
        {(hasDetail || hasSyncChanges || hasAttachments) && (
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
          <SyncChangesDiff changes={changes} displayChanges={displayChanges} />
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

        {/* Attachments for Zuper notes + service tasks */}
        {expanded && hasAttachments && <AttachmentChips attachments={attachments} />}
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
