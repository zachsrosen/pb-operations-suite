"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SerializedAdderRevision } from "./types";

export interface AdderRevisionsDrawerProps {
  open: boolean;
  onClose: () => void;
  adderId: string | null;
  adderCode?: string;
}

async function fetchRevisions(adderId: string): Promise<SerializedAdderRevision[]> {
  const r = await fetch(`/api/adders/${adderId}/revisions`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { revisions?: SerializedAdderRevision[] };
  return json.revisions ?? [];
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function AdderRevisionsDrawer({
  open,
  onClose,
  adderId,
  adderCode,
}: AdderRevisionsDrawerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["adder-revisions", adderId],
    queryFn: () => fetchRevisions(adderId as string),
    enabled: open && !!adderId,
  });

  if (!open || !adderId) return null;

  // Newest first for display
  const revisions = (data ?? []).slice().sort((a, b) =>
    b.changedAt.localeCompare(a.changedAt)
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-surface shadow-card-lg">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-t-border bg-surface-2 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Revision History</h2>
            {adderCode && <p className="text-xs text-muted">{adderCode}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {isLoading && (
            <p className="animate-pulse py-8 text-center text-sm text-muted">
              Loading revisions…
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          )}
          {!isLoading && !error && revisions.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No revisions yet.</p>
          )}
          {revisions.map((rev) => (
            <div
              key={rev.id}
              className="overflow-hidden rounded-lg border border-t-border bg-surface"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => (prev === rev.id ? null : rev.id))
                }
                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {rev.changeNote || "(no note)"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span>{rev.changedBy}</span>
                    <span>•</span>
                    <span title={rev.changedAt}>{relativeTime(rev.changedAt)}</span>
                  </div>
                </div>
                <span className="text-xs text-muted">
                  {expanded === rev.id ? "Hide" : "View"}
                </span>
              </button>
              {expanded === rev.id && (
                <pre className="max-h-80 overflow-auto border-t border-t-border bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(rev.snapshot, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
