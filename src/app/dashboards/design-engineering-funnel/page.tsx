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

// Base bar color per status-funnel bucket (cool→warm progression, revisions red).
const BUCKET_COLOR: Record<string, string> = {
  awaitingSiteSurvey: "bg-zinc-500",
  awaitingDesignUpload: "bg-slate-500",
  awaitingDesignReview: "bg-sky-500",
  awaitingDaSend: "bg-blue-500",
  awaitingDaApproval: "bg-indigo-500",
  awaitingDesignComplete: "bg-violet-500",
  designComplete: "bg-emerald-500",
  utilityRevision: "bg-amber-500",
  permitRevision: "bg-orange-500",
  asBuiltRevision: "bg-rose-500",
};

// Same stage palette the Project Pipeline Funnel uses, so the two read alike.
const STAGE_COLORS: Record<string, string> = {
  "Site Survey": "bg-amber-500",
  "Design & Engineering": "bg-blue-500",
  "Permitting & Interconnection": "bg-purple-500",
  "RTB - Blocked": "bg-red-500",
  "Ready To Build": "bg-cyan-500",
  Construction: "bg-green-500",
  Inspection: "bg-emerald-500",
  "Permission To Operate": "bg-teal-500",
  "Close Out": "bg-sky-500",
  "On Hold": "bg-yellow-500",
};

const segOpacity = (i: number) => Math.max(0.4, 1 - i * 0.18);

function ageTone(days: number): string {
  if (days >= 30) return "text-red-400";
  if (days >= 14) return "text-amber-400";
  return "text-muted";
}

