"use client";

/**
 * UndoSnackbar — appears after a successful schedule write and offers to revert
 * to the item's previous date/resource.
 *
 * SAFETY: Undo is itself a write. It does NOT auto-fire against production —
 * clicking "Undo" re-opens the ScheduleDrawer pre-filled with the PREVIOUS
 * date/resource (same explicit human-confirm + testMode posture as a forward
 * write). The snackbar only constructs the inverse target; the drawer commits it.
 */

import { useEffect } from "react";
import type { Resource, WorkItem } from "@/lib/scheduler-v2/types";

export interface UndoTarget {
  item: WorkItem;
  /** Where the item was BEFORE the write that just succeeded. */
  previousDate?: string;
  previousResource?: Resource;
  /** What we just moved it to (for the message). */
  newDate: string;
  newResourceName: string;
}

export interface UndoSnackbarProps {
  target: UndoTarget | null;
  /** Re-open the drawer pre-filled with the inverse (previous) target. */
  onUndo: (target: UndoTarget) => void;
  onDismiss: () => void;
  /** Auto-dismiss after this many ms (default 8s). */
  timeoutMs?: number;
}

export function UndoSnackbar({ target, onUndo, onDismiss, timeoutMs = 8000 }: UndoSnackbarProps) {
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(onDismiss, timeoutMs);
    return () => clearTimeout(t);
  }, [target, onDismiss, timeoutMs]);

  if (!target) return null;

  // Undo is only meaningful when we know the previous placement.
  const canUndo = Boolean(target.previousDate && target.previousResource);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slideUp">
      <div className="flex items-center gap-3 rounded-lg border border-t-border bg-surface-elevated px-4 py-2.5 shadow-card">
        <span className="text-sm text-foreground">
          Moved to <span className="font-medium">{target.newResourceName}</span> on{" "}
          <span className="font-mono">{target.newDate}</span>.
        </span>
        {canUndo ? (
          <button
            type="button"
            onClick={() => onUndo(target)}
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
          >
            Undo
          </button>
        ) : (
          <span className="text-[0.65rem] text-muted">(no previous slot to revert to)</span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
