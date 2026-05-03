"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatDateTime, formatPercent } from "./formatters";

interface SummaryResponse {
  period: { from: string; to: string };
  totals: {
    total: number;
    resolvedRemotely: number;
    dispatched: number;
    escalated: number;
    safetyRisks: number;
    totalHoursWorked: number;
    remoteResolutionRate: number;
    escalationRate: number;
  };
  byIssue: Array<{ issueType: string; count: number }>;
  byElectrician: Array<{
    id: string;
    name: string;
    total: number;
    resolvedRemotely: number;
    dispatched: number;
    hoursWorked: number;
    lastCall: string;
    remoteResolutionRate: number;
  }>;
  recent: Array<{
    id: string;
    callReceivedAt: string;
    customerName: string;
    customerAddress: string | null;
    issueType: string;
    safetyRisk: boolean;
    resolvedRemotely: boolean;
    dispatched: boolean;
    escalatedTo: string | null;
    electrician: string;
    poolName: string;
  }>;
}

interface Props {
  from: string;
  to: string;
}

const ISSUE_LABELS: Record<string, string> = {
  inverter: "Inverter",
  "no-production": "No Production",
  battery: "Battery",
  monitoring: "Monitoring Offline",
  roofing: "Roofing",
  safety: "Safety / Urgent",
  other: "Other",
};

function issueLabel(issueType: string): string {
  if (issueType.startsWith("other: ")) return issueType.slice(7);
  return ISSUE_LABELS[issueType] ?? issueType;
}

export function OnCallSummary({ from, to }: Props) {
  const params = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("from", from);
    sp.set("to", to);
    return sp.toString();
  }, [from, to]);

  const q = useQuery<SummaryResponse>({
    queryKey: ["on-call:summary", params],
    queryFn: async () => {
      const res = await fetch(`/api/on-call/summary?${params}`);
      if (!res.ok) throw new Error("Failed to load on-call summary");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  if (q.isLoading) return <div className="h-48 bg-skeleton rounded animate-pulse" />;
  if (q.isError || !q.data) {
    return <div className="text-sm text-muted py-4">Failed to load on-call calls.</div>;
  }
  const data = q.data;
  const { totals, byIssue, byElectrician, recent } = data;

  if (totals.total === 0) {
    return (
      <div className="text-sm text-muted py-6 text-center">
        No on-call calls in this range. The on-call rotation will populate this section once electricians log calls.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top-line metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="On-Call Calls" value={totals.total.toLocaleString()} sub={`${totals.safetyRisks} safety risk`} />
        <Tile label="Resolved Remotely" value={formatPercent(totals.remoteResolutionRate)} sub={`${totals.resolvedRemotely} of ${totals.total}`} />
        <Tile label="Dispatched" value={totals.dispatched.toLocaleString()} sub={`${(totals.totalHoursWorked).toFixed(1)} hrs worked`} />
        <Tile label="Escalation Rate" value={formatPercent(totals.escalationRate)} sub={`${totals.escalated} escalated`} />
        <Tile label="Total Hours" value={`${totals.totalHoursWorked.toFixed(1)} hr`} sub="dispatched work" />
        <Tile label="Period" value={`${new Date(data.period.from).toLocaleDateString(undefined, { month: "short", day: "numeric" })} →`} sub={`${new Date(data.period.to).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`} />
      </div>

      {/* By electrician */}
      {byElectrician.length > 0 ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted mb-2">By Electrician</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-xs uppercase text-muted">
                  <th className="py-2 px-2 text-left">Electrician</th>
                  <th className="py-2 px-2 text-right">Calls</th>
                  <th className="py-2 px-2 text-right">Remote</th>
                  <th className="py-2 px-2 text-right">Dispatched</th>
                  <th className="py-2 px-2 text-right">Remote Rate</th>
                  <th className="py-2 px-2 text-right">Hours</th>
                  <th className="py-2 px-2 text-right">Last Call</th>
                </tr>
              </thead>
              <tbody>
                {byElectrician.map((e) => (
                  <tr key={e.id} className="border-b border-t-border/40 hover:bg-surface-2/50">
                    <td className="py-2 px-2 text-foreground">{e.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{e.total}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{e.resolvedRemotely}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{e.dispatched}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatPercent(e.remoteResolutionRate)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{e.hoursWorked.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatDateTime(e.lastCall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* By issue type */}
      {byIssue.length > 0 ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted mb-2">By Issue Type</h4>
          <div className="flex flex-wrap gap-2">
            {byIssue.map((b) => (
              <span key={b.issueType} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-t-border text-sm">
                <span className="text-foreground">{issueLabel(b.issueType)}</span>
                <span className="text-muted tabular-nums">{b.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Recent calls */}
      {recent.length > 0 ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted mb-2">Recent Calls</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border text-xs uppercase text-muted">
                  <th className="py-2 px-2 text-left">Time</th>
                  <th className="py-2 px-2 text-left">Customer</th>
                  <th className="py-2 px-2 text-left">Issue</th>
                  <th className="py-2 px-2 text-left">Outcome</th>
                  <th className="py-2 px-2 text-left">Electrician</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-t-border/40 hover:bg-surface-2/50">
                    <td className="py-2 px-2 whitespace-nowrap tabular-nums">{formatDateTime(r.callReceivedAt)}</td>
                    <td className="py-2 px-2 text-foreground">
                      {r.customerName}
                      {r.customerAddress ? <div className="text-xs text-muted">{r.customerAddress}</div> : null}
                    </td>
                    <td className="py-2 px-2">
                      <span className="text-xs px-2 py-0.5 rounded border bg-surface-2 border-t-border">{issueLabel(r.issueType)}</span>
                      {r.safetyRisk ? <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-red-500/15 border-red-500/30 text-red-300">Safety</span> : null}
                    </td>
                    <td className="py-2 px-2">
                      {r.resolvedRemotely ? <span className="text-xs px-2 py-0.5 rounded border bg-emerald-500/15 border-emerald-500/30 text-emerald-300">Remote</span> : null}
                      {r.dispatched ? <span className="text-xs px-2 py-0.5 rounded border bg-blue-500/15 border-blue-500/30 text-blue-300">Dispatched</span> : null}
                      {r.escalatedTo ? <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-amber-500/15 border-amber-500/30 text-amber-300" title={`Escalated to ${r.escalatedTo}`}>Escalated</span> : null}
                    </td>
                    <td className="py-2 px-2 text-foreground">{r.electrician}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-2 border border-t-border rounded-lg px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold text-foreground tabular-nums mt-0.5">{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </div>
  );
}
