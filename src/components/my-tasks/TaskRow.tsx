"use client";

import { useState } from "react";
import Link from "next/link";
import type { EnrichedTask, TaskPriority, TaskType } from "@/lib/hubspot-tasks";
import SnoozePopover from "./SnoozePopover";

interface TaskRowProps {
  task: EnrichedTask;
  onComplete: () => void;
  onReopen?: () => void;
  onSnooze: (dueAt: string | null) => void;
  pending: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  mode: "open" | "completed";
}

const TYPE_ICON: Record<TaskType, string> = {
  CALL: "📞",
  EMAIL: "✉️",
  TODO: "☑️",
};

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  HIGH: "bg-red-500/10 text-red-500 border-red-500/30",
  MEDIUM: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
  LOW: "bg-blue-500/10 text-blue-500 border-blue-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  COMPLETED: "Completed",
};

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const due = new Date(dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dateStr = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (diffDays === 0) return `Today ${timeStr}`;
  if (diffDays === 1) return `Tomorrow ${timeStr}`;
  if (diffDays === -1) return `Yesterday ${timeStr}`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)}d overdue`;
  if (diffHours < 0 && diffHours > -24) return `${Math.abs(diffHours)}h overdue`;
  if (diffDays > 1 && diffDays <= 7) return `${dateStr} ${timeStr}`;
  return dateStr;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export default function TaskRow({
  task,
  onComplete,
  onReopen,
  onSnooze,
  pending,
  selected,
  onSelectedChange,
  mode,
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const bodyText = task.body ? stripHtml(task.body) : "";
  const shouldTruncate = bodyText.length > 120;
  const bodyPreview = shouldTruncate && !expanded ? bodyText.slice(0, 120) + "…" : bodyText;
  const isCompleted = mode === "completed";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(task.hubspotUrl);
    } catch {
      // swallow — clipboard not available
    }
  };

  return (
    <div
      className={`group rounded-lg border p-3 transition-colors ${
        isCompleted
          ? "border-t-border/50 bg-surface/50 opacity-70"
          : selected
            ? "border-blue-500/60 bg-blue-500/5"
            : "border-t-border bg-surface hover:bg-surface-2"
      }`}
    >
      <div className="flex items-start gap-3">
        {!isCompleted && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectedChange(e.target.checked)}
            aria-label="Select task"
            className="mt-1 h-4 w-4 cursor-pointer accent-blue-500"
          />
        )}

        <span className="text-lg leading-none pt-0.5" aria-label={task.type ?? "task"}>
          {task.type ? TYPE_ICON[task.type] : "📌"}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`font-medium ${isCompleted ? "text-muted line-through" : "text-foreground"}`}
            >
              {task.subject || "(No subject)"}
            </h3>
            {task.priority && (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PRIORITY_CLASS[task.priority]}`}
              >
                {task.priority}
              </span>
            )}
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {STATUS_LABEL[task.status] ?? task.status}
            </span>
            <div className="relative ml-auto">
              {isCompleted ? (
                <span className="text-xs text-muted">{formatDue(task.dueAt)}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setSnoozeOpen((v) => !v)}
                  className="rounded border border-transparent px-1.5 py-0.5 text-xs text-muted hover:border-t-border hover:bg-surface-2 hover:text-foreground"
                  title="Reschedule"
                >
                  {formatDue(task.dueAt)}
                </button>
              )}
              {snoozeOpen && (
                <SnoozePopover
                  currentDueAt={task.dueAt}
                  onSelect={onSnooze}
                  onClose={() => setSnoozeOpen(false)}
                />
              )}
            </div>
          </div>

          {bodyText && (
            <p className="mt-1 text-sm text-muted">
              {bodyPreview}
              {shouldTruncate && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="ml-2 text-blue-500 hover:underline"
                >
                  {expanded ? "show less" : "show more"}
                </button>
              )}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {task.associations.deal && (
              <Link
                href={`/dashboards/deals?dealId=${task.associations.deal.id}`}
                className="rounded bg-surface-2 px-2 py-1 text-foreground hover:bg-surface-elevated"
              >
                🏷️ {task.associations.deal.name}
                {task.associations.deal.stage && (
                  <span className="ml-1.5 text-muted">· {task.associations.deal.stage}</span>
                )}
              </Link>
            )}
            {task.associations.ticket && (
              <Link
                href={`/dashboards/service-tickets?ticketId=${task.associations.ticket.id}`}
                className="rounded bg-surface-2 px-2 py-1 text-foreground hover:bg-surface-elevated"
              >
                🎫 {task.associations.ticket.subject}
              </Link>
            )}
            {task.associations.contact && (
              <span className="rounded bg-surface-2 px-2 py-1 text-foreground">
                👤 {task.associations.contact.name}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {isCompleted ? (
                <button
                  type="button"
                  onClick={onReopen}
                  disabled={pending}
                  className="rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[11px] font-semibold text-blue-400 hover:bg-blue-500/20 disabled:opacity-50"
                  title="Reopen this task in HubSpot"
                >
                  {pending ? "Reopening…" : "↺ Reopen"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onComplete}
                  disabled={pending}
                  className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                  title="Mark this task done in HubSpot"
                >
                  {pending ? "Marking done…" : "✓ Mark done"}
                </button>
              )}
              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <a
                  href={task.hubspotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Open in HubSpot ↗
                </a>
                <button
                  type="button"
                  onClick={copyLink}
                  className="text-muted hover:text-foreground"
                  title="Copy link"
                >
                  Copy link
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
