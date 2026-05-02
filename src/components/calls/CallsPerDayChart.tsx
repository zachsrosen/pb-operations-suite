"use client";

import { useMemo } from "react";

import { formatDate } from "./formatters";

interface Row {
  date: string;
  inbound: number;
  outbound: number;
  missed: number;
}

export function CallsPerDayChart({ data, loading }: { data: Row[]; loading?: boolean }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.inbound + d.outbound + d.missed)), [data]);

  if (loading && data.length === 0) {
    return <div className="h-48 bg-skeleton rounded animate-pulse" />;
  }
  if (data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm text-muted">No calls in this range.</div>;
  }

  return (
    <div className="flex items-end gap-1 h-48 overflow-x-auto" role="img" aria-label="Calls per day">
      {data.map((d) => {
        const total = d.inbound + d.outbound + d.missed;
        const totalH = Math.round((total / max) * 100);
        const inH = total > 0 ? Math.round((d.inbound / total) * totalH) : 0;
        const outH = total > 0 ? Math.round((d.outbound / total) * totalH) : 0;
        const missH = Math.max(0, totalH - inH - outH);
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 min-w-[18px]" title={`${d.date}: ${total} (${d.inbound} in, ${d.outbound} out, ${d.missed} missed)`}>
            <div className="w-full flex flex-col-reverse" style={{ height: "100%" }}>
              <div className="bg-cyan-500/70 rounded-b-sm" style={{ height: `${inH}%` }} aria-hidden />
              <div className="bg-blue-500/70" style={{ height: `${outH}%` }} aria-hidden />
              <div className="bg-red-500/70 rounded-t-sm" style={{ height: `${missH}%` }} aria-hidden />
            </div>
            <div className="text-[10px] text-muted whitespace-nowrap rotate-[-30deg] origin-top-left h-4">
              {formatDate(d.date)}
            </div>
          </div>
        );
      })}
      <div className="ml-auto text-[11px] text-muted flex flex-col gap-1">
        <span><span className="inline-block w-2 h-2 bg-cyan-500/70 rounded-sm mr-1" />Inbound</span>
        <span><span className="inline-block w-2 h-2 bg-blue-500/70 rounded-sm mr-1" />Outbound</span>
        <span><span className="inline-block w-2 h-2 bg-red-500/70 rounded-sm mr-1" />Missed</span>
      </div>
    </div>
  );
}
