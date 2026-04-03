"use client";

import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  items: IdrItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  loading: boolean;
  isPreview?: boolean;
}

const BADGE_COLORS: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-400",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

const SYNC_INDICATOR: Record<string, { symbol: string; color: string }> = {
  DRAFT: { symbol: "\u25CB", color: "text-muted" },
  SYNCED: { symbol: "\u2713", color: "text-emerald-500" },
  FAILED: { symbol: "\u2717", color: "text-red-500" },
};

/** Parse project number and customer name from dealName like "PROJ-1234 | Smith, John | 123 Main St" */
function parseDealLabel(dealName: string): { projNum: string | null; fullName: string } {
  const parts = dealName.split("|").map((s) => s.trim());
  // Extract PROJ-XXXX from the first segment
  const projMatch = parts[0]?.match(/PROJ-\d+/);
  const projNum = projMatch?.[0] ?? null;
  // Name is usually the second segment; fall back to first
  const namePart = parts[1] ?? parts[0] ?? dealName;
  // If "Last, First" format, flip to "First Last"
  const comma = namePart.indexOf(",");
  if (comma > 0) {
    const last = namePart.slice(0, comma).trim();
    const first = namePart.slice(comma + 1).trim();
    return { projNum, fullName: first ? `${first} ${last}` : last };
  }
  return { projNum, fullName: namePart.trim() };
}

// Custom region sort order — CO shops first (meeting priority), then CA
const REGION_ORDER: Record<string, number> = {
  Centennial: 0,
  Westminster: 1,
  "Colorado Springs": 2,
  "San Luis Obispo": 3,
  Camarillo: 4,
};

function regionSortKey(region: string): number {
  return REGION_ORDER[region] ?? 99;
}

export function ProjectQueue({ items, selectedItemId, onSelectItem, loading, isPreview }: Props) {
  // Group by region
  const regionGroups = new Map<string, IdrItem[]>();
  for (const item of items) {
    const region = item.region || "Unknown";
    if (!regionGroups.has(region)) regionGroups.set(region, []);
    regionGroups.get(region)!.push(item);
  }

  if (loading) {
    return (
      <div className="w-72 shrink-0 rounded-xl border border-t-border bg-surface p-4">
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 rounded bg-surface-2 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0 rounded-xl border border-t-border bg-surface overflow-y-auto">
      {items.length === 0 && (
        <div className="p-4 text-sm text-muted text-center">No projects in this session.</div>
      )}

      {[...regionGroups.entries()]
        .sort((a, b) => regionSortKey(a[0]) - regionSortKey(b[0]))
        .map(([region, regionItems]) => (
          <div key={region}>
            {/* Region header */}
            <div className="sticky top-0 z-10 bg-surface border-b border-t-border px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {region}
              </span>
            </div>

            {/* Items */}
            {regionItems
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((item) => {
                const sync = SYNC_INDICATOR[item.hubspotSyncStatus] ?? SYNC_INDICATOR.DRAFT;
                const isSelected = item.id === selectedItemId;

                return (
                  <button
                    key={item.id}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors hover:bg-surface-2 ${
                      isSelected ? "bg-surface-2" : ""
                    }`}
                    onClick={() => onSelectItem(item.id)}
                  >
                    {/* Badge dot */}
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${BADGE_COLORS[item.badge] ?? "bg-zinc-400"}`}
                    />

                    {/* Returning indicator */}
                    {item.isReturning && (
                      <span className="text-xs shrink-0" title="Returning from prior meeting">
                        &#8617;
                      </span>
                    )}

                    {/* Escalation prefix */}
                    {item.type === "ESCALATION" && (
                      <span className="text-xs text-orange-500 shrink-0" title="Escalation">
                        &#9889;
                      </span>
                    )}

                    {/* Project number + Name */}
                    <span className="truncate text-foreground">
                      {(() => {
                        const { projNum, fullName } = parseDealLabel(item.dealName);
                        return projNum ? `${projNum} ${fullName}` : fullName;
                      })()}
                    </span>

                    {/* Sync indicator */}
                    <span className={`ml-auto shrink-0 text-xs ${sync.color}`}>
                      {sync.symbol}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
    </div>
  );
}
