"use client";

import { useMemo, useState } from "react";
import {
  MultiSelectFilter,
  type FilterOption,
} from "@/components/ui/MultiSelectFilter";
import {
  GROUP_LABELS,
  SUB_GROUP_LABELS,
  SUB_GROUP_ORDER,
  type GroupKey,
  type QueueItem,
  type SubGroupKey,
  type Tab,
} from "@/lib/design-hub/types";
import { ACCENTS, type Accent } from "./accents";

interface Props {
  items: QueueItem[];
  isLoading: boolean;
  /** True while a tab switch shows the PREVIOUS tab's rows as placeholder — a
   *  cold queue load can take tens of seconds, and without a visible state the
   *  switch reads as a no-op. */
  isSwitching: boolean;
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
  tab: Tab;
  accent: Accent;
}

/**
 * Group order per tab. Rows arrive already grouped by the server
 * (`item.group`), so there is no client-side status→group mapping: the server
 * owns the taxonomy. Labels are kept short — the queue column is a fixed
 * 420px, and long labels wrap the tab strip instead of scrolling it.
 */
const GROUP_ORDER: Record<Tab, readonly GroupKey[]> = {
  design: ["idr", "fdr", "revisions_needed", "revisions_in_progress", "other"],
  da: ["send", "waiting_info", "follow_up", "rejection_revision"],
};

/** Lanes that render five labelled sections instead of a flat list. */
const SUB_GROUPED: ReadonlySet<GroupKey> = new Set([
  "revisions_needed",
  "revisions_in_progress",
]);

/** Sentinel value representing unassigned deals in the lead filter. */
const UNASSIGNED = "__unassigned__";

