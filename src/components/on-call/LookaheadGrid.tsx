"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

type Pool = { poolId: string; poolName: string; date: string };

type AssignmentsResp = {
  assignments: Array<{
    poolId: string;
    poolName: string;
    date: string;
    crewMemberName: string;
    source: string;
  }>;
};

function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isWeekend(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}
function dayLabel(date: string): { num: string; wd: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  return { num: String(d), wd };
}

const POOL_CELL: Record<string, string> = {
  California: "bg-orange-500/10 border-orange-500/20",
  Denver: "bg-blue-500/10 border-blue-500/20",
  "Southern CO": "bg-emerald-500/10 border-emerald-500/20",
};

export function LookaheadGrid({ pools, days }: { pools: Pool[]; days: number }) {
  const today = pools[0]?.date ?? new Date().toISOString().slice(0, 10);
  const from = today;
  const to = addDaysISO(today, days - 1);

  const q = useQuery<AssignmentsResp>({
    queryKey: queryKeys.onCall.assignments(null, from, to),
    queryFn: async () => {
      const res = await fetch(`/api/on-call/assignments?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const dateList = Array.from({ length: days }, (_, i) => addDaysISO(today, i));
  const byPoolByDate = new Map<string, Map<string, string>>();
  for (const a of q.data?.assignments ?? []) {
    const bucket = byPoolByDate.get(a.poolId) ?? new Map<string, string>();
    bucket.set(a.date, a.crewMemberName);
    byPoolByDate.set(a.poolId, bucket);
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        {/* Header row */}
        <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `140px repeat(${days}, 1fr)` }}>
          <div />
          {dateList.map((d) => {
            const { num, wd } = dayLabel(d);
            const isToday = d === today;
            const we = isWeekend(d);
            return (
              <div
                key={d}
                className={`text-center text-[10px] py-1 rounded ${
                  isToday ? "bg-orange-500/15 text-orange-300" : we ? "text-muted/60" : "text-muted"
                }`}
              >
                <div className="text-xs font-semibold">{num}</div>
                <div>{wd}</div>
              </div>
            );
          })}
        </div>

        {pools.map((p) => {
          const cellClass = POOL_CELL[p.poolName] ?? "bg-surface-2 border-t-border";
          return (
            <div
              key={p.poolId}
              className="grid gap-1 mb-1 items-center"
              style={{ gridTemplateColumns: `140px repeat(${days}, 1fr)` }}
            >
              <div className="text-xs font-semibold text-foreground px-2 py-2">{p.poolName}</div>
              {dateList.map((d) => {
                const name = byPoolByDate.get(p.poolId)?.get(d);
                const we = isWeekend(d);
                const isToday = d === today;
                return (
                  <div
                    key={d}
                    className={`border rounded px-1 py-2 text-center text-xs ${cellClass} ${
                      isToday ? "outline outline-2 outline-orange-400 outline-offset-[-2px] font-bold" : ""
                    } ${we ? "opacity-85" : ""}`}
                  >
                    {name ?? "—"}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
