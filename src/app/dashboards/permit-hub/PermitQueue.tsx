"use client";

import { useMemo, useState } from "react";
import type { PermitQueueItem } from "@/lib/permit-hub";

interface Props {
  items: PermitQueueItem[];
  isLoading: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
}

export function PermitQueue({ items, isLoading, selectedDealId, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const locations = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      if (i.pbLocation) s.add(i.pbLocation);
    });
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (locationFilter !== "all") {
      list = list.filter((i) => i.pbLocation === locationFilter);
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
  }, [items, search, locationFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-t-border px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, address, lead..."
          className="border-t-border bg-surface-2 flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5 text-sm"
        >
          <option value="all">All</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>
      <div className="text-muted flex items-center justify-between border-b border-t-border px-4 py-2 text-xs">
        <span>
          {filtered.length} of {items.length} · stalest first
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
          <ul className="divide-t-border divide-y">
            {filtered.map((item) => {
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
        )}
      </div>
    </div>
  );
}
