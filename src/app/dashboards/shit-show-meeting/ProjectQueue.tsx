"use client";

import { useMemo, useState } from "react";
import type { ShitShowItem } from "./types";
import { DECISION_PILL } from "./types";

export function ProjectQueue({
  items,
  selectedId,
  onSelect,
  priorCounts,
}: {
  items: ShitShowItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** dealId → number of prior shit-show sessions (excluding the current one). */
  priorCounts: Map<string, number>;
}) {
  const grouped = useMemo(() => groupByRegion(items), [items]);
  const regions = Array.from(grouped.keys()).sort();

  return (
    <div className="overflow-y-auto h-full">
      {regions.length === 0 && (
        <div className="text-sm text-muted px-4 py-6 text-center">
          Queue empty.
          <div className="text-xs mt-1">
            No deals are currently flagged 🔥 in HubSpot. Use &ldquo;+ Add a deal&rdquo; to flag one,
            or toggle the 🔥 flag on a deal in the IDR Meeting hub.
          </div>
        </div>
      )}
      {regions.map((region) => (
        <RegionGroup
          key={region}
          region={region}
          items={grouped.get(region)!}
          selectedId={selectedId}
          onSelect={onSelect}
          priorCounts={priorCounts}
        />
      ))}
    </div>
  );
}

function RegionGroup({
  region,
  items,
  selectedId,
  onSelect,
  priorCounts,
}: {
  region: string;
  items: ShitShowItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  priorCounts: Map<string, number>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full sticky top-0 bg-surface-2 border-b border-t-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted z-10"
      >
        {open ? "▾" : "▸"} {region} <span className="text-muted/60">({items.length})</span>
      </button>
      {open && items.map((item) => {
        const pill = DECISION_PILL[item.decision];
        const priors = priorCounts.get(item.dealId) ?? 0;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full text-left px-3 py-2 border-b border-t-border/40 hover:bg-surface-2 transition ${
              selectedId === item.id ? "bg-surface-2" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground truncate flex-1">{item.dealName}</span>
              {priors > 0 && (
                <span
                  className="text-[10px] text-orange-400 shrink-0"
                  title={`Discussed in ${priors} prior session${priors === 1 ? "" : "s"}`}
                >
                  🔥 {priors + 1}x
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-xs text-muted">
                {item.dealAmount ? `$${(item.dealAmount / 1000).toFixed(0)}k` : "—"}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${pill.bg} ${pill.text}`}
              >
                {pill.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function groupByRegion(items: ShitShowItem[]): Map<string, ShitShowItem[]> {
  const groups = new Map<string, ShitShowItem[]>();
  for (const item of items) {
    const key = item.region || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  // Sort each region by flaggedSince ascending (oldest first); nulls last
  for (const list of groups.values()) {
    list.sort((a, b) => {
      if (!a.flaggedSince && !b.flaggedSince) return 0;
      if (!a.flaggedSince) return 1;
      if (!b.flaggedSince) return -1;
      return new Date(a.flaggedSince).getTime() - new Date(b.flaggedSince).getTime();
    });
  }
  return groups;
}
