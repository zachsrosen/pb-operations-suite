"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { formatCurrencyCompact } from "@/lib/format";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import {
  type DesignFunnelResponse,
  type DesignFunnelGroup,
  type DesignFunnelDeal,
} from "@/lib/design-funnel-aggregation";

// Tonal accent per bucket — progression in cool→warm, revisions in red family.
const BUCKET_TONE: Record<string, string> = {
  awaitingDaSend: "bg-blue-500",
  awaitingDaApproval: "bg-indigo-500",
  awaitingDesignComplete: "bg-violet-500",
  designComplete: "bg-emerald-500",
  utilityRevision: "bg-amber-500",
  permitRevision: "bg-orange-500",
  asBuiltRevision: "bg-rose-500",
};

function ageTone(days: number): string {
  if (days >= 30) return "text-red-400";
  if (days >= 14) return "text-amber-400";
  return "text-muted";
}

// Stable palette for status-breakdown segments within a group.
const SEGMENT_COLORS = [
  "bg-blue-500/50",
  "bg-emerald-500/50",
  "bg-amber-500/50",
  "bg-violet-500/50",
  "bg-rose-500/50",
  "bg-cyan-500/50",
  "bg-orange-500/50",
  "bg-lime-500/50",
  "bg-pink-500/50",
  "bg-teal-500/50",
];

function StatusBar({ group }: { group: DesignFunnelGroup }) {
  if (group.count === 0) return null;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-surface-2">
      {group.statusBreakdown.map((seg, i) => (
        <div
          key={seg.status}
          className={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
          style={{ width: `${(seg.count / group.count) * 100}%` }}
          title={`${seg.status}: ${seg.count}`}
        />
      ))}
    </div>
  );
}

