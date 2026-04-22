"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Draft state persisted to localStorage keyed by run ID.
 *
 * Reads on mount, writes on every change. Network failure on the server-side
 * PATCH shouldn't block UX — the draft stays dirty and we retry on next
 * answer change. Clear on successful submit.
 */
export type TriageDraft = {
  answers: Record<string, unknown>;
  stepIndex: number;
  uncheckedReasons: Record<string, string>;
  uncheckedCodes: string[];
  savedAt: string;
};

const EMPTY_DRAFT: TriageDraft = {
  answers: {},
  stepIndex: 0,
  uncheckedReasons: {},
  uncheckedCodes: [],
  savedAt: new Date(0).toISOString(),
};

function storageKey(runId: string): string {
  return `triage-draft-${runId}`;
}

/**
 * Read the stored draft for a run. Safe in SSR (returns null on server).
 * Exported for use in tests.
 */
export function readDraft(runId: string): TriageDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(runId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      answers:
        parsed.answers && typeof parsed.answers === "object"
          ? (parsed.answers as Record<string, unknown>)
          : {},
      stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
      uncheckedReasons:
        parsed.uncheckedReasons && typeof parsed.uncheckedReasons === "object"
          ? (parsed.uncheckedReasons as Record<string, string>)
          : {},
      uncheckedCodes: Array.isArray(parsed.uncheckedCodes)
        ? (parsed.uncheckedCodes as string[])
        : [],
      savedAt:
        typeof parsed.savedAt === "string"
          ? parsed.savedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeDraft(runId: string, draft: TriageDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(runId), JSON.stringify(draft));
  } catch {
    /* ignore — quota exceeded or private mode */
  }
}

export function clearDraft(runId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(runId));
  } catch {
    /* ignore */
  }
}

/**
 * React hook wrapper. `runId` may be null/undefined during the deal-lookup
 * step; in that case the hook is inert (returns EMPTY_DRAFT, setters no-op).
 */
export function useOfflineDraft(runId: string | null | undefined) {
  const [draft, setDraftState] = useState<TriageDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!runId) {
      setDraftState(EMPTY_DRAFT);
      setHydrated(true);
      return;
    }
    const stored = readDraft(runId);
    setDraftState(stored ?? EMPTY_DRAFT);
    setHydrated(true);
  }, [runId]);

  const setDraft = useCallback(
    (
      next: TriageDraft | ((prev: TriageDraft) => TriageDraft)
    ): void => {
      setDraftState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        const stamped = { ...resolved, savedAt: new Date().toISOString() };
        if (runId) writeDraft(runId, stamped);
        return stamped;
      });
    },
    [runId]
  );

  const clear = useCallback(() => {
    if (runId) clearDraft(runId);
    setDraftState(EMPTY_DRAFT);
  }, [runId]);

  return { draft, setDraft, clear, hydrated };
}
