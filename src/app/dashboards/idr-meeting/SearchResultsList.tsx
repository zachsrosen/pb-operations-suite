"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/* ── Types ── */

interface SearchItem {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
  conclusion: string | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  opsRevisionNotes: string | null;
  designNotes: string | null;
  escalationReason: string | null;
  shitShowFlagged: boolean;
  designRevisionNeeded: boolean;
  session: { date: string; status: string };
}

interface SearchResponse {
  items: SearchItem[];
  total: number;
  hasMore: boolean;
}

interface SessionSummary {
  date: string;
  conclusion: string | null;
  noteSnippets: string[];
  flags: string[];
}

export interface DealGroup {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
  meetingCount: number;
  conclusions: { date: string; text: string | null }[];
  sessions: SessionSummary[];
}

/* ── Grouping helper (exported for testing) ── */

export function groupItemsByDeal(
  items: SearchItem[],
  existing: Map<string, DealGroup>,
): Map<string, DealGroup> {
  const groups = new Map(existing);

  for (const item of items) {
    const group = groups.get(item.dealId) ?? {
      dealId: item.dealId,
      dealName: item.dealName,
      region: item.region,
      systemSizeKw: item.systemSizeKw,
      projectType: item.projectType,
      meetingCount: 0,
      conclusions: [],
      sessions: [],
    };

    // Deduplicate by session date
    const dateKey = item.session.date;
    if (!group.conclusions.some((c) => c.date === dateKey)) {
      group.meetingCount += 1;
      group.conclusions.push({ date: dateKey, text: item.conclusion });

      // Build note snippets for this session
      const snippets: string[] = [];
      if (item.customerNotes) snippets.push(`Customer: ${truncate(item.customerNotes, 60)}`);
      if (item.operationsNotes) snippets.push(`Ops: ${truncate(item.operationsNotes, 60)}`);
      if (item.opsRevisionNotes) snippets.push(`Ops Rev: ${truncate(item.opsRevisionNotes, 60)}`);
      if (item.designNotes) snippets.push(`Design: ${truncate(item.designNotes, 60)}`);

      const flags: string[] = [];
      if (item.escalationReason) flags.push("Escalation");
      if (item.shitShowFlagged) flags.push("Shit Show");
      if (item.designRevisionNeeded) flags.push("Revision");

      group.sessions.push({
        date: dateKey,
        conclusion: item.conclusion,
        noteSnippets: snippets,
        flags,
      });
    }

    // Sort newest-first
    group.conclusions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    group.sessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    groups.set(item.dealId, group);
  }

  return groups;
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + "..." : oneLine;
}

/* ── Component ── */

interface Props {
  selectedDealId: string | null;
  onSelectDeal: (dealId: string, dealName: string, region: string | null, systemSizeKw: number | null, projectType: string | null) => void;
  onFiltersChange?: () => void;
}

