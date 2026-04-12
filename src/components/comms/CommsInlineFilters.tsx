"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sourcesEnabled: Record<string, boolean>;
  onSourceToggle: (source: string) => void;
  readFilter: "all" | "unread" | "read";
  onReadFilterChange: (f: "all" | "unread" | "read") => void;
  sortBy: "date" | "sender";
  onSortChange: (s: "date" | "sender") => void;
  activeKpiFilter: string | null;
  onClearKpiFilter: () => void;
}

const SOURCE_OPTIONS = [
  { value: "gmail", label: "Gmail", color: "#ea4335" },
  { value: "hubspot", label: "HubSpot", color: "#ff7a59" },
  { value: "chat", label: "Chat", color: "#0f9d58" },
];

export default function CommsInlineFilters({
  searchQuery,
  onSearchChange,
  sourcesEnabled,
  onSourceToggle,
  readFilter,
  onReadFilterChange,
  sortBy,
  onSortChange,
  activeKpiFilter,
  onClearKpiFilter,
}: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sourceRef.current && !sourceRef.current.contains(e.target as Node)) {
        setSourceOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const enabledCount = Object.values(sourcesEnabled).filter(Boolean).length;

  return (
    <div className="space-y-2 mb-3">
      {/* Active KPI filter banner */}
      {activeKpiFilter && (
        <div className="flex items-center gap-2 rounded-lg bg-surface-elevated/80 px-3 py-1.5 text-xs">
          <span className="text-muted/50 font-semibold uppercase tracking-wide text-[10px]">
            Filtered by
          </span>
          <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 font-medium text-cyan-400 ring-1 ring-cyan-500/20">
            {activeKpiFilter}
          </span>
          <button
            onClick={onClearKpiFilter}
            className="ml-auto text-muted/50 hover:text-red-400 transition-colors text-xs font-semibold"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-surface/50 px-3 py-2.5">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name, subject, project #..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-t-border/30 bg-surface/80 pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted/40 focus:border-cyan-500/40 focus:bg-surface focus:outline-none transition-colors"
          />
        </div>

        {/* Source multi-select dropdown */}
        <div className="relative" ref={sourceRef}>
          <button
            onClick={() => setSourceOpen(!sourceOpen)}
            className="flex items-center gap-2 rounded-lg border border-t-border/30 bg-surface/80 px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-surface transition-colors"
          >
            <span>Sources</span>
            <span className="rounded-full bg-cyan-500/15 px-1.5 text-[10px] font-semibold text-cyan-400">
              {enabledCount}
            </span>
            <svg className="h-3 w-3 text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {sourceOpen && (
            <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[180px] rounded-xl border border-t-border/30 bg-surface-elevated p-2 shadow-xl">
              {SOURCE_OPTIONS.map((s) => (
                <label
                  key={s.value}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm cursor-pointer hover:bg-surface-2/40 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={sourcesEnabled[s.value] !== false}
                    onChange={() => onSourceToggle(s.value)}
                    className="h-3.5 w-3.5 rounded accent-cyan-500"
                  />
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: s.color }}
                  />
                  <span className="text-foreground/80">{s.label}</span>
                </label>
              ))}
              <div className="mt-1 flex gap-1 border-t border-t-border/20 pt-1.5">
                <button
                  onClick={() => SOURCE_OPTIONS.forEach((s) => {
                    if (!sourcesEnabled[s.value]) onSourceToggle(s.value);
                  })}
                  className="flex-1 rounded-md py-1 text-[11px] font-medium text-muted/60 hover:bg-surface-2/40 transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() => SOURCE_OPTIONS.forEach((s) => {
                    if (sourcesEnabled[s.value] !== false) onSourceToggle(s.value);
                  })}
                  className="flex-1 rounded-md py-1 text-[11px] font-medium text-muted/60 hover:bg-surface-2/40 transition-colors"
                >
                  None
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Read status filter */}
        <div className="flex items-center gap-0.5 rounded-lg border border-t-border/30 bg-surface/80 p-0.5">
          {(["all", "unread", "read"] as const).map((f) => (
            <button
              key={f}
              onClick={() => onReadFilterChange(f)}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                readFilter === f
                  ? "bg-cyan-500/15 text-cyan-400 shadow-sm"
                  : "text-muted/50 hover:text-foreground/70"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5 rounded-lg border border-t-border/30 bg-surface/80 px-2.5 py-1.5">
          <svg className="h-3 w-3 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as "date" | "sender")}
            className="bg-transparent text-xs font-semibold text-foreground/70 outline-none cursor-pointer"
          >
            <option value="date">Newest</option>
            <option value="sender">Sender</option>
          </select>
        </div>
      </div>
    </div>
  );
}
