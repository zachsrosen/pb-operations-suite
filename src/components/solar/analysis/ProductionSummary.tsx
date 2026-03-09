"use client";

import type { AnalysisResult } from "@/lib/solar/adapters/worker-to-ui";
import { formatKwh, MONTH_LABELS } from "@/lib/solar/adapters/worker-to-ui";

interface ProductionSummaryProps {
  result: AnalysisResult;
}

export default function ProductionSummary({ result }: ProductionSummaryProps) {
  const maxMonthly = Math.max(...result.monthlyKwh, 1);

  return (
    <div className="rounded-lg border border-t-border bg-card p-3 sm:p-5 space-y-4" role="region" aria-label="Production summary">
      <h3 className="text-sm font-medium text-foreground">
        Production Summary
      </h3>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          label="Annual Production"
          value={formatKwh(result.annualKwh)}
          accent
        />
        <MetricCard
          label="System Size"
          value={`${result.systemSizeKw.toFixed(2)} kWp`}
        />
        <MetricCard
          label="Panel Count"
          value={String(result.panelCount)}
        />
        <MetricCard
          label="Specific Yield"
          value={`${Math.round(result.specificYield)} kWh/kWp`}
        />
      </div>

      {/* Monthly bar chart */}
      <div>
        <p className="text-xs text-muted mb-2">Monthly Production</p>
        <div className="flex items-end gap-0.5 sm:gap-1 h-24 sm:h-32" role="img" aria-label="Monthly production bar chart">
          {result.monthlyKwh.map((kwh, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 sm:gap-1">
              <div
                className="w-full bg-orange-500/60 rounded-t transition-all hover:bg-orange-500/80"
                style={{
                  height: `${(kwh / maxMonthly) * 100}%`,
                  minHeight: kwh > 0 ? "2px" : "0px",
                }}
                title={`${MONTH_LABELS[i]}: ${formatKwh(kwh)}`}
                aria-label={`${MONTH_LABELS[i]}: ${formatKwh(kwh)}`}
              />
              <span className="text-[8px] sm:text-[9px] text-muted/60">
                {MONTH_LABELS[i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* TSRF */}
      <div className="flex items-center justify-between text-xs text-muted border-t border-t-border pt-3">
        <span>System TSRF</span>
        <span>{(result.systemTsrf * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={`text-lg font-semibold ${
          accent ? "text-orange-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
