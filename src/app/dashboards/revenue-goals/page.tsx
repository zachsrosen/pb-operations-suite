"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { REVENUE_GROUPS } from "@/lib/revenue-groups-config"; // Client-safe import (NOT revenue-goals.ts which has server deps)
import { useToast } from "@/contexts/ToastContext";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface ConfigResponse {
  year: number;
  groups: Record<string, { month: number; target: number }[]>;
}

export default function RevenueGoalsConfigPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [edits, setEdits] = useState<Record<string, number[]>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["revenue-goals-config", year],
    queryFn: async () => {
      const res = await fetch(`/api/revenue-goals/config?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  // Sync fetched data into edits
  useEffect(() => {
    if (!data) return;
    const initial: Record<string, number[]> = {};
    for (const [groupKey, _group] of Object.entries(REVENUE_GROUPS)) {
      const months = data.groups[groupKey] || [];
      initial[groupKey] = months.map((m) => m.target);
    }
    setEdits(initial);
    setHasChanges(false);
  }, [data]);

  const updateCell = useCallback((groupKey: string, monthIdx: number, value: number) => {
    setEdits((prev) => {
      const next = { ...prev };
      next[groupKey] = [...(next[groupKey] || [])];
      next[groupKey][monthIdx] = value;
      return next;
    });
    setHasChanges(true);
  }, []);

  const resetToEven = useCallback((groupKey: string) => {
    const group = REVENUE_GROUPS[groupKey];
    if (!group) return;
    const even = group.annualTarget / 12;
    setEdits((prev) => ({
      ...prev,
      [groupKey]: Array(12).fill(Math.round(even * 100) / 100),
    }));
    setHasChanges(true);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targets: { groupKey: string; month: number; target: number }[] = [];
      for (const [groupKey, months] of Object.entries(edits)) {
        months.forEach((target, i) => {
          targets.push({ groupKey, month: i + 1, target });
        });
      }
      const res = await fetch("/api/revenue-goals/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, targets }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      addToast({ title: "Revenue goals saved", type: "success" });
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.revenueGoals.root });
      queryClient.invalidateQueries({ queryKey: ["revenue-goals-config", year] });
    },
    onError: () => addToast({ title: "Failed to save revenue goals", type: "error" }),
  });

  return (
    <DashboardShell title="Revenue Goal Config" accentColor="orange">
      <div className="flex items-center gap-4 mb-6">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="bg-surface-2 text-foreground rounded-lg px-3 py-2 border border-t-border"
        >
          {[2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 hover:bg-orange-600 transition-colors"
        >
          {saveMutation.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 bg-surface-2 rounded-xl" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-t-border">
                <th className="text-left py-2 px-2 text-muted font-medium">Group</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="text-center py-2 px-1 text-muted font-medium text-xs">{m}</th>
                ))}
                <th className="text-center py-2 px-2 text-muted font-medium">Annual</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {Object.entries(REVENUE_GROUPS).map(([groupKey, group]) => {
                const months = edits[groupKey] || Array(12).fill(0);
                const annual = months.reduce((s: number, t: number) => s + t, 0);

                return (
                  <tr key={groupKey} className="border-b border-t-border/50">
                    <td className="py-2 px-2 font-medium" style={{ color: group.color }}>
                      {group.label}
                    </td>
                    {months.map((target: number, i: number) => (
                      <td key={i} className="py-1 px-0.5">
                        <input
                          type="number"
                          value={Math.round(target)}
                          onChange={(e) => updateCell(groupKey, i, Number(e.target.value))}
                          className="w-full bg-surface-2 text-foreground text-center text-xs rounded px-1 py-1 border border-t-border/50 focus:border-orange-500 focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="py-2 px-2 text-center text-xs text-muted font-medium">
                      ${(annual / 1_000_000).toFixed(2)}M
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => resetToEven(groupKey)}
                        className="text-[10px] text-muted hover:text-foreground"
                        title="Reset to even monthly split"
                      >
                        Reset
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
