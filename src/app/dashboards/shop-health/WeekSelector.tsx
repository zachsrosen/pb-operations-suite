'use client';

import { getWeekStart } from '@/lib/shop-health-utils';

interface WeekSelectorProps {
  weekStart: Date;
  onChange: (newWeekStart: Date) => void;
}

export function WeekSelector({ weekStart, onChange }: WeekSelectorProps) {
  const currentWeek = getWeekStart(new Date());
  const isCurrentWeek = weekStart.getTime() === currentWeek.getTime();
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

  function addWeeks(d: Date, n: number): Date {
    return new Date(d.getTime() + n * 7 * 24 * 60 * 60 * 1000);
  }

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtYear = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(addWeeks(weekStart, -1))}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
        title="Previous week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-sm font-medium text-foreground min-w-[180px] text-center">
        {fmt(weekStart)} &ndash; {fmtYear(weekEnd)}
        {isCurrentWeek && <span className="ml-2 text-xs text-muted">(current)</span>}
      </span>
      <button
        onClick={() => onChange(addWeeks(weekStart, 1))}
        disabled={isCurrentWeek}
        className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next week"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