/** Drill-down table for one bucket / stage row — mirrors the project funnel's. */
function DrillTable({ deals, indent = true }: { deals: DesignFunnelDeal[]; indent?: boolean }) {
  return (
    <div className={`${indent ? "pl-[11.75rem]" : ""} pt-1 pb-2 overflow-x-auto`}>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-muted border-b border-t-border">
            <th className="text-left font-medium py-1 pr-3">Project</th>
            <th className="text-left font-medium py-1 pr-3">Stage</th>
            <th className="text-left font-medium py-1 pr-3">Design Lead</th>
            <th className="text-right font-medium py-1 pr-3">Amount</th>
            <th className="text-right font-medium py-1 pr-3">Days in stage</th>
            <th className="text-left font-medium py-1">Design Status</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className={`border-b border-t-border/40 hover:bg-surface-2/40 ${d.muted ? "opacity-50" : ""}`}>
              <td className="py-1 pr-3 whitespace-nowrap">
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-foreground/90 font-medium hover:text-cyan-400">
                  {d.projectNumber || d.name}
                </a>
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
              <td className="py-1 pr-3 text-muted whitespace-nowrap">{d.stage}</td>
              <td className="py-1 pr-3 text-muted whitespace-nowrap">{d.designLead || "—"}</td>
              <td className="py-1 pr-3 text-right tabular-nums text-muted whitespace-nowrap">{formatCurrencyCompact(d.amount)}</td>
              <td className={`py-1 pr-3 text-right tabular-nums whitespace-nowrap ${ageTone(d.daysInStage)}`}>{d.daysInStage}d</td>
              <td className="py-1 text-foreground/80">{d.designStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Single "Current Pipeline Position"-style panel: one row per group. */
function PositionPanel({
  title,
  subtitle,
  groups,
  total,
  colorFor,
}: {
  title: string;
  subtitle: string;
  groups: DesignFunnelGroup[];
  total: number;
  colorFor: (g: DesignFunnelGroup) => string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxCount = Math.max(1, ...groups.map((g) => g.count));

  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">{title}</h3>
      <p className="text-xs text-muted mb-4">{subtitle}</p>
      <div className="space-y-1.5">
        {groups.map((g) => {
          const pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
          const color = colorFor(g);
          const segs = g.statusBreakdown.length ? g.statusBreakdown : [{ status: "No status", count: g.count, amount: 0, muted: false }];
          const segTotal = g.count || 1;
          const hasRealStatus = g.statusBreakdown.some((s) => s.status !== "No status");
          return (
            <div key={g.key}>
              <button
                type="button"
                className="flex items-center gap-3 w-full py-0.5 rounded-md hover:bg-surface-2/50 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                onClick={() => g.count > 0 && setExpanded(expanded === g.key ? null : g.key)}
                disabled={g.count <= 0}
              >
                <span className="w-44 text-xs text-muted text-right shrink-0 flex items-center justify-end gap-1">
                  {g.count > 0 && (
                    <span className={`text-[10px] transition-transform ${expanded === g.key ? "rotate-90" : ""}`}>▶</span>
                  )}
                  <span className="truncate" title={g.label}>{g.label}</span>
                </span>
                <div className="flex items-center gap-2 flex-1">
                  {g.count > 0 ? (
                    <div
                      className="flex h-6 rounded-md overflow-hidden"
                      style={{ width: `${Math.max(6, (g.count / maxCount) * 100)}%` }}
                    >
                      {segs.map((seg, i) => (
                        <div
                          key={seg.status}
                          className={`${color} h-full ${i > 0 ? "border-l border-black/25" : ""} ${seg.muted ? "grayscale" : ""}`}
                          style={{ width: `${(seg.count / segTotal) * 100}%`, opacity: seg.muted ? 0.25 : segOpacity(i) }}
                          title={`${seg.status}: ${seg.count}${seg.muted ? " (completed)" : ""}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted/60 italic">—</span>
                  )}
                  <span className="text-[11px] text-muted shrink-0 tabular-nums">
                    <span className="text-foreground font-semibold">{g.count}</span> · {formatCurrencyCompact(g.amount)} · {pct}%
                  </span>
                </div>
              </button>
              {g.count > 0 && hasRealStatus && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-[11.75rem] pt-0.5 text-[10px] text-muted">
                  {g.statusBreakdown.map((seg) => (
                    <span key={seg.status} className={`whitespace-nowrap ${seg.muted ? "opacity-40" : ""}`}>
                      <span className="text-foreground/70 font-semibold tabular-nums">{seg.count}</span> {seg.status}
                    </span>
                  ))}
                </div>
              )}
              {expanded === g.key && g.deals.length > 0 && <DrillTable deals={g.deals} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Branch/tree view of the status funnel ────────────────────────────────────
// Awaiting Site Survey branches into the two next steps the design process can
// take (upload a design, or send the DA), each flowing on; Design Complete
// branches into the three post-completion revision loops.
interface TreeDef {
  key: string;
  children?: TreeDef[];
}
const FUNNEL_TREE: TreeDef = {
  key: "awaitingSiteSurvey",
  children: [
    { key: "awaitingDesignUpload", children: [{ key: "awaitingDesignReview" }] },
    {
      key: "awaitingDaSend",
      children: [
        {
          key: "awaitingDaApproval",
          children: [
            {
              key: "awaitingDesignComplete",
              children: [
                {
                  key: "designComplete",
                  children: [
                    { key: "utilityRevision" },
                    { key: "permitRevision" },
                    { key: "asBuiltRevision" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function TreeNode({
  node,
  byKey,
  maxCount,
  total,
  expanded,
  setExpanded,
  connector,
}: {
  node: TreeDef;
  byKey: Record<string, DesignFunnelGroup>;
  maxCount: number;
  total: number;
  expanded: string | null;
  setExpanded: (k: string | null) => void;
  connector: boolean;
}) {
  const g = byKey[node.key];
  if (!g) return null;
  const pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
  const color = BUCKET_COLOR[g.key] || "bg-zinc-500";
  const segs = g.statusBreakdown.length ? g.statusBreakdown : [{ status: "No status", count: g.count, amount: 0, muted: false }];
  const segTotal = g.count || 1;
  const isOpen = expanded === g.key;

  return (
    <div className="relative">
      {connector && <span className="absolute -left-4 top-[1.4rem] w-4 border-t border-t-border" aria-hidden />}
      <button
        type="button"
        className="flex items-center gap-2.5 w-full text-left py-1 rounded-md hover:bg-surface-2/50 transition-colors disabled:hover:bg-transparent"
        onClick={() => g.count > 0 && setExpanded(isOpen ? null : g.key)}
        disabled={g.count <= 0}
        title={`${g.label} · ${formatCurrencyCompact(g.amount)}`}
      >
        <span className={`h-9 w-1.5 rounded-full shrink-0 ${color} ${g.count <= 0 ? "opacity-30" : ""}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-foreground truncate flex items-center gap-1">
              {g.count > 0 && <span className={`text-[10px] text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>}
              {g.label}
            </span>
            <span className="text-[11px] text-muted shrink-0 tabular-nums">
              <span className="text-foreground font-semibold">{g.count}</span> · {pct}%
            </span>
          </div>
          {g.count > 0 ? (
            <div
              className="mt-1 flex h-2.5 rounded overflow-hidden bg-surface-2"
              style={{ width: `${Math.max(8, (g.count / maxCount) * 100)}%` }}
            >
              {segs.map((seg, i) => (
                <div
                  key={seg.status}
                  className={`${color} h-full ${i > 0 ? "border-l border-black/25" : ""} ${seg.muted ? "grayscale" : ""}`}
                  style={{ width: `${(seg.count / segTotal) * 100}%`, opacity: seg.muted ? 0.25 : segOpacity(i) }}
                  title={`${seg.status}: ${seg.count}${seg.muted ? " (completed)" : ""}`}
                />
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-muted/50 italic">none</div>
          )}
        </div>
      </button>
      {isOpen && g.deals.length > 0 && <DrillTable deals={g.deals} indent={false} />}
      {node.children && node.children.length > 0 && (
        <div className="ml-[0.65rem] border-l border-t-border pl-4 mt-0.5 space-y-0.5">
          {node.children.map((c) => (
            <TreeNode
              key={c.key}
              node={c}
              byKey={byKey}
              maxCount={maxCount}
              total={total}
              expanded={expanded}
              setExpanded={setExpanded}
              connector
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchFunnel({ buckets, total }: { buckets: DesignFunnelGroup[]; total: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const byKey = useMemo(() => Object.fromEntries(buckets.map((b) => [b.key, b])) as Record<string, DesignFunnelGroup>, [buckets]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="bg-surface rounded-xl border border-t-border p-5">
      <h3 className="text-sm font-semibold text-foreground/80 mb-1">Design Status Funnel</h3>
      <p className="text-xs text-muted mb-4">
        Where all {total.toLocaleString()} active projects sit — Awaiting Site Survey branches into the design path
      </p>
      <TreeNode
        node={FUNNEL_TREE}
        byKey={byKey}
        maxCount={maxCount}
        total={total}
        expanded={expanded}
        setExpanded={setExpanded}
        connector={false}
      />
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
          <BranchFunnel buckets={data.buckets} total={data.totalProjects} />
        ) : (
          <PositionPanel
            title="Deal Stage — Design Status Breakdown"
            subtitle={`Design status of all ${data.totalProjects.toLocaleString()} active projects, by pipeline stage`}
            groups={data.stageBreakdown}
            total={data.totalProjects}
            colorFor={(g) => STAGE_COLORS[g.label] || "bg-zinc-500"}
          />
        )}
      </div>
    </DashboardShell>
  );
}
