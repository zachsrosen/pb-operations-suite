"use client";

import { useMemo, useState } from "react";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import { GROUP_ORDER, type GroupKey, type QueueItem, type Team } from "@/lib/pi-hub/types";
import { StatusDropdown } from "./StatusDropdown";
import { ACCENTS, type Accent } from "./accents";
import {
  SIGNAL_CHIP_ACTIVE_CLASS,
  SIGNAL_CHIP_CLASS,
  SIGNAL_PILL_CLASS,
  signalLabel,
} from "./signal-ui";

interface Props {
  items: QueueItem[];
  isLoading: boolean;
  /** True while a team switch is showing the PREVIOUS team's rows as
   *  placeholder — a cold queue load can take 30-60s, and without a visible
   *  state the switch reads as a no-op. */
  isSwitching: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
  team: Team;
  accent: Accent;
}

/**
 * Queue groups, in workflow order. Rows arrive already grouped by the server
 * (`item.group`), so there is no client-side action→group mapping: the server
 * owns the taxonomy (config.ts groups + design-owned catch-all).
 *
 * Kept short: the queue column is a fixed 420px, so five long labels blow the
 * tab strip past the panel width — the strip wraps instead of scrolling.
 */
const GROUP_LABELS: Record<GroupKey, string> = {
  ready: "Ready",
  rejections: "Rejections",
  resubmit: "Resubmit",
  waiting: "Waiting",
  other: "Other",
  inspection: "Inspection",
};

/** Sentinel value representing unassigned deals in the lead filter. */
const UNASSIGNED = "__unassigned__";

const TEAM_LOADING_LABEL: Record<Team, string> = {
  permit: "Permit",
  ic: "Interconnection",
  pto: "PTO",
};

