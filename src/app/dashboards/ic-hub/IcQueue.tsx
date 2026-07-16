"use client";

import { useMemo, useState } from "react";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import type { IcQueueItem } from "@/lib/ic-hub";
import type { IcActionKind } from "@/lib/pi-statuses";

interface Props {
  items: IcQueueItem[];
  isLoading: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
}

const GROUP_ORDER = ["ready", "resubmit", "follow_up"] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_LABELS: Record<GroupKey, string> = {
  ready: "Ready to Submit",
  resubmit: "Resubmit / Revision",
  follow_up: "Waiting / Follow Up",
};

function groupForActionKind(kind: IcActionKind | null): GroupKey {
  switch (kind) {
    case "SUBMIT_TO_UTILITY":
      return "ready";
    case "RESUBMIT_TO_UTILITY":
    case "REVIEW_IC_REJECTION":
    case "COMPLETE_IC_REVISION":
    case "PROVIDE_INFORMATION":
      return "resubmit";
    case "FOLLOW_UP_UTILITY":
    case "MARK_IC_APPROVED":
    default:
      return "follow_up";
  }
}

const UNASSIGNED = "__unassigned__";

export function IcQueue({ items, isLoading, selectedDealId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  // Default to the most actionable bucket — new work going out.
  const [activeTab, setActiveTab] = useState<GroupKey>("ready");

  const locationOptions: FilterOption[] = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      if (i.pbLocation) s.add(i.pbLocation);
    });
    return Array.from(s)
      .sort()
      .map((loc) => ({ value: loc, label: loc }));
  }, [items]);

  const leadOptions: FilterOption[] = useMemo(() => {
    const named = new Set<string>();
    let hasUnassigned = false;
    items.forEach((i) => {
      if (i.icLead) named.add(i.icLead);
      else hasUnassigned = true;
    });
    const opts: FilterOption[] = Array.from(named)
      .sort()
      .map((name) => ({ value: name, label: name }));
    if (hasUnassigned) opts.push({ value: UNASSIGNED, label: "Unassigned" });
    return opts;
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (selectedLocations.length > 0) {
      const set = new Set(selectedLocations);
      list = list.filter((i) => i.pbLocation && set.has(i.pbLocation));
    }
    if (selectedLeads.length > 0) {
      const set = new Set(selectedLeads);
      list = list.filter((i) =>
        i.icLead ? set.has(i.icLead) : set.has(UNASSIGNED),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.icLead?.toLowerCase().includes(q) ||
          // Match either what's displayed (label) or the underlying value.
          i.statusLabel.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, search, selectedLocations, selectedLeads]);

  const groups = useMemo(() => {
    const map: Record<GroupKey, IcQueueItem[]> = {
      ready: [],
      resubmit: [],
      follow_up: [],
    };
    for (const item of filtered) {
      map[groupForActionKind(item.actionKind)].push(item);
    }
    return map;
  }, [filtered]);

  const activeItems = groups[activeTab];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-t-border px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, address, lead..."
          className="border-t-border bg-surface-2 w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            placeholder="All locations"
            accentColor="green"
          />
          <MultiSelectFilter
            label="IC Lead"
            options={leadOptions}
            selected={selectedLeads}
            onChange={setSelectedLeads}
            placeholder="All leads"
            accentColor="green"
          />
        </div>
      </div>
      <div className="text-muted flex items-center justify-between border-b border-t-border px-4 py-2 text-xs">
        <span>
          {filtered.length} of {items.length} · stalest first
        </span>
      </div>
      <div
        role="tablist"
        aria-label="Queue groups"
        className="flex items-center gap-1 border-b border-t-border px-2"
      >
        {GROUP_ORDER.map((key) => {
          const active = key === activeTab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-green-500 text-green-600 dark:text-green-400"
                  : "text-muted hover:text-foreground border-transparent"
              }`}
            >
              <span>{GROUP_LABELS[key]}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  active
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-surface-2 text-muted"
                }`}
              >
                {groups[key].length}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto" role="tabpanel">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-2 h-14 w-full animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : activeItems.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center px-4 text-center text-sm">
            {filtered.length === 0
              ? "No action items in queue"
              : `Nothing in ${GROUP_LABELS[activeTab]}`}
          </div>
        ) : (
          <ul className="divide-t-border divide-y">
            {activeItems.map((item) => {
              const selected = item.dealId === selectedDealId;
              return (
                <li key={item.dealId}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.dealId)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      selected ? "bg-green-500/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="text-muted truncate text-xs">
                          {item.address ?? "—"} · {item.pbLocation ?? "—"}
                        </div>
                      </div>
                      {item.isStale && (
                        <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                          Stale
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted">{item.statusLabel || item.status}</span>
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {item.actionLabel}
                      </span>
                    </div>
                    <div className="text-muted mt-1 text-xs">
                      {item.daysInStatus === null ? "—" : `${item.daysInStatus}d`} ·{" "}
                      {item.icLead ?? "Unassigned"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
