"use client";

import type { AnalysisResult } from "@/lib/solar/adapters/worker-to-ui";
import { formatKwh, formatPercent } from "@/lib/solar/adapters/worker-to-ui";

interface DispatchSummaryProps {
  result: AnalysisResult;
}

/**
 * Energy balance + battery/curtailment/clipping view.
 * Only renders when dispatch data is available.
 */
export default function DispatchSummary({ result }: DispatchSummaryProps) {
  if (!result.energyBalance) return null;

  const eb = result.energyBalance;

  return (
    <div className="rounded-lg border border-t-border bg-card p-3 sm:p-5 space-y-4" role="region" aria-label="Energy balance">
      <h3 className="text-sm font-medium text-foreground">
        Energy Balance
      </h3>

      {/* Primary flow */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <BalanceRow label="Total Production" value={formatKwh(eb.totalProductionKwh)} />
        <BalanceRow label="Self-Consumed" value={formatKwh(eb.selfConsumedKwh)} />
        <BalanceRow label="Grid Export" value={formatKwh(eb.gridExportKwh)} />
        <BalanceRow label="Grid Import" value={formatKwh(eb.gridImportKwh)} />
        {result.clippingLossPct !== null && (
          <BalanceRow
            label="Clipping Loss"
            value={formatPercent(result.clippingLossPct)}
          />
        )}
        {result.curtailedKwh !== null && result.curtailedKwh > 0 && (
          <BalanceRow label="Curtailed" value={formatKwh(result.curtailedKwh)} />
        )}
      </div>

      {/* Battery section */}
      {result.hasBattery && (
        <div className="border-t border-t-border pt-3 space-y-2">
          <p className="text-xs text-muted font-medium">Battery</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <BalanceRow label="Charged" value={formatKwh(eb.batteryChargedKwh)} />
            <BalanceRow
              label="Discharged"
              value={formatKwh(eb.batteryDischargedKwh)}
            />
            <BalanceRow label="Round-trip Losses" value={formatKwh(eb.batteryLossesKwh)} />
          </div>
        </div>
      )}

      {/* Self-consumption ratio */}
      {eb.totalProductionKwh > 0 && (
        <div className="flex items-center justify-between text-xs text-muted border-t border-t-border pt-3">
          <span>Self-consumption ratio</span>
          <span className="font-medium text-foreground">
            {((eb.selfConsumedKwh / eb.totalProductionKwh) * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
