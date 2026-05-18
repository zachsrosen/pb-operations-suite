"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

interface ActionTask {
  id: string;
  dealId: string;
  pCode: string;
  severity: "critical" | "major" | "conditional" | "monitoring";
  category: string;
  title: string;
  message: string;
  action: string;
  status: "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED";
  createdAt: string;
  lastSeenRunId: string | null;
}

interface QueueResponse {
  tasks: ActionTask[];
  stats: {
    openCritical: number;
    openMajor: number;
    openConditional: number;
    openMonitoring: number;
    resolvedThisWeek: number;
    dealsAffected: number;
  };
}

const SEVERITY_BADGE: Record<ActionTask["severity"], string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  major: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  conditional: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  monitoring: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export default function PeActionQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter] = useState<string>("OPEN");
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [pCodeFilter, setPCodeFilter] = useState<string[]>([]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams({ status: statusFilter });
    if (severityFilter.length > 0) sp.set("severity", severityFilter.join(","));
    if (pCodeFilter.length > 0) sp.set("pCode", pCodeFilter.join(","));
    return sp.toString();
  }, [statusFilter, severityFilter, pCodeFilter]);

  const { data, isLoading } = useQuery<QueueResponse>({
    queryKey: ["pe-crossref", "queue", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/pe-crossref/queue?${queryString}`);
      if (!res.ok) throw new Error("Failed to load queue");
      return res.json();
    },
  });

  const patchTask = useMutation({
    mutationFn: async (vars: { taskId: string; action: "resolve" | "dismiss" | "reopen"; reason?: string }) => {
      const res = await fetch(`/api/pe-crossref/tasks/${vars.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: vars.action, reason: vars.reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pe-crossref", "queue"] }),
  });

  const tasks = data?.tasks ?? [];
  const stats = data?.stats;

  // Unique P-code list for the filter, sorted
  const pCodeOptions = useMemo(() => {
    const set = new Set(tasks.map((t) => t.pCode));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [tasks]);

  return (
    <DashboardShell
      title="PE Action Queue"
      subtitle="Cross-deal action tasks from the equipment cross-reference"
      accentColor="red"
      fullWidth
    >
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <StatCard label="Open critical" value={stats.openCritical} color="red" />
          <StatCard label="Open major" value={stats.openMajor} color="orange" />
          <StatCard label="Open conditional" value={stats.openConditional} color="yellow" />
          <StatCard label="Open monitoring" value={stats.openMonitoring} color="blue" />
          <StatCard label="Deals affected" value={stats.dealsAffected} color="purple" />
          <StatCard label="Resolved (7d)" value={stats.resolvedThisWeek} color="green" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectFilter
          label="Severity"
          options={[
            { value: "critical", label: "Critical" },
            { value: "major", label: "Major" },
            { value: "conditional", label: "Conditional" },
            { value: "monitoring", label: "Monitoring" },
          ]}
          selected={severityFilter}
          onChange={setSeverityFilter}
        />
        <MultiSelectFilter
          label="P-code"
          options={pCodeOptions}
          selected={pCodeFilter}
          onChange={setPCodeFilter}
        />
        <div className="text-xs text-muted ml-auto">{tasks.length} tasks shown</div>
      </div>

      <div className="rounded-lg border border-t-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium">P</th>
              <th className="text-left px-3 py-2 font-medium">Deal</th>
              <th className="text-left px-3 py-2 font-medium">Title</th>
              <th className="text-left px-3 py-2 font-medium">Message</th>
              <th className="text-left px-3 py-2 font-medium">Created</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-8">Loading…</td>
              </tr>
            )}
            {!isLoading && tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-8">No open action tasks.</td>
              </tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-t-border hover:bg-surface-2/40 align-top">
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[t.severity]}`}>
                    {t.pCode}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/dashboards/pe-prep/${t.dealId}`} className="text-orange-400 hover:underline">
                    {t.dealId}
                  </Link>
                </td>
                <td className="px-3 py-2 font-semibold text-foreground">{t.title}</td>
                <td className="px-3 py-2 text-muted max-w-md">{t.message}</td>
                <td className="px-3 py-2 text-muted text-xs whitespace-nowrap">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => patchTask.mutate({ taskId: t.id, action: "resolve" })}
                    className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 mr-1"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt("Reason for dismissing this task?") ?? "";
                      if (reason.trim()) patchTask.mutate({ taskId: t.id, action: "dismiss", reason });
                    }}
                    className="text-[10px] px-2 py-0.5 bg-zinc-500/20 text-zinc-400 rounded hover:bg-zinc-500/30"
                  >
                    ✗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
