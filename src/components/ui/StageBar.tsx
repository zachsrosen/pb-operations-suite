"use client";

import { getStageColorClass, STAGE_DISPLAY_ORDER } from "@/lib/config";

export interface StageBarProps {
  stage: string;
  count: number;
  total: number;
}

export function StageBar({ stage, count, total }: StageBarProps) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  const colorClass = getStageColorClass(stage);

  return (
    <div className="flex items-center gap-4">
      <div className="w-40 text-sm text-zinc-400 truncate">{stage}</div>
      <div className="flex-1 bg-zinc-800 rounded-full h-6 overflow-hidden">
        <div
          className={`h-full ${colorClass} flex items-center justify-end pr-2`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        >
          <span className="text-xs font-medium text-white">{count}</span>
        </div>
      </div>
      <div className="w-12 text-right text-sm text-zinc-500">{percentage.toFixed(0)}%</div>
    </div>
  );
}

export interface StageBreakdownProps {
  stageCounts: Record<string, number>;
  totalProjects: number;
}

export function StageBreakdown({ stageCounts, totalProjects }: StageBreakdownProps) {
  // Sort stages by display order
  const sortedStages = Object.entries(stageCounts).sort((a, b) => {
    const aIdx = STAGE_DISPLAY_ORDER.indexOf(a[0] as typeof STAGE_DISPLAY_ORDER[number]);
    const bIdx = STAGE_DISPLAY_ORDER.indexOf(b[0] as typeof STAGE_DISPLAY_ORDER[number]);
    if (aIdx === -1 && bIdx === -1) return a[0].localeCompare(b[0]);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Pipeline by Stage</h2>
      <div className="space-y-3">
        {sortedStages.map(([stage, count]) => (
          <StageBar key={stage} stage={stage} count={count} total={totalProjects} />
        ))}
      </div>
    </div>
  );
}
