'use client';

import { MetricCard } from '@/components/ui/MetricCard';
import type { CustomerSuccessSection } from '@/lib/shop-health-types';

function sentimentColor(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (value >= 75) return 'text-emerald-400';
  if (value >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <div className="bg-surface-2 rounded-xl p-4 flex flex-col items-center justify-center min-h-[80px] opacity-60">
      <span className="text-xs text-muted mb-1">{label}</span>
      <span className="text-sm text-muted italic">Coming soon</span>
    </div>
  );
}

export function CustomerSuccessSectionContent({
  data,
}: {
  data: CustomerSuccessSection;
}) {
  return (
    <div className="space-y-6">
      {/* Row 1: Core metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Sentiment Score"
          value={data.avgSentimentScore !== null ? data.avgSentimentScore : '—'}
          valueColor={sentimentColor(data.avgSentimentScore)}
          sub={data.avgSentimentScore !== null ? '/ 100' : undefined}
        />
        <MetricCard
          label="5-Star Reviews MTD"
          value={data.fiveStarReviewsMTD}
          sub={`/ ${data.fiveStarReviewsTarget} target`}
          valueColor={
            data.fiveStarReviewsMTD >= data.fiveStarReviewsTarget
              ? 'text-emerald-400'
              : data.fiveStarReviewsMTD >= data.fiveStarReviewsTarget * 0.5
                ? 'text-amber-400'
                : 'text-red-400'
          }
        />
        <ComingSoonCard label="NPS / CSAT" />
      </div>

      {/* Row 2: Communication health */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Avg Days Since Contact"
          value={data.avgDaysSinceContact !== null ? `${data.avgDaysSinceContact}d` : '—'}
          valueColor={
            data.avgDaysSinceContact !== null
              ? data.avgDaysSinceContact <= 3
                ? 'text-emerald-400'
                : data.avgDaysSinceContact <= 7
                  ? 'text-amber-400'
                  : 'text-red-400'
              : undefined
          }
        />
        <ComingSoonCard label="Proactive Update %" />
        <ComingSoonCard label="Open Escalations" />
        <ComingSoonCard label="Avg Escalation Age" />
      </div>

      {/* Row 3: Operational CX */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ComingSoonCard label="Avg Response Time" />
        <ComingSoonCard label="Avg Resolution Time" />
        <ComingSoonCard label="Change Orders/Job" />
        <ComingSoonCard label="Active Service Tickets" />
      </div>

      {/* Row 4: Sentiment distribution bar */}
      {data.sentimentDistribution.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted mb-3">
            Sentiment Distribution
          </h4>
          <div className="flex h-6 rounded-full overflow-hidden bg-surface-2">
            {data.sentimentDistribution.map((bucket) =>
              bucket.pct > 0 ? (
                <div
                  key={bucket.label}
                  className={`${bucket.color} transition-all relative group`}
                  style={{ width: `${Math.max(bucket.pct, 2)}%` }}
                  title={`${bucket.label}: ${bucket.count} (${bucket.pct}%)`}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    {bucket.pct >= 10 && (
                      <span className="text-[10px] font-semibold text-white drop-shadow-sm">
                        {Math.round(bucket.pct)}%
                      </span>
                    )}
                  </div>
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div className="bg-surface-elevated text-foreground text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap border border-border">
                      {bucket.label}: {bucket.count} ({bucket.pct}%)
                    </div>
                  </div>
                </div>
              ) : null
            )}
          </div>
          <div className="flex justify-between mt-2">
            {data.sentimentDistribution.map((bucket) => (
              <div key={bucket.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${bucket.color}`} />
                <span className="text-xs text-muted">{bucket.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
