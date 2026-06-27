"use client";

import { useCallback, useEffect, useState } from "react";

/** The four phase-1 lenses over the same filtered BoardData. */
export type SchedulerV2View = "board" | "week" | "month" | "gantt";

const VIEWS: { id: SchedulerV2View; label: string; key: string }[] = [
  { id: "board", label: "Board", key: "b" },
  { id: "week", label: "Week", key: "w" },
  { id: "month", label: "Month", key: "m" },
  { id: "gantt", label: "Gantt", key: "g" },
];

const STORAGE_KEY = "scheduler-v2:view";

function isView(v: unknown): v is SchedulerV2View {
  return v === "board" || v === "week" || v === "month" || v === "gantt";
}

/**
 * localStorage-backed view selection. Mirrors the persistence shape of
 * `useViewMode` in components/scheduler/ViewModeToggle.tsx:
 *   - lazy read on mount (SSR-safe default)
 *   - cross-tab sync via the `storage` event
 *   - write-through on every change
 */
export function useSchedulerV2View(): [SchedulerV2View, (v: SchedulerV2View) => void] {
  const [view, setView] = useState<SchedulerV2View>(() => {
    if (typeof window === "undefined") return "board";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isView(stored)) return stored;
    } catch {
      /* private browsing */
    }
    return "board";
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isView(e.newValue)) setView(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const set = useCallback((v: SchedulerV2View) => {
    setView(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* localStorage unavailable — selection persists in-memory only */
    }
  }, []);

  return [view, set];
}

export interface ViewSwitcherProps {
  value: SchedulerV2View;
  onChange: (v: SchedulerV2View) => void;
  /** Disable the single-key (b/w/m/g) shortcuts (e.g. when a modal owns the keyboard). */
  shortcutsEnabled?: boolean;
}

/**
 * Segmented control: Board · Week · Month · Gantt.
 * Single-key shortcuts (b/w/m/g) are wired globally but suppressed when the user
 * is typing in an input/textarea/select or a contentEditable region, and when a
 * modifier key is held (so ⌘K etc. are untouched).
 */
export function ViewSwitcher({
  value,
  onChange,
  shortcutsEnabled = true,
}: ViewSwitcherProps) {
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const match = VIEWS.find((v) => v.key === e.key.toLowerCase());
      if (match) {
        e.preventDefault();
        onChange(match.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsEnabled, onChange]);

  return (
    <div
      className="inline-flex rounded-md border border-t-border bg-surface"
      role="tablist"
      aria-label="Scheduler view"
    >
      {VIEWS.map((v) => {
        const active = value === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${v.label} (${v.key})`}
            onClick={() => onChange(v.id)}
            className={`px-3 py-1.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md ${
              active
                ? "bg-surface-2 font-medium text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {v.label}
            <span className="ml-1 hidden opacity-50 sm:inline">{v.key}</span>
          </button>
        );
      })}
    </div>
  );
}
