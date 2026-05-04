"use client";

import { useState, useEffect, useCallback } from "react";

export type ViewMode = "compact" | "breakdown";

export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-t-border bg-surface" role="tablist">
      <button
        role="tab"
        aria-selected={value === "compact"}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === "compact"
            ? "bg-surface-2 text-foreground font-medium"
            : "text-muted hover:text-foreground"
        }`}
        onClick={() => onChange("compact")}
      >
        Compact
      </button>
      <button
        role="tab"
        aria-selected={value === "breakdown"}
        className={`px-3 py-1.5 text-xs transition-colors ${
          value === "breakdown"
            ? "bg-surface-2 text-foreground font-medium"
            : "text-muted hover:text-foreground"
        }`}
        onClick={() => onChange("breakdown")}
      >
        Breakdown
      </button>
    </div>
  );
}

export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "compact";
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "breakdown" || stored === "compact") return stored;
    } catch { /* private browsing */ }
    return "compact";
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey && (e.newValue === "compact" || e.newValue === "breakdown")) {
        setMode(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  const set = useCallback(
    (m: ViewMode) => {
      setMode(m);
      try {
        window.localStorage.setItem(storageKey, m);
      } catch {
        // localStorage unavailable — mode persists in-memory only
      }
    },
    [storageKey],
  );

  return [mode, set];
}
