// src/app/dashboards/office-performance/[location]/PipelineBarsSection.tsx

"use client";

import { useEffect, useState } from "react";
import CountUp from "./CountUp";
import type { GoalsPipelineData, PipelineStageData } from "@/lib/goals-pipeline-types";

interface PipelineBarsSectionProps {
  pipeline: GoalsPipelineData["pipeline"];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function Bar({
  stage,
  maxCount,
  index,
}: {
  stage: PipelineStageData;
  maxCount: number;
  index: number;
}) {
  const [height, setHeight] = useState(0);
  const targetHeight = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, 5) : 5;

  useEffect(() => {
    const timer = setTimeout(() => setHeight(targetHeight), index * 80 + 50);
    return () => clearTimeout(timer);
  }, [targetHeight, index]);

  return (
    <div className="flex-1 flex flex-col items-center justify-end h-full">
      <CountUp
        value={stage.count}
        className="text-base font-extrabold mb-1"
        style={{ color: stage.color }}
      />
      <div
        className="w-full max-w-[56px] rounded-t-md transition-all duration-700 ease-out"
        style={{
          height: `${height}%`,
          background: `linear-gradient(180deg, ${stage.color}, ${stage.color}dd)`,
        }}
      />
    </div>
  );
}

export default function PipelineBarsSection({
  pipeline,
}: PipelineBarsSectionProps) {
  const maxCount = Math.max(...pipeline.stages.map((s) => s.count), 1);

  return (
    <div className="flex flex-col h-full px-8 py-5">
      {/* Hero numbers */}
      <div className="flex justify-between items-baseline mb-5">
        <div>
          <div className="text-[11px] font-bold tracking-[2px] text-orange-500 mb-1">
            MONTHLY SALES
          </div>
          <div className="text-4xl font-extrabold text-white">
            {formatCurrency(pipeline.monthlySales)}
          </div>
          <div className="text-[13px] text-slate-500">
            {pipeline.monthlySalesCount} deals closed
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold tracking-[2px] text-slate-500 mb-1">
            ACTIVE PIPELINE
          </div>
          <div className="text-[28px] font-bold text-slate-400">
            {formatCurrency(pipeline.activePipelineTotal)}
          </div>
          <div className="text-[13px] text-slate-500">
            {pipeline.stages.reduce((sum, s) => sum + s.count, 0)} active deals
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div
        className="flex items-end gap-2 flex-1 min-h-0 px-1"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        {pipeline.stages.map((stage, i) => (
          <Bar key={stage.label} stage={stage} maxCount={maxCount} index={i} />
        ))}
      </div>

      {/* Stage labels */}
      <div className="flex gap-2 px-1 pt-2">
        {pipeline.stages.map((stage) => (
          <div
            key={stage.label}
            className="flex-1 text-center text-[10px] font-semibold tracking-wider text-slate-500"
          >
            {stage.label.toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