export function Queue({
  items,
  isLoading,
  isSwitching,
  selectedDealId,
  onSelect,
  tab,
  accent,
}: Props) {
  const a = ACCENTS[accent];
  const [search, setSearch] = useState("");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [assignedOnly, setAssignedOnly] = useState(false);
  const groupOrder = GROUP_ORDER[tab];
  // Default to the first lane of the tab — the most actionable bucket.
  const [activeTab, setActiveTab] = useState<GroupKey>(groupOrder[0]);

  // Tab switches change the available groups; if the active one no longer
  // exists on this tab, fall back to the first. Render-time adjust, same
  // pattern as the selection reset in DesignHubClient.
  const [orderedFor, setOrderedFor] = useState(tab);
  if (orderedFor !== tab) {
    setOrderedFor(tab);
    setActiveTab(groupOrder[0]);
  }

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

  // Count over the FULL list — the chip reads "N assigned" for the tab, not
  // for whatever the other filters left visible.
  const assignedCount = useMemo(
    () => items.filter((i) => i.assignment).length,
    [items],
  );

  const filtered = useMemo(() => {
    let list = items;
    if (assignedOnly) list = list.filter((i) => i.assignment);
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
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.address ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, assignedOnly, selectedLocations, selectedLeads, search]);

  const byGroup = useMemo(() => {
    const map = new Map<GroupKey, QueueItem[]>();
    for (const item of filtered) {
      const bucket = map.get(item.group);
      if (bucket) bucket.push(item);
      else map.set(item.group, [item]);
    }
    return map;
  }, [filtered]);

  const visibleGroups = groupOrder.filter((g) => (byGroup.get(g)?.length ?? 0) > 0);
  // Filtering can empty the active lane while others still have rows. Showing
  // an empty list with no tab highlighted reads as "no results" when the work
  // is one click away — fall back to the first lane that has something.
  const effectiveTab =
    visibleGroups.length > 0 && !visibleGroups.includes(activeTab)
      ? visibleGroups[0]
      : activeTab;
  const rows = byGroup.get(effectiveTab) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-t-border p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or address…"
          className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
        />
        <div className="flex flex-wrap gap-2">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={setSelectedLocations}
            accentColor={a.filter}
          />
          <MultiSelectFilter
            label="Lead"
            options={leadOptions}
            selected={selectedLeads}
            onChange={setSelectedLeads}
            accentColor={a.filter}
            // The rail is 420px with overflow-hidden; a left-anchored 288px
            // dropdown here extends past it and drags the panel sideways.
            align="right"
          />
          {assignedCount > 0 && (
            <button
              type="button"
              onClick={() => setAssignedOnly((v) => !v)}
              aria-pressed={assignedOnly}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                assignedOnly
                  ? a.tabActiveBadge
                  : "bg-surface-2 text-muted hover:bg-surface-elevated"
              }`}
            >
              {assignedCount} assigned
            </button>
          )}
        </div>
      </div>

      {isSwitching && (
        <div className={`px-3 py-1.5 text-xs font-medium ${a.switchingBanner}`}>
          Loading…
        </div>
      )}

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-t-border px-2">
        {visibleGroups.map((g) => {
          const active = g === effectiveTab;
          const count = byGroup.get(g)?.length ?? 0;
          return (
            <button
              key={g}
              type="button"
              onClick={() => setActiveTab(g)}
              aria-pressed={active}
              className={`shrink-0 border-b-2 px-2.5 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? a.tabActive
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {GROUP_LABELS[g]}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? a.tabActiveBadge : "bg-surface-2"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-muted p-4 text-sm">Loading queue…</div>
        ) : rows.length === 0 ? (
          <div className="text-muted p-4 text-sm">Nothing here right now.</div>
        ) : SUB_GROUPED.has(effectiveTab) ? (
          <SubGroupedRows
            rows={rows}
            selectedDealId={selectedDealId}
            onSelect={onSelect}
            accent={accent}
          />
        ) : (
          rows.map((item) => (
            <Row
              key={item.dealId}
              item={item}
              selected={item.dealId === selectedDealId}
              onSelect={onSelect}
              accent={accent}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The two revision lanes, split by revision type. Five sections render inside
 * the lane rather than as five more tabs: the rail is a fixed 420px and the
 * strip would wrap.
 */
function SubGroupedRows({
  rows,
  selectedDealId,
  onSelect,
  accent,
}: {
  rows: QueueItem[];
  selectedDealId: string | null;
  onSelect: (dealId: string) => void;
  accent: Accent;
}) {
  const bySub = useMemo(() => {
    const map = new Map<SubGroupKey | "none", QueueItem[]>();
    for (const item of rows) {
      const key = item.subGroup ?? "none";
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [rows]);

  // "none" is rendered last and only if non-empty: a revision-lane row with no
  // sub-group means config drift (a new revision status with no type mapping),
  // and hiding it would make the deal invisible.
  const keys: Array<SubGroupKey | "none"> = [
    ...SUB_GROUP_ORDER.filter((k) => (bySub.get(k)?.length ?? 0) > 0),
    ...((bySub.get("none")?.length ?? 0) > 0 ? (["none"] as const) : []),
  ];

  return (
    <>
      {keys.map((key) => (
        <div key={key}>
          <div className="text-muted sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
            {key === "none" ? "Unclassified" : SUB_GROUP_LABELS[key]}
            <span className="ml-1.5 font-normal">
              {bySub.get(key)?.length ?? 0}
            </span>
          </div>
          {(bySub.get(key) ?? []).map((item) => (
            <Row
              key={item.dealId}
              item={item}
              selected={item.dealId === selectedDealId}
              onSelect={onSelect}
              accent={accent}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function Row({
  item,
  selected,
  onSelect,
  accent,
}: {
  item: QueueItem;
  selected: boolean;
  onSelect: (dealId: string) => void;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  return (
    <button
      type="button"
      onClick={() => onSelect(item.dealId)}
      className={`block w-full border-b border-t-border px-3 py-2.5 text-left transition-colors ${
        selected ? a.rowSelected : "hover:bg-surface-2"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-foreground truncate text-sm font-medium">
          {item.name}
        </span>
        {item.assignment && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${a.tabActiveBadge}`}>
            {item.assignment.assigneeName.split(" ")[0]}
          </span>
        )}
      </div>
      {item.address && (
        <div className="text-muted truncate text-xs">{item.address}</div>
      )}
      <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span className="truncate">{item.statusLabel}</span>
        <span
          className={
            item.isStale ? "font-semibold text-red-600 dark:text-red-400" : ""
          }
        >
          {item.daysInStatus === null ? "—" : `${item.daysInStatus}d`}
        </span>
        {item.lead && <span className="truncate">{item.lead}</span>}
      </div>
    </button>
  );
}
