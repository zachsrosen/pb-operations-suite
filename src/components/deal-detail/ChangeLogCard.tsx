"use client";

import { useState } from "react";
import type { ChangeLogEntry } from "./types";

interface ChangeLogCardProps {
  entries: ChangeLogEntry[];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFieldName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (val instanceof Date || (typeof val === "string" && /^\d{4}-\d{2}-\d{2}T/.test(val))) {
    return new Date(String(val).split("T")[0] + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  return String(val);
}

function ChangeEntry({ entry }: { entry: ChangeLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const changes = entry.changesDetected;
  const changeCount = changes ? Object.keys(changes).length : 0;

  return (
    <div className="border-b border-t-border/50 py-1.5 last:border-0">
      <button
        onClick={() => changeCount > 0 && setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div>
          <span className="text-[10px] font-medium text-foreground">
            {changeCount} field{changeCount !== 1 ? "s" : ""} updated
          </span>
          <span className="ml-1.5 text-[9px] text-muted">
            via {entry.source.replace("single:", "").replace("batch:", "")}
          </span>
        </div>
        <span className="whitespace-nowrap text-[9px] text-muted">
          {formatTime(entry.createdAt)}
        </span>
      </button>
      {expanded && changes && (
        <div className="mt-1 space-y-0.5 pl-1">
          {Object.entries(changes).map(([field, [oldVal, newVal]]) => (
            <div key={field} className="text-[9px]">
              <span className="font-medium text-muted">{formatFieldName(field)}:</span>{" "}
              <span className="text-red-400 line-through">{formatValue(oldVal)}</span>
              {" → "}
              <span className="text-green-400">{formatValue(newVal)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChangeLogCard({ entries }: ChangeLogCardProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Recent Changes
      </h3>
      <div>
        {entries.map((entry) => (
          <ChangeEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
