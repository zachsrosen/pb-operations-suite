'use client';

import { memo, useState, useCallback } from 'react';
import type { DrilldownDeal } from '@/lib/shop-health-types';

interface DrilldownMetricCardProps {
  label: string;
  value: string | number | null;
  sub?: string;
  border?: string;
  valueColor?: string;
  subColor?: string;
  color?: string;
  /** Underlying deals — if provided, the card is clickable and expands a table. */
  deals?: DrilldownDeal[];
  /** Column header for the contextual date (e.g. "Close Date", "Install Date") */
  dateLabel?: string;
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export const DrilldownMetricCard = memo(function DrilldownMetricCard({
  label,
  value,
  sub,
  border,
  valueColor,
  subColor,
  color,
  deals,
  dateLabel,
}: DrilldownMetricCardProps) {
  const [open, setOpen] = useState(false);
  const hasDrilldown = deals && deals.length > 0;
  const effectiveValueColor = valueColor || color || 'text-foreground';

  const toggle = useCallback(() => {
    if (hasDrilldown) setOpen((prev) => !prev);
  }, [hasDrilldown]);

  return (
    <div className="flex flex-col">
      {/* Card */}
      <div
        onClick={toggle}
        className={`bg-surface-2 rounded-xl border border-t-border p-5 shadow-card ${border || ''} ${
          hasDrilldown ? 'cursor-pointer hover:ring-1 hover:ring-orange-500/30 transition-all select-none' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-muted text-sm font-medium">{label}</div>
          {hasDrilldown && (
            <svg
              className={`w-4 h-4 text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
        {value === null ? (
          <div className="h-9 w-20 bg-skeleton rounded animate-pulse mt-1" />
        ) : (
          <div
            key={String(value)}
            className={`text-3xl font-bold mt-1 animate-value-flash ${effectiveValueColor}`}
          >
            {value}
          </div>
        )}
        {sub && (
          <div className={`text-sm mt-1 ${subColor || 'text-muted'}`}>{sub}</div>
        )}
      </div>

      {/* Drill-down table */}
      {open && hasDrilldown && (
        <div className="mt-1 bg-surface-2/60 border border-border/50 rounded-lg overflow-hidden animate-in slide-in-from-top-1 duration-200">
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2 text-muted font-medium">Project</th>
                  <th className="text-right py-1.5 px-2 text-muted font-medium">Amount</th>
                  <th className="text-left py-1.5 px-2 text-muted font-medium">Stage</th>
                  <th className="text-left py-1.5 px-2 text-muted font-medium">PM</th>
                  {dateLabel && (
                    <th className="text-left py-1.5 px-2 text-muted font-medium">{dateLabel}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id} className="border-b border-border/30 hover:bg-surface/30">
                    <td className="py-1.5 px-2 text-foreground">
                      <a
                        href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || '23761816'}/deal/${deal.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-orange-400 hover:underline"
                        title={deal.name}
                      >
                        {deal.projectNumber || deal.name.slice(0, 30)}
                      </a>
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted tabular-nums">
                      {currency.format(deal.amount)}
                    </td>
                    <td className="py-1.5 px-2 text-muted truncate max-w-[120px]">{deal.stage}</td>
                    <td className="py-1.5 px-2 text-muted truncate max-w-[100px]">
                      {deal.pm ? deal.pm.split(' ')[0] : '—'}
                    </td>
                    {dateLabel && (
                      <td className="py-1.5 px-2 text-muted tabular-nums">{formatDate(deal.date)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
});
