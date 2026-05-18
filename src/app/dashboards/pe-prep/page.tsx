"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Types — minimal subset of PeDeal needed for the queue view
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStageLabel: string;
  systemType: "solar" | "battery" | "solar+battery";
  peM1Status: string | null;
  peM2Status: string | null;
  milestoneHighlight: "m1" | "m2" | "complete" | null;
  inspectionPassDate: string | null;
  ptoGrantedDate: string | null;
  hubspotUrl: string;
  pePortalUrl: string | null;
}

interface LatestRunSummary {
  auditRunId: string;
  status: string;
  completedAt: string | null;
  mode: string;
  found: number;
  missing: number;
  needsReview: number;
  notApplicable: number;
  totalItems: number;
  assembled: boolean;
}

interface DealAuditRuns {
  m1?: LatestRunSummary;
  m2?: LatestRunSummary;
}

// ---------------------------------------------------------------------------
// Milestone derivation — based on deal stage (matches pe-submission-gap logic).
//
// PE submission milestones map 1:1 to deal stages:
//   - "Permission to Operate" / PTO  → M1 audit (inspection done, submitting M1)
//   - "Close Out"                    → M2 audit (PTO granted, submitting M2)
//   - Anything else                  → excluded from the queue
//
// We deliberately ignore peM1Status / peM2Status because those reflect
// portal state (submitted/approved/paid), not "what audit does this deal
// need next?". A PM running prep wants the deal lined up with its current
// pipeline stage.
// ---------------------------------------------------------------------------

type ActiveMilestone = "m1" | "m2" | "out-of-scope";

function dealStageToActiveMilestone(stageLabel: string): ActiveMilestone {
  const s = (stageLabel ?? "").toLowerCase();
  if (s.includes("close out")) return "m2";
  if (s.includes("permission to operate") || s.includes("pto")) return "m1";
  return "out-of-scope";
}

function deriveActiveMilestone(deal: PeDeal): ActiveMilestone {
  return dealStageToActiveMilestone(deal.dealStageLabel);
}

function statusBadgeColor(status: string | null): string {
  if (!status) return "bg-surface-2 text-muted";
  const s = status.toLowerCase();
  if (s === "paid") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (s === "approved") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s === "submitted") return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
  if (s.includes("rejected") || s.includes("declined")) return "bg-red-500/20 text-red-400 border-red-500/30";
  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
}