export function SearchResultsList({ selectedDealId, onSelectDeal, onFiltersChange }: Props) {
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [skip, setSkip] = useState(0);
  const [dealGroups, setDealGroups] = useState<Map<string, DealGroup>>(new Map());

  // Debounce search text. Normalize: if text drops below 2 chars and there
  // are no date filters, clear debouncedQ so stale results don't linger.
  useEffect(() => {
    const normalized = searchText.length >= 2 ? searchText : "";
    const timer = setTimeout(() => setDebouncedQ(normalized), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Reset groups and pagination when search params change.
  // Done in an effect (not during render) to avoid unsafe setState-during-render.
  useEffect(() => {
    setDealGroups(new Map());
    setSkip(0);
    onFiltersChange?.();
  }, [debouncedQ, dateFrom, dateTo, onFiltersChange]);

  const hasQuery = debouncedQ.length >= 2 || dateFrom || dateTo;

  // Include skip in query key so React Query refetches when "Load more" is clicked
  const searchQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.meetingSearch(debouncedQ, dateFrom || undefined, dateTo || undefined), skip],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQ.length >= 2) params.set("q", debouncedQ);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (skip > 0) params.set("skip", String(skip));
      const res = await fetch(`/api/idr-meeting/search?${params}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<SearchResponse>;
    },
    enabled: !!hasQuery,
    staleTime: 30 * 1000,
  });

  // Merge results into groups (useState triggers re-render, unlike useRef)
  useEffect(() => {
    if (searchQuery.data) {
      setDealGroups((prev) => groupItemsByDeal(searchQuery.data.items, prev));
    }
  }, [searchQuery.data]);

  const groups = Array.from(dealGroups.values());
  const hasMore = searchQuery.data?.hasMore ?? false;

  const handleLoadMore = useCallback(() => {
    setSkip((prev) => prev + 50);
  }, []);

  return (
    <div className="w-[380px] shrink-0 border-r border-t-border overflow-y-auto flex flex-col">
      {/* Search input */}
      <div className="p-3 space-y-2 border-b border-t-border">
        <input
          type="text"
          placeholder="Search deals, notes, conclusions..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted"
          autoFocus
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 rounded-lg border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 rounded-lg border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground"
            placeholder="To"
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!hasQuery && (
          <p className="text-sm text-muted text-center py-8">Search for a deal to view its meeting history</p>
        )}

        {searchQuery.isLoading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {hasQuery && !searchQuery.isLoading && groups.length === 0 && (
          <p className="text-sm text-muted text-center py-8">No deals found matching your search</p>
        )}

        {groups.length > 0 && (
          <p className="text-[10px] text-muted text-center pb-1">
            {searchQuery.data?.total ?? groups.length} result{(searchQuery.data?.total ?? groups.length) !== 1 ? "s" : ""} &mdash; click a deal for full history
          </p>
        )}

        {groups.map((group) => (
          <button
            key={group.dealId}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selectedDealId === group.dealId
                ? "border-orange-500 bg-orange-500/8"
                : "border-t-border bg-surface-2 hover:bg-surface"
            }`}
            onClick={() => onSelectDeal(group.dealId, group.dealName, group.region, group.systemSizeKw, group.projectType)}
          >
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-foreground truncate">{group.dealName}</span>
              <span className="text-[10px] text-muted shrink-0">{group.meetingCount} meeting{group.meetingCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5">
              {[group.region, group.systemSizeKw ? `${group.systemSizeKw} kW` : null, group.projectType].filter(Boolean).join(" \u2022 ")}
            </div>

            {/* Session summaries with notes */}
            {group.sessions.length > 0 && (
              <div className="mt-2 pl-2 border-l-2 border-orange-500 space-y-2">
                {group.sessions.slice(0, 3).map((s) => (
                  <div key={s.date}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-orange-500 shrink-0 font-medium">
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      {s.flags.map((f) => (
                        <span
                          key={f}
                          className={`rounded-full px-1.5 py-px text-[9px] font-medium ${
                            f === "Shit Show" ? "bg-red-500/15 text-red-400"
                              : f === "Escalation" ? "bg-orange-500/15 text-orange-400"
                              : "bg-yellow-500/15 text-yellow-400"
                          }`}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                    {s.conclusion && (
                      <p className="text-[11px] text-foreground/70 truncate mt-0.5">
                        <span className="text-emerald-500 text-[10px]">Conclusion:</span>{" "}
                        {s.conclusion}
                      </p>
                    )}
                    {s.noteSnippets.length > 0 && (
                      <div className="mt-0.5 space-y-px">
                        {s.noteSnippets.slice(0, 2).map((snippet, i) => (
                          <p key={i} className="text-[10px] text-muted truncate">{snippet}</p>
                        ))}
                        {s.noteSnippets.length > 2 && (
                          <p className="text-[10px] text-muted/60">+{s.noteSnippets.length - 2} more note{s.noteSnippets.length - 2 !== 1 ? "s" : ""}</p>
                        )}
                      </div>
                    )}
                    {!s.conclusion && s.noteSnippets.length === 0 && (
                      <p className="text-[10px] text-muted/50 italic mt-0.5">No notes recorded</p>
                    )}
                  </div>
                ))}
                {group.sessions.length > 3 && (
                  <span className="text-[10px] text-muted">+{group.sessions.length - 3} more session{group.sessions.length - 3 !== 1 ? "s" : ""}</span>
                )}
              </div>
            )}
          </button>
        ))}

        {hasMore && (
          <button
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
            onClick={handleLoadMore}
            disabled={searchQuery.isFetching}
          >
            {searchQuery.isFetching ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
