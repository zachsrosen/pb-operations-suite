"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MiniStat } from "@/components/ui/MetricCard";
import { MultiSelectFilter, FilterOption } from "@/components/ui/MultiSelectFilter";

export type ServiceProductionIssue = {
  source: "ticket" | "deal";
  id: string;
  customerName: string | null;
  address: string | null;
  location: string | null;
  issue: string;
  date: string | null;
  ageDays: number | null;
  hubspotUrl: string;
};

type ServiceIssuesResponse = {
  issues: ServiceProductionIssue[];
  lastUpdated: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Service view of the Production Issues dashboard. Renders ONE merged list of
 * two HubSpot sources (open production-issue service tickets + Project-Complete
 * deals tagged as a production issue), each row badged by source.
 *
 * Owns its own data fetch + location filter so the install view stays untouched.
 * The parent supplies `selectedLocations` / `onLocationsChange` so the toggle's
 * location filter is shared visually, and `onData` so the parent can wire CSV
 * export + lastUpdated through DashboardShell.
 */
export default function ServiceIssuesView({
  selectedLocations,
  onLocationsChange,
  onData,
}: {
  selectedLocations: string[];
  onLocationsChange: (v: string[]) => void;
  onData?: (rows: Record<string, unknown>[], lastUpdated: string | null) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["service", "production-issues"],
    queryFn: async () => {
      const res = await fetch("/api/service/production-issues");
      if (!res.ok) throw new Error(`Failed to load service production issues (${res.status})`);
      return (await res.json()) as ServiceIssuesResponse;
    },
    staleTime: 5 * 60 * 1000,
  });

  const issues = useMemo(() => data?.issues ?? [], [data]);

  const locationOptions: FilterOption[] = useMemo(
    () =>
      Array.from(new Set(issues.map((i) => i.location || "")))
        .filter(Boolean)
        .sort()
        .map((v) => ({ value: v, label: v })),
    [issues]
  );

  const filtered = useMemo(() => {
    if (selectedLocations.length === 0) return issues;
    return issues.filter((i) => selectedLocations.includes(i.location ?? ""));
  }, [issues, selectedLocations]);

  const ticketCount = filtered.filter((i) => i.source === "ticket").length;
  const dealCount = filtered.filter((i) => i.source === "deal").length;

  // Lift CSV-export rows + lastUpdated up to the parent shell.
  const exportRows = useMemo(
    () =>
      filtered.map((i) => ({
        source: i.source === "ticket" ? "Ticket" : "Deal",
        customer: i.customerName ?? "",
        address: i.address ?? "",
        location: i.location ?? "",
        issue: i.issue,
        date: i.date ?? "",
        ageDays: i.ageDays ?? "",
        hubspotUrl: i.hubspotUrl,
      })),
    [filtered]
  );

  useEffect(() => {
    onData?.(exportRows, data?.lastUpdated ?? null);
  }, [exportRows, data?.lastUpdated, onData]);

  return (
    <>
      {/* Hero strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <MiniStat label="Total issues" value={isLoading ? null : filtered.length} />
        <MiniStat label="🎫 Tickets" value={isLoading ? null : ticketCount} />
        <MiniStat label="📋 Deals" value={isLoading ? null : dealCount} />
      </div>

      {/* Filter bar */}
      {!isLoading && issues.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <MultiSelectFilter
            label="Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={onLocationsChange}
          />
          {selectedLocations.length > 0 && (
            <button
              onClick={() => onLocationsChange([])}
              className="text-xs text-muted hover:text-foreground underline px-2"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto text-xs text-muted">
            Showing {filtered.length} of {issues.length}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && issues.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="text-lg font-medium text-foreground mb-2">
            No service production issues
          </div>
          <div className="text-sm text-muted">
            No open production-issue service tickets and no tagged completed projects.
          </div>
        </div>
      )}
      {!isLoading && issues.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface p-12 text-center">
          <div className="text-lg font-medium text-foreground mb-2">
            No issues match the current filters
          </div>
          <button
            onClick={() => onLocationsChange([])}
            className="mt-3 text-sm text-orange-500 hover:text-orange-400 underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Merged list */}
      {!isLoading && filtered.length > 0 && (
        <div className="rounded-xl border border-t-border bg-surface overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="text-left p-3">Source</th>
                <th className="text-left p-3">Customer / Address</th>
                <th className="text-left p-3">Location</th>
                <th className="text-left p-3">Issue</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Age</th>
                <th className="text-left p-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={`${i.source}-${i.id}`}
                  className="border-t border-t-border hover:bg-surface-2 align-top"
                >
                  <td className="p-3 whitespace-nowrap">
                    {i.source === "ticket" ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs border bg-blue-500/20 text-blue-400 border-blue-500/30">
                        🎫 Ticket
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-xs border bg-purple-500/20 text-purple-400 border-purple-500/30">
                        📋 Deal
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="text-foreground">{i.customerName ?? "—"}</div>
                    {i.address && <div className="text-xs text-muted">{i.address}</div>}
                  </td>
                  <td className="p-3">{i.location ?? "—"}</td>
                  <td className="p-3">{i.issue}</td>
                  <td className="p-3 whitespace-nowrap">{formatDate(i.date)}</td>
                  <td className="p-3 whitespace-nowrap tabular-nums">
                    {i.ageDays !== null ? `${i.ageDays}d` : "—"}
                  </td>
                  <td className="p-3">
                    <a
                      href={i.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-500 hover:text-orange-400 underline text-xs"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