function readinessBadge(run: LatestRunSummary | undefined): { label: string; color: string } {
  if (!run) return { label: "Not yet audited", color: "bg-surface-2 text-muted border-t-border" };
  if (run.status === "running") return { label: "Audit running…", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
  const { found, missing, needsReview, totalItems } = run;
  // Effective ready = found, ignoring N/A
  const effectiveTotal = totalItems - run.notApplicable;
  if (missing === 0 && needsReview === 0 && effectiveTotal > 0) {
    return { label: `✓ Ready (${found}/${effectiveTotal})`, color: "bg-green-500/20 text-green-400 border-green-500/30" };
  }
  if (missing > 0) {
    return { label: `${missing} missing, ${found}/${effectiveTotal} ✓`, color: "bg-red-500/20 text-red-400 border-red-500/30" };
  }
  return { label: `${needsReview} to review, ${found}/${effectiveTotal} ✓`, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PePrepLandingPage() {
  const [milestoneFilter, setMilestoneFilter] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [systemTypeFilter, setSystemTypeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const { data: dealsData, isLoading: dealsLoading } = useQuery<{ deals: PeDeal[]; lastUpdated: string }>({
    queryKey: queryKeys.peDeals.list(),
    queryFn: () => fetch("/api/accounting/pe-deals").then((r) => r.json()),
    staleTime: 60_000,
  });

  // Active deals = anything currently in PTO or Close Out stage.
  // Deals in earlier stages (pre-construction, construction, inspection)
  // can't usefully be audited yet; deals past close-out are already done.
  const activeDeals = useMemo(() => {
    if (!dealsData?.deals) return [];
    return dealsData.deals.filter((d) => deriveActiveMilestone(d) !== "out-of-scope");
  }, [dealsData]);

  const dealIds = useMemo(() => activeDeals.map((d) => d.dealId), [activeDeals]);

  const { data: runsData } = useQuery<{ runs: Record<string, DealAuditRuns> }>({
    queryKey: ["pe-prep", "audit-runs", dealIds.join(",")],
    queryFn: () => fetch(`/api/pe-prep/audit-runs?dealIds=${encodeURIComponent(dealIds.join(","))}`).then((r) => r.json()),
    enabled: dealIds.length > 0,
    staleTime: 30_000,
  });

  // Filter options derived from the deal list
  const locationOptions = useMemo(() => {
    const set = new Set(activeDeals.map((d) => d.pbLocation).filter(Boolean));
    return Array.from(set).sort();
  }, [activeDeals]);

  const filteredDeals = useMemo(() => {
    const q = search.toLowerCase().trim();
    return activeDeals.filter((deal) => {
      const ms = deriveActiveMilestone(deal);
      if (milestoneFilter.length > 0 && !milestoneFilter.includes(ms)) return false;
      if (locationFilter.length > 0 && !locationFilter.includes(deal.pbLocation)) return false;
      if (systemTypeFilter.length > 0 && !systemTypeFilter.includes(deal.systemType)) return false;
      if (q && !deal.dealName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeDeals, milestoneFilter, locationFilter, systemTypeFilter, search]);

  // `mountTime` is captured once at mount via useState initializer (pure
  // for React's purity rule). Stale by minutes is fine for the "audited in
  // last 24h" stat; pages get refreshed frequently anyway.
  const [mountTime] = useState(() => Date.now());

  // Stat tiles
  const stats = useMemo(() => {
    let m1Pending = 0;
    let m2Pending = 0;
    let readyToSubmit = 0;
    let neverAudited = 0;
    let recentlyAudited = 0;
    const cutoff = mountTime - 24 * 60 * 60 * 1000;

    for (const deal of filteredDeals) {
      const ms = deriveActiveMilestone(deal);
      if (ms === "m1") m1Pending++;
      if (ms === "m2") m2Pending++;

      const runs = runsData?.runs[deal.dealId];
      const run = ms === "m1" ? runs?.m1 : runs?.m2;
      if (!run) neverAudited++;
      else {
        if (run.completedAt && new Date(run.completedAt).getTime() > cutoff) recentlyAudited++;
        if (run.missing === 0 && run.needsReview === 0 && run.totalItems > 0) readyToSubmit++;
      }
    }

    return { m1Pending, m2Pending, readyToSubmit, neverAudited, recentlyAudited };
  }, [filteredDeals, runsData, mountTime]);

  return (
    <DashboardShell
      title="PE Prep Queue"
      subtitle="Audit-ready deals for Participate Energy submission"
      accentColor="orange"
      lastUpdated={dealsData?.lastUpdated}
      fullWidth
    >
      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="M1 pending" value={stats.m1Pending} color="orange" />
        <StatCard label="M2 pending" value={stats.m2Pending} color="cyan" />
        <StatCard label="Ready to submit" value={stats.readyToSubmit} color="green" />
        <StatCard label="Never audited" value={stats.neverAudited} color="yellow" />
        <StatCard label="Audited in last 24h" value={stats.recentlyAudited} color="blue" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Search deal name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-surface border border-t-border text-foreground text-sm min-w-[240px]"
        />
        <MultiSelectFilter
          label="Milestone"
          options={[
            { value: "m1", label: "M1 — Inspection Complete" },
            { value: "m2", label: "M2 — Project Complete" },
          ]}
          selected={milestoneFilter}
          onChange={setMilestoneFilter}
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions.map((loc) => ({ value: loc, label: loc }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="System type"
          options={[
            { value: "solar", label: "Solar" },
            { value: "battery", label: "Battery" },
            { value: "solar+battery", label: "Solar + Battery" },
          ]}
          selected={systemTypeFilter}
          onChange={setSystemTypeFilter}
        />
        <div className="text-xs text-muted ml-auto">
          {filteredDeals.length} of {activeDeals.length} deals
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-t-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Deal</th>
              <th className="text-left px-3 py-2 font-medium">Location</th>
              <th className="text-left px-3 py-2 font-medium">System</th>
              <th className="text-left px-3 py-2 font-medium">Active milestone</th>
              <th className="text-left px-3 py-2 font-medium">PE status</th>
              <th className="text-left px-3 py-2 font-medium">Last audit</th>
              <th className="text-left px-3 py-2 font-medium">Readiness</th>
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {dealsLoading && (
              <tr>
                <td colSpan={8} className="text-center text-muted py-8">Loading deals…</td>
              </tr>
            )}
            {!dealsLoading && filteredDeals.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted py-8">No deals match the current filters.</td>
              </tr>
            )}
            {filteredDeals.map((deal) => {
              const ms = deriveActiveMilestone(deal);
              const runs = runsData?.runs[deal.dealId];
              const run = ms === "m1" ? runs?.m1 : runs?.m2;
              const peStatus = ms === "m1" ? deal.peM1Status : deal.peM2Status;
              const readiness = readinessBadge(run);
              return (
                <tr key={deal.dealId} className="border-t border-t-border hover:bg-surface-2/40">
                  <td className="px-3 py-2 text-foreground">
                    <Link href={`/dashboards/pe-prep/${deal.dealId}`} className="hover:underline">
                      {deal.dealName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{deal.pbLocation}</td>
                  <td className="px-3 py-2 text-muted">{deal.systemType}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${ms === "m1" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"}`}>
                      {ms.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusBadgeColor(peStatus)}`}>
                      {peStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {run?.completedAt ? formatRelativeTime(run.completedAt) : run?.status === "running" ? "running" : "never"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${readiness.color}`}>
                      {readiness.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/dashboards/pe-prep/${deal.dealId}`}
                      className="inline-block px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-md text-xs font-medium"
                    >
                      Open audit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