export function Queue({
  items,
  isLoading,
  isSwitching,
  selectedDealId,
  onSelect,
  team,
  accent,
}: Props) {
  const a = ACCENTS[accent];
  const [search, setSearch] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  // Default to the most actionable bucket — new work going out.
  const [activeTab, setActiveTab] = useState<GroupKey>("ready");
  // "N look approved" chip: narrows the list to rows with an open approval
  // signal. Client-only state, same as the other filters.
  const [signalOnly, setSignalOnly] = useState(false);

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
      if (i.lead) named.add(i.lead);
      else hasUnassigned = true;
    });
    const opts: FilterOption[] = Array.from(named)
      .sort()
      .map((name) => ({ value: name, label: name }));
    if (hasUnassigned) opts.push({ value: UNASSIGNED, label: "Unassigned" });
    return opts;
  }, [items]);

  // Count over the FULL list — the chip reads "N look approved" for the team,
  // not for whatever the other filters left visible.
  const signalCount = useMemo(
    () => items.filter((i) => i.signal).length,
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (signalOnly) {
      list = list.filter((i) => i.signal);
    }
    if (selectedLocations.length > 0) {
      const set = new Set(selectedLocations);
      list = list.filter((i) => i.pbLocation && set.has(i.pbLocation));
    }
    if (selectedLeads.length > 0) {
      const set = new Set(selectedLeads);
      list = list.filter((i) =>
        i.lead ? set.has(i.lead) : set.has(UNASSIGNED),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.address?.toLowerCase().includes(q) ||
          i.lead?.toLowerCase().includes(q) ||
          // Match either what's displayed (label) or the underlying value.
          i.statusLabel.toLowerCase().includes(q) ||
          i.status.toLowerCase().includes(q) ||
          i.dealStage?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, search, selectedLocations, selectedLeads, signalOnly]);

  const groups = useMemo(() => {
    const map: Record<GroupKey, QueueItem[]> = {
      ready: [],
      rejections: [],
      resubmit: [],
      waiting: [],
      other: [],
      inspection: [],
    };
    for (const item of filtered) {
      // Fall back to "other" rather than throwing if the server ever returns a
      // group key this build doesn't know about (deploy skew, new taxonomy).
      (map[item.group] ?? map.other).push(item);
    }
    return map;
  }, [filtered]);

  // The Inspection tab only renders for teams whose queue actually carries
  // inspection rows (permit today) — the other teams keep their five-tab
  // strip untouched. Gated on the FULL item list, not `filtered`, so a
  // search/filter emptying the group shows a 0 badge (like every other tab)
  // instead of making the tab itself vanish.
  const hasInspection = useMemo(
    () => items.some((i) => i.group === "inspection"),
    [items],
  );
  const visibleGroups = hasInspection
    ? GROUP_ORDER
    : GROUP_ORDER.filter((k) => k !== "inspection");

  // The Queue is NOT remounted on a team switch, so switching away from a
  // team with inspection rows could strand the active tab on a tab that no
  // longer renders. Derived (not reset in an effect): render as if Ready
  // were active; if inspection rows return, the stored selection revives.
  const effectiveTab: GroupKey =
    activeTab === "inspection" && !hasInspection ? "ready" : activeTab;

  const activeItems = groups[effectiveTab];

  return (
    // min-w-0 so no child (the tab strip) can force this past the 420px column.
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-t-border px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search project, address, lead..."
          className={`border-t-border bg-surface-2 w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 ${a.focusRing}`}
        />
        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            placeholder="All locations"
            accentColor={a.filter}
          />
          <MultiSelectFilter
            label="Lead"
            options={leadOptions}
            selected={selectedLeads}
            onChange={setSelectedLeads}
            placeholder="All leads"
            accentColor={a.filter}
            // Right-anchored: this trigger sits far enough into the 420px
            // queue column that a left-anchored 288px dropdown overflows it.
            align="right"
          />
        </div>
      </div>
      <div className="text-muted flex items-center justify-between border-b border-t-border px-4 py-2 text-xs">
        <span>
          {filtered.length} of {items.length} · stalest first
        </span>
        {/* Keep the chip visible while the filter is on even if the last
            signal resolves — otherwise the only way to clear it disappears. */}
        {(signalCount > 0 || signalOnly) && (
          <button
            type="button"
            onClick={() => setSignalOnly((v) => !v)}
            aria-pressed={signalOnly}
            className={signalOnly ? SIGNAL_CHIP_ACTIVE_CLASS : SIGNAL_CHIP_CLASS}
          >
            {signalCount} look{signalCount === 1 ? "s" : ""} approved
          </button>
        )}
      </div>
      {/* Wraps rather than scrolls: five tabs (six on permit, with
          Inspection) plus counts are wider than the fixed 420px column, and a
          scrolling strip hides whole tabs off the edge. Wrapping also means
          no horizontal overflow, so focusing a tab can't make the browser
          drag the panel sideways and clip the rows. */}
      <div
        role="tablist"
        aria-label="Queue groups"
        className="flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-t-border px-1.5"
      >
        {visibleGroups.map((key) => {
          const active = key === effectiveTab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-2 text-xs font-medium transition-colors ${
                active ? a.tabActive : "text-muted hover:text-foreground border-transparent"
              }`}
            >
              <span>{GROUP_LABELS[key]}</span>
              <span
                className={`rounded-full px-1 py-0.5 text-[10px] font-semibold ${
                  active ? a.tabActiveBadge : "bg-surface-2 text-muted"
                }`}
              >
                {groups[key].length}
              </span>
            </button>
          );
        })}
      </div>
      {isSwitching && (
        <div
          role="status"
          className={`flex items-center gap-2 border-b border-t-border px-4 py-2 text-xs font-medium ${a.switchingBanner}`}
        >
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Loading {TEAM_LOADING_LABEL[team]} queue…
        </div>
      )}
      <div
        className={`flex-1 overflow-y-auto ${isSwitching ? "pointer-events-none opacity-40" : ""}`}
        role="tabpanel"
        aria-busy={isSwitching}
      >
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
              : `Nothing in ${GROUP_LABELS[effectiveTab]}`}
          </div>
        ) : (
          <ul className="divide-t-border divide-y">
            {activeItems.map((item) => {
              const selected = item.dealId === selectedDealId;
              return (
                // The row's select target is a <button>; the StatusDropdown
                // (itself a button) must NOT nest inside it, so it's an
                // absolutely-positioned sibling. pr-28 reserves room so the row
                // text never underlaps it.
                <li key={item.dealId} className="relative">
                  <button
                    type="button"
                    onClick={() => onSelect(item.dealId)}
                    className={`w-full px-4 py-3 pr-28 text-left transition-colors ${
                      selected ? a.rowSelected : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="text-muted truncate text-xs">
                        {item.address ?? "—"} · {item.pbLocation ?? "—"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs">
                      <span className="text-muted">
                        {item.statusLabel || item.status}
                      </span>
                    </div>
                    <div className="text-muted mt-1 truncate text-xs">
                      {item.daysInStatus === null ? "—" : `${item.daysInStatus}d`} ·{" "}
                      {item.lead ?? "Unassigned"}
                      {item.dealStage ? ` · ${item.dealStage}` : ""}
                    </div>
                  </button>
                  <div className="absolute right-3 top-2 flex flex-col items-end gap-1">
                    {item.signal && (
                      <span className={SIGNAL_PILL_CLASS}>
                        {signalLabel(item.signal.signalType)}
                      </span>
                    )}
                    {item.isStale && (
                      <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                        Stale
                      </span>
                    )}
                    <StatusDropdown
                      compact
                      team={team}
                      dealId={item.dealId}
                      currentStatus={item.status}
                      currentStatusLabel={item.statusLabel}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