function StatusLegend({ group }: { group: DesignFunnelGroup }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {group.statusBreakdown.map((seg, i) => (
        <span key={seg.status} className="inline-flex items-center gap-1 text-[11px] text-muted">
          <span className={`inline-block h-2 w-2 rounded-sm ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
          {seg.status}
          <span className="font-semibold text-foreground tabular-nums">{seg.count}</span>
        </span>
      ))}
    </div>
  );
}

function DealTable({ deals }: { deals: DesignFunnelDeal[] }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-muted border-b border-t-border">
          <th className="text-left font-medium py-1 pr-2">Project</th>
          <th className="text-left font-medium py-1 pr-2">Stage</th>
          <th className="text-left font-medium py-1 pr-2">Design Status</th>
          <th className="text-left font-medium py-1 pr-2 hidden sm:table-cell">Design Lead</th>
          <th className="text-right font-medium py-1">Days in Stage</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => (
          <tr key={d.id} className="border-b border-t-border/50 hover:bg-surface-2">
            <td className="py-1 pr-2">
              <a href={d.url} target="_blank" rel="noreferrer" className="text-foreground hover:text-blue-400">
                {d.projectNumber || d.name}
              </a>
              <span className="text-muted"> · {d.pbLocation}</span>
              {d.flag && (
                <span
                  className={`ml-1 px-1 rounded text-[9px] ${
                    d.flag.tone === "red"
                      ? "bg-red-500/20 text-red-300"
                      : d.flag.tone === "orange"
                        ? "bg-orange-500/20 text-orange-300"
                        : "bg-yellow-500/20 text-yellow-300"
                  }`}
                  title={d.flag.reason || undefined}
                >
                  {d.flag.label}
                </span>
              )}
            </td>
            <td className="py-1 pr-2 text-muted truncate max-w-[150px]" title={d.stage}>{d.stage}</td>
            <td className="py-1 pr-2 text-muted truncate max-w-[170px]" title={d.designStatus}>{d.designStatus}</td>
            <td className="py-1 pr-2 text-muted hidden sm:table-cell truncate max-w-[120px]">{d.designLead || "—"}</td>
            <td className={`py-1 text-right tabular-nums font-semibold ${ageTone(d.daysInStage)}`}>{d.daysInStage}d</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A collapsible group card used for both the funnel buckets and the stages. */
function GroupCard({
  group,
  total,
  accent,
}: {
  group: DesignFunnelGroup;
  total: number;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const share = total > 0 ? Math.round((group.count / total) * 100) : 0;
  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 text-left">
        {accent && <span className={`h-8 w-1.5 rounded-full ${accent}`} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{group.label}</span>
            <span className="text-[11px] text-muted tabular-nums shrink-0">
              {share}% · {formatCurrencyCompact(group.amount)}
            </span>
          </div>
          <div className="mt-1.5">
            <StatusBar group={group} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-foreground tabular-nums leading-none">{group.count}</div>
        </div>
      </button>
      {group.count > 0 && <StatusLegend group={group} />}
      {group.deals.length > 0 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11px] text-muted hover:text-foreground transition-colors"
        >
          {open ? "Hide" : "Show"} {group.deals.length} project{group.deals.length === 1 ? "" : "s"}
        </button>
      )}
      {open && (
        <div className="mt-2 max-h-96 overflow-y-auto">
          <DealTable deals={group.deals} />
        </div>
      )}
    </div>
  );
}

export default function DesignEngineeringFunnelPage() {
  const [locations, setLocations] = useState<string[]>([]);
  const [leads, setLeads] = useState<string[]>([]);
  const [pms, setPms] = useState<string[]>([]);
  const [tab, setTab] = useState<"funnel" | "stages">("funnel");

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery<DesignFunnelResponse>({
    queryKey: queryKeys.funnel.designFunnel(locations, leads, pms),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (locations.length > 0) params.set("locations", locations.join(","));
      if (leads.length > 0) params.set("leads", leads.join(","));
      if (pms.length > 0) params.set("pms", pms.join(","));
      const res = await fetch(`/api/deals/design-funnel?${params}`);
      if (!res.ok) throw new Error("Failed to fetch design funnel data");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  useSSE(() => refetch(), { cacheKeyFilter: "funnel" });

  const locationOptions = useMemo(
    () => CANONICAL_LOCATIONS.map((loc) => ({ value: loc, label: loc })),
    []
  );
  const leadOptions = useMemo(
    () => (data?.filterOptions.designLeads || []).map((v) => ({ value: v, label: v })),
    [data]
  );
  const pmOptions = useMemo(
    () => (data?.filterOptions.projectManagers || []).map((v) => ({ value: v, label: v })),
    [data]
  );

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <DashboardShell title="Design & Engineering Funnel" accentColor="purple" lastUpdated={lastUpdated} fullWidth>
      <div className="space-y-5">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-t-border overflow-hidden">
            {(["funnel", "stages"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? "bg-purple-500/20 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {t === "funnel" ? "Status Funnel" : "By Deal Stage"}
              </button>
            ))}
          </div>
          <MultiSelectFilter label="Location" options={locationOptions} selected={locations} onChange={setLocations} />
          <MultiSelectFilter label="Design Lead" options={leadOptions} selected={leads} onChange={setLeads} />
          <MultiSelectFilter label="Project Mgr" options={pmOptions} selected={pms} onChange={setPms} />
          {data && (
            <span className="text-xs text-muted ml-auto">
              {data.totalProjects.toLocaleString()} active projects · {formatCurrencyCompact(data.totalAmount)}
            </span>
          )}
        </div>

        {error ? (
          <ErrorState message="Failed to load the design funnel." onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="py-20 flex justify-center"><LoadingSpinner /></div>
        ) : tab === "funnel" ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              Design status funnel — every active project in one bucket
            </h2>
            <div className="grid grid-cols-1 gap-2">
              {data.buckets.map((b) => (
                <GroupCard key={b.key} group={b} total={data.totalProjects} accent={BUCKET_TONE[b.key]} />
              ))}
            </div>
          </section>
        ) : (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
              Deal stage — design status breakdown
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {data.stageBreakdown.map((s) => (
                <GroupCard key={s.key} group={s} total={data.totalProjects} />
              ))}
            </div>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
