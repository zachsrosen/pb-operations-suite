"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { isFederalHoliday } from "@/lib/on-call-holidays";

type Pool = { id: string; name: string; region: string; timezone: string };

type AssignmentsResp = {
  assignments: Array<{
    poolId: string;
    poolName: string;
    date: string;
    crewMemberName: string;
    source: string;
    originalCrewMemberName: string | null;
  }>;
};

type WorkloadResp = {
  poolId: string;
  month: string;
  byMember: Array<{ crewMemberId: string; crewMemberName: string; days: number; weekends: number; holidays: number }>;
};

function monthBoundaries(month: string): { from: string; to: string; cells: string[] } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) cells.push("");
  for (let d = 1; d <= lastDay; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push("");
  return { from, to, cells };
}

function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function OnCallMonthClient({ pools }: { pools: Pool[] }) {
  const [selectedPoolId, setSelectedPoolId] = useState(pools[0]?.id ?? "");
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );

  const { from, to, cells } = monthBoundaries(month);

  const assignmentsQ = useQuery<AssignmentsResp>({
    queryKey: queryKeys.onCall.assignments(selectedPoolId, from, to),
    queryFn: async () => {
      const res = await fetch(`/api/on-call/assignments?poolId=${selectedPoolId}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedPoolId,
  });

  const workloadQ = useQuery<WorkloadResp>({
    queryKey: queryKeys.onCall.workload(selectedPoolId, month),
    queryFn: async () => {
      const res = await fetch(`/api/on-call/workload?poolId=${selectedPoolId}&month=${month}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedPoolId,
  });

  const byDate = new Map<string, { name: string; source: string; original: string | null }>();
  for (const a of assignmentsQ.data?.assignments ?? []) {
    byDate.set(a.date, { name: a.crewMemberName, source: a.source, original: a.originalCrewMemberName });
  }

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const maxDays = Math.max(1, ...(workloadQ.data?.byMember.map((m) => m.days) ?? [1]));

  if (pools.length === 0) {
    return <div className="text-muted">No pools configured.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-surface-2 border border-t-border rounded p-1">
          {pools.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPoolId(p.id)}
              className={`px-3 py-1.5 text-xs rounded ${
                selectedPoolId === p.id ? "bg-blue-500/20 text-blue-300" : "text-muted"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={() => shiftMonth(-1)}
                  className="w-8 h-8 rounded border border-t-border text-muted">‹</button>
          <div className="font-semibold w-36 text-center">
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
          </div>
          <button type="button" onClick={() => shiftMonth(1)}
                  className="w-8 h-8 rounded border border-t-border text-muted">›</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Calendar */}
        <div className="bg-surface border border-t-border rounded-lg p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
              <div key={d} className="text-center text-[10px] text-muted py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`empty-${i}`} />;
              const asn = byDate.get(d);
              const we = isWeekend(d);
              const isToday = d === today;
              const isHoliday = isFederalHoliday(d);
              const isSwapped = asn?.source === "swap" || asn?.source === "pto-reassign";

              const bg = we ? "bg-purple-500/5 border-purple-500/15" : "bg-blue-500/5 border-blue-500/15";
              const ring = isToday ? "outline outline-2 outline-orange-400 outline-offset-[-2px]" : "";

              return (
                <div
                  key={d}
                  className={`min-h-[64px] border rounded p-1.5 text-xs flex flex-col justify-between relative ${bg} ${ring}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted">{Number(d.split("-")[2])}</span>
                    {isHoliday && <span className="text-[10px] text-yellow-400">★</span>}
                    {isSwapped && <span className="text-[10px] text-blue-400">↔</span>}
                  </div>
                  {asn && (
                    <div className="text-[11px] font-medium truncate" title={asn.name}>
                      {asn.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Workload */}
        <div className="bg-surface border border-t-border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-1">Workload — {month}</h3>
          <p className="text-xs text-muted mb-3">Days on-call this month</p>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[10px] uppercase text-muted mb-2 pb-1 border-b border-t-border">
            <span>Electrician</span>
            <span className="text-right">Days</span>
            <span className="text-right">Wkd</span>
            <span className="text-right">Hol</span>
          </div>
          <div className="space-y-2">
            {(workloadQ.data?.byMember ?? [])
              .sort((a, b) => b.days - a.days)
              .map((m) => (
                <div key={m.crewMemberId}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-xs items-center">
                    <span className="font-medium truncate">{m.crewMemberName}</span>
                    <span className="text-right tabular-nums">{m.days}</span>
                    <span className="text-right tabular-nums text-muted">{m.weekends}</span>
                    <span className="text-right tabular-nums text-yellow-400">{m.holidays}</span>
                  </div>
                  <div className="mt-1 h-1 bg-white/5 rounded">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded"
                      style={{ width: `${(m.days / maxDays) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            {(workloadQ.data?.byMember.length ?? 0) === 0 && (
              <div className="text-xs text-muted italic">No assignments yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
