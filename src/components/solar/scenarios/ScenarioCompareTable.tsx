/**
 * Scenario Compare Table
 *
 * Shows baseline vs all scenario deltas in a table.
 * Includes quality badges and mixed-quality warnings.
 */

"use client";

import type { ScenarioResult, ScenarioDelta } from "@/lib/solar/scenarios/scenario-types";

interface ScenarioCompareTableProps {
  baselineName: string;
  baselineResult: ScenarioResult;
  deltas: ScenarioDelta[];
  hasMixedQuality: boolean;
}

export default function ScenarioCompareTable({
  baselineName,
  baselineResult,
  deltas,
  hasMixedQuality,
}: ScenarioCompareTableProps) {
  const b = baselineResult;

  return (
    <div className="space-y-3">
      {hasMixedQuality && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30" role="alert">
          <span className="text-yellow-400 text-xs">
            &#9888; Mixed quality comparison — some scenarios use Quick Estimate data. Deltas are approximate.
          </span>
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs text-left min-w-[600px]" role="table" aria-label="Scenario comparison">
          <thead>
            <tr className="border-b border-zinc-700 text-muted">
              <th scope="col" className="py-2 px-3 font-medium">Scenario</th>
              <th scope="col" className="py-2 px-3 font-medium">Quality</th>
              <th scope="col" className="py-2 px-3 font-medium text-right">Annual kWh</th>
              <th scope="col" className="py-2 px-3 font-medium text-right">System kW</th>
              <th scope="col" className="py-2 px-3 font-medium text-right">Yield kWh/kWp</th>
              <th scope="col" className="py-2 px-3 font-medium text-right">&Delta; Annual</th>
              <th scope="col" className="py-2 px-3 font-medium text-right">&Delta; %</th>
            </tr>
          </thead>
          <tbody>
            {/* Baseline row */}
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <td className="py-2 px-3 font-medium text-foreground">
                {baselineName}
                <span className="ml-1 text-[10px] text-muted">(baseline)</span>
              </td>
              <td className="py-2 px-3">
                <QualityBadge quality={b.quality} />
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(b.annualKwh, 0)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(b.systemSizeKw, 2)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{fmtNum(b.specificYield, 0)}</td>
              <td className="py-2 px-3 text-right text-muted">&mdash;</td>
              <td className="py-2 px-3 text-right text-muted">&mdash;</td>
            </tr>

            {/* Scenario rows */}
            {deltas.map((d) => (
              <tr key={d.scenarioId} className="border-b border-zinc-800">
                <td className="py-2 px-3 text-foreground">
                  {d.scenarioName}
                  {d.isMixedQuality && (
                    <span className="ml-1 text-yellow-400 text-[10px]" title="Mixed quality comparison">
                      &#9888;
                    </span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <QualityBadge quality={d.quality} />
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtNum(d.annualKwh, 0)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtNum(d.systemSizeKw, 2)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{fmtNum(d.specificYield, 0)}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  <DeltaValue value={d.deltaAnnualKwh} decimals={0} suffix=" kWh" />
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  <DeltaValue value={d.pctChangeAnnualKwh} decimals={1} suffix="%" />
                </td>
              </tr>
            ))}

            {deltas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-center text-muted text-xs">
                  No scenarios with results to compare. Add scenarios and run them to see comparisons.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QualityBadge({ quality }: { quality: "quick_estimate" | "full" }) {
  return quality === "quick_estimate" ? (
    <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium" aria-label="Quick Estimate quality">
      QE
    </span>
  ) : (
    <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium" aria-label="Full quality">
      Full
    </span>
  );
}

function DeltaValue({
  value,
  decimals,
  suffix,
}: {
  value: number;
  decimals: number;
  suffix: string;
}) {
  if (Math.abs(value) < 0.05) {
    return <span className="text-muted">0{suffix}</span>;
  }
  const color = value > 0 ? "text-emerald-400" : "text-red-400";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={color}>
      {sign}{fmtNum(value, decimals)}{suffix}
    </span>
  );
}

function fmtNum(val: number, decimals: number): string {
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
