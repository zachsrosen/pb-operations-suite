// src/app/dashboards/office-performance/[location]/AllLocationsSurveysSection.tsx

"use client";

import type { LocationOverview } from "@/lib/office-performance-types";
import AllLocationsCategorySection, { gradeColor } from "./AllLocationsCategorySection";

interface Props {
  locations: LocationOverview[];
}

function onTimeColor(pct: number): string {
  if (pct < 0) return "#475569";
  if (pct >= 90) return "#22c55e";
  if (pct >= 75) return "#eab308";
  return "#ef4444";
}

export default function AllLocationsSurveysSection({ locations }: Props) {
  const totalCompleted = locations.reduce((sum, l) => sum + l.surveys.completedMtd, 0);
  const totalScheduled = locations.reduce((sum, l) => sum + l.surveys.scheduledThisWeek, 0);

  // Volume-weighted average: sum(avgDays * completed) / sum(completed)
  const avgDays = totalCompleted > 0
    ? locations.reduce((sum, l) => sum + l.surveys.avgDays * l.surveys.completedMtd, 0) / totalCompleted
    : 0;

  // Volume-weighted on-time: sum(onTime% * completed) / sum(completed) for locations with data
  const onTimeLocs = locations.filter((l) => l.surveys.onTimePercent >= 0 && l.surveys.completedMtd > 0);
  const onTimeVolume = onTimeLocs.reduce((sum, l) => sum + l.surveys.completedMtd, 0);
  const avgOnTime = onTimeVolume > 0
    ? Math.round(onTimeLocs.reduce((sum, l) => sum + l.surveys.onTimePercent * l.surveys.completedMtd, 0) / onTimeVolume)
    : -1;

  return (
    <AllLocationsCategorySection
      title="SURVEYS — ALL LOCATIONS"
      titleColor="#3b82f6"
      metrics={[
        { label: "Completed This Month", value: totalCompleted, color: "#60a5fa" },
        { label: "Avg Days to Complete", value: avgDays, decimals: 1, suffix: "d", color: "#22c55e" },
        { label: "Scheduled This Week", value: totalScheduled, color: "#f97316" },
        {
          label: "Avg On-Time Rate",
          value: avgOnTime >= 0 ? avgOnTime : 0,
          suffix: avgOnTime >= 0 ? "%" : "",
          color: avgOnTime >= 0 ? onTimeColor(avgOnTime) : "#475569",
          subLabel: avgOnTime < 0 ? "N/A" : undefined,
        },
      ]}
      locations={locations}
      columnHeaders={["COMPLETED", "AVG DAYS", "THIS WEEK", "ON-TIME", "GRADE", "STUCK"]}
      buildLocationRow={(loc) => ({
        location: loc.location,
        metrics: [
          { value: loc.surveys.completedMtd },
          { value: loc.surveys.avgDays > 0 ? `${loc.surveys.avgDays.toFixed(1)}d` : "—" },
          { value: loc.surveys.scheduledThisWeek },
          {
            value: loc.surveys.onTimePercent >= 0 ? `${loc.surveys.onTimePercent}%` : "—",
            color: onTimeColor(loc.surveys.onTimePercent),
          },
          { value: loc.surveys.grade, color: gradeColor(loc.surveys.grade) },
          {
            value: loc.surveys.stuckCount,
            color: loc.surveys.stuckCount === 0 ? "#22c55e" : loc.surveys.stuckCount <= 2 ? "#eab308" : "#ef4444",
          },
        ],
      })}
    />
  );
}
