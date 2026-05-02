"use client";

import { useMemo } from "react";

interface Cell {
  dayOfWeek: number; // 1=Mon..7=Sun
  hour: number; // 0..23
  count: number;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HourHeatmap({ cells, loading }: { cells: Cell[]; loading?: boolean }) {
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    for (const c of cells) {
      if (c.dayOfWeek >= 1 && c.dayOfWeek <= 7) {
        g[c.dayOfWeek - 1][c.hour] = c.count;
        if (c.count > m) m = c.count;
      }
    }
    return { grid: g, max: m || 1 };
  }, [cells]);

  if (loading && cells.length === 0) {
    return <div className="h-48 bg-skeleton rounded animate-pulse" />;
  }

  return (
    <div className="text-[10px] text-muted">
      <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-px">
        <div />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className="text-center">{h % 3 === 0 ? h : ""}</div>
        ))}
        {grid.map((row, di) => (
          <>
            <div key={`label-${di}`} className="pr-1 text-right">{DAY_LABELS[di]}</div>
            {row.map((count, h) => {
              const intensity = count > 0 ? 0.15 + 0.85 * (count / max) : 0;
              const bg = count > 0 ? `rgba(6, 182, 212, ${intensity})` : "rgba(127, 127, 127, 0.06)";
              return (
                <div
                  key={`${di}-${h}`}
                  className="aspect-square rounded-sm border border-t-border/30"
                  style={{ background: bg }}
                  title={`${DAY_LABELS[di]} ${h}:00 — ${count} call${count === 1 ? "" : "s"}`}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}
