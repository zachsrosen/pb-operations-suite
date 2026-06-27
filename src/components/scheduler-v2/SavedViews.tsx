"use client";

import { useEffect, useRef, useState } from "react";
import { useBoardFilters, type BoardFilters } from "./useBoardFilters";

/**
 * Preset "saved views". Each one is just a known filter combination encoded
 * into the URL (no persistence backend). Selecting a preset replaces the
 * current filter state with its definition.
 *
 * The 4 presets (filter definitions):
 *
 *  1. "Unscheduled this week"  → stages: ["unscheduled"]
 *       Shows only work items not yet placed (status unscheduled). The board's
 *       own week window scopes the time range; this view isolates the pool that
 *       still needs a slot.
 *
 *  2. "Over-capacity crews"    → workTypes: ["install"]
 *       Narrows to install/construction work — the only work type that consumes
 *       crew-day capacity on the board — so the red capacity bars (>120% load)
 *       stand out. (Survey/inspection do not load crew capacity.)
 *
 *  3. "Overdue"                → stages: [] (no stage filter); relies on the
 *       AttentionStrip "overdue" toggle for the row-level highlight, but as a
 *       saved view we clear all filters so every overdue item across types is
 *       visible. Encoded as EMPTY so the board shows all rows and the overdue
 *       ring (already rendered by JobBar) is unobscured.
 *
 *  4. "Today by crew"          → clears filters (all crews/locations) so the
 *       board shows every crew row; the user lands on "Today" via the board's
 *       Today button. Encoded as EMPTY filters (full board, grouped by crew/
 *       location as the board already does).
 *
 * Presets 3 and 4 intentionally encode to empty filters because their intent is
 * a board posture (today / overdue highlight) rather than a row exclusion, and
 * removing rows would hide the very items the view is about.
 */
interface SavedView {
  id: string;
  label: string;
  description: string;
  filters: BoardFilters;
}

const SAVED_VIEWS: SavedView[] = [
  {
    id: "unscheduled-this-week",
    label: "Unscheduled this week",
    description: "Items with no scheduled slot, within the current week window",
    filters: {
      locations: [],
      crews: [],
      workTypes: [],
      stages: ["unscheduled"],
      search: "",
    },
  },
  {
    id: "over-capacity-crews",
    label: "Over-capacity crews",
    description: "Install/construction work — watch for red capacity bars",
    filters: {
      locations: [],
      crews: [],
      workTypes: ["install"],
      stages: [],
      search: "",
    },
  },
  {
    id: "overdue",
    label: "Overdue",
    description: "All work types — overdue items keep their red ring",
    filters: {
      locations: [],
      crews: [],
      workTypes: [],
      stages: [],
      search: "",
    },
  },
  {
    id: "today-by-crew",
    label: "Today by crew",
    description: "Full board grouped by crew; use Today to jump to now",
    filters: {
      locations: [],
      crews: [],
      workTypes: [],
      stages: [],
      search: "",
    },
  },
];

export function SavedViews() {
  const { setFilters, resetFilters } = useBoardFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const applyView = (view: SavedView) => {
    // Replace state wholesale: clear then set the preset's filters.
    resetFilters();
    setFilters(view.filters);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground/80 transition-colors hover:border-muted"
      >
        <svg
          className="h-4 w-4 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 5a2 2 0 012-2h6l6 6v10a2 2 0 01-2 2H7a2 2 0 01-2-2V5z"
          />
        </svg>
        <span className="font-medium">Saved views</span>
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-t-border bg-surface shadow-card-lg">
          {SAVED_VIEWS.map((view) => (
            <button
              key={view.id}
              onClick={() => applyView(view)}
              className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            >
              <div className="text-sm font-medium text-foreground">
                {view.label}
              </div>
              <div className="text-xs text-muted">{view.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
