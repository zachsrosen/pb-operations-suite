"use client";

/**
 * scheduler-v2 — shared drag/drop payload helpers + the live conflict-probe hook.
 *
 * Drag source: JobBar (scheduled bars) and UnscheduledQueue cards serialize the
 * WorkItem id into the native dataTransfer. Drop target: BoardRow day cells read
 * it back, look the item up, and call the board's onDrop handler.
 *
 * NOTHING here performs a schedule write. Conflict probing is read-only
 * (POST /conflicts) and drop only opens the ScheduleDrawer / quick-confirm.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConflictResult } from "@/lib/scheduler-v2/types";

export const DRAG_MIME = "application/x-pb-scheduler-v2-workitem";

/** Serialize the dragged WorkItem id onto a dragstart event. */
export function setDragPayload(e: React.DragEvent, workItemId: string) {
  e.dataTransfer.setData(DRAG_MIME, workItemId);
  // Plain-text fallback so the OS shows a sensible drag image / other targets work.
  e.dataTransfer.setData("text/plain", workItemId);
  e.dataTransfer.effectAllowed = "move";
}

/** Read the dragged WorkItem id back on drop/dragover. Returns "" when absent. */
export function getDragPayload(e: React.DragEvent): string {
  return e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain") || "";
}

/**
 * A live conflict probe with built-in debounce.
 *
 * Call `probe({...})` repeatedly on drag-over a cell; the hook debounces network
 * calls (default 200ms) and exposes the latest `result` keyed by a target string
 * so a stale response for a previous cell never overwrites the current one.
 *
 * Read-only: hits POST /api/scheduler-v2/conflicts and never writes.
 */
export interface ProbeArgs {
  /** Stable key for the hovered target (e.g. `${resourceId}|${date}`). */
  targetKey: string;
  workItemId: string;
  dealId?: string;
  resourceId: string;
  location: string;
  date: string;
  days: number;
  startTime?: string;
  endTime?: string;
  workType: string;
}

export interface ConflictProbeState {
  /** The target currently reflected by `result` (or being fetched). */
  targetKey: string | null;
  result: ConflictResult | null;
  loading: boolean;
}

export function useConflictProbe(debounceMs = 200) {
  const [state, setState] = useState<ConflictProbeState>({
    targetKey: null,
    result: null,
    loading: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic request id so out-of-order responses are dropped.
  const reqId = useRef(0);
  const lastKey = useRef<string | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (abortRef.current) abortRef.current.abort();
    lastKey.current = null;
    setState({ targetKey: null, result: null, loading: false });
  }, []);

  const probe = useCallback(
    (args: ProbeArgs) => {
      // Skip if we're already showing/fetching this exact target.
      if (lastKey.current === args.targetKey) return;
      lastKey.current = args.targetKey;

      if (timer.current) clearTimeout(timer.current);
      setState((s) => ({ ...s, targetKey: args.targetKey, loading: true }));

      timer.current = setTimeout(async () => {
        const myReq = ++reqId.current;
        if (abortRef.current) abortRef.current.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        try {
          const res = await fetch("/api/scheduler-v2/conflicts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: ac.signal,
            body: JSON.stringify({
              workItemId: args.workItemId,
              dealId: args.dealId,
              resourceId: args.resourceId,
              location: args.location,
              date: args.date,
              days: args.days,
              startTime: args.startTime,
              endTime: args.endTime,
              workType: args.workType,
            }),
          });
          if (myReq !== reqId.current) return; // superseded
          if (!res.ok) {
            // Fail-open: a probe error should not block the drop.
            setState({ targetKey: args.targetKey, result: null, loading: false });
            return;
          }
          const result = (await res.json()) as ConflictResult;
          if (myReq !== reqId.current) return;
          setState({ targetKey: args.targetKey, result, loading: false });
        } catch {
          if (myReq !== reqId.current) return;
          setState({ targetKey: args.targetKey, result: null, loading: false });
        }
      }, debounceMs);
    },
    [debounceMs],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { state, probe, clear };
}

/** True when a conflict result has any hard flag (drop must be blocked). */
export function hasHardConflict(result: ConflictResult | null): boolean {
  return Boolean(result && result.hard.length > 0);
}
