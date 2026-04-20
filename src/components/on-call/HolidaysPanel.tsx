"use client";

import { FEDERAL_HOLIDAYS } from "@/lib/on-call-holidays";

export function HolidaysPanel() {
  const thisYear = new Date().getFullYear();
  const holidays = FEDERAL_HOLIDAYS.filter((h) => h.date.startsWith(`${thisYear}-`));

  return (
    <div className="bg-surface border border-t-border rounded-lg p-5">
      <h3 className="text-sm font-semibold mb-2 text-foreground">Federal Holidays ({thisYear})</h3>
      <p className="text-xs text-muted mb-4">
        Used for workload fairness tracking. Holiday days are marked with ★ in the calendar view.
      </p>
      <div className="flex flex-wrap gap-2">
        {holidays.map((h) => (
          <span
            key={h.date}
            className="inline-block text-xs px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-300"
          >
            {h.name} · {h.date.slice(5)}
          </span>
        ))}
      </div>
    </div>
  );
}
