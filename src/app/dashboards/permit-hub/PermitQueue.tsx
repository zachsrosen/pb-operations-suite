"use client";

import { useMemo, useState } from "react";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import type { PermitQueueItem } from "@/lib/permit-hub";
import type { PermitActionKind } from "@/lib/pi-statuses";

interface Props {
  items: PermitQueueItem[];
  isLoading: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
}

/**
 * Queue groups map the internal action kinds to the three work buckets Peter
 * thinks in: "Ready to Submit" (new work going out), "Resubmit" (responses
 * to AHJ rejections / returned from design), and "Waiting / Follow Up"
 * (submitted, awaiting utility/AHJ decision — chase if stale).
 */
const GROUP_ORDER = ["ready", "resubmit", "follow_up"] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

const GROUP_LABELS: Record<GroupKey, string> = {
  ready: "Ready to Submit",
  resubmit: "Resubmit",
  follow_up: "Waiting / Follow Up",
};

function groupForActionKind(kind: PermitActionKind | null): GroupKey {
  switch (kind) {
    case "SUBMIT_TO_AHJ":
    case "SUBMIT_SOLARAPP":
      return "ready";
    case "RESUBMIT_TO_AHJ":
    case "REVIEW_REJECTION":
    case "COMPLETE_REVISION":
    case "START_AS_BUILT_REVISION":
    case "COMPLETE_AS_BUILT":
      return "resubmit";
    case "FOLLOW_UP":
    case "MARK_PERMIT_ISSUED":
    default:
      return "follow_up";
  }
}

/** Sentinel value representing unassigned permits in the lead filter. */
const UNASSIGNED = "__unassigned__";

export function PermitQueue({ items, isLoading, selectedDealId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);

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
      if (i.permitLead) named.add(i.permitLead);
      else hasUnassigned = true;
    });
    const opts: FilterOption[] = Array.from(named)
      .sort()
      .map((name) => ({ value: name, label: name }));
    if (hasUnassigned) {
      opts.push({ value: UNASSIGNED, label: "Unassigned" });
    }
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
        i.permitLead ? set.has(i.permitLead) : set.has(UNASSIGNED),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.permitLead?.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, search, selectedLocations, selectedLeads]);

  const groups = useMemo(() => {
    const map: Record<GroupKey, PermitQueueItem[]> = {
      ready: [],
      resubmit: [],
      follow_up: [],
    };
    for (const item of filtered) {
      map[groupForActionKind(item.actionKind)].push(item);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-t-border px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, address, lead..."
          className="border-t-border bg-surface-2 w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            placeholder="All locations"
            accentColor="blue"
          />
          <MultiSelectFilter
            label="Permit Lead"
            options={leadOptions}
            selected={selectedLeads}
            onChange={setSelectedLeads}
            placeholder="All leads"
            accentColor="blue"
          />
        </div>
      </div>
      <div className="text-muted flex items-center justify-between border-b border-t-border px-4 py-2 text-xs">
        <span>
          {filtered.length} of {items.length} · grouped by action, stalest first
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-2 h-14 w-full animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">
            No action items in queue
          </div>
        ) : (
          <div>
            {GROUP_ORDER.map((key) => {
              const groupItems = groups[key];
              if (groupItems.length === 0) return null;
              return (
                <section key={key}>
                  <header className="bg-surface-2/60 text-muted sticky top-0 z-10 flex items-center justify-between border-y border-t-border px-4 py-1.5 text-xs font-semibold uppercase tracking-wide backdrop-blur">
                    <span>{GROUP_LABELS[key]}</span>
                    <span className="font-normal normal-case tracking-normal">
                      {groupItems.length}
                    </span>
                  </header>
                  <ul className="divide-t-border divide-y">
                    {groupItems.map((item) => {
                      const selected = item.dealId === selectedDealId;
                      return (
                        <li key={item.dealId}>
                          <button
                            type="button"
                            onClick={() => onSelect(item.dealId)}
                            className={`w-full px-4 py-3 text-left transition-colors ${
                              selected ? "bg-blue-500/10" : "hover:bg-surface-2"
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
                              <span className="text-muted">{item.status}</span>
                              <span className="font-medium text-blue-600 dark:text-blue-400">
                                {item.actionLabel}
                              </span>
                            </div>
                            <div className="text-muted mt-1 text-xs">
                              {item.daysInStatus}d · {item.permitLead ?? "Unassigned"}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
