// src/app/dashboards/office-performance/[location]/AllLocationsInspectionsSection.tsx

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

function passRateColor(rate: number): string {
  if (rate >= 85) return "#22c55e";
  if (rate >= 70) return "#eab308";
  return "#ef4444";
}

export default function AllLocationsInspectionsSection({ locations }: Props) {
  const totalCompleted = locations.reduce((sum, l) => sum + l.inspections.completedMtd, 0);
  const totalScheduled = locations.reduce((sum, l) => sum + l.inspections.scheduledThisWeek, 0);

  // Volume-weighted average: sum(avgDays * completed) / sum(completed)
  const avgDays = totalCompleted > 0
    ? locations.reduce((sum, l) => sum + l.inspections.avgDays * l.inspections.completedMtd, 0) / totalCompleted
    : 0;

  // Volume-weighted pass rate: sum(passRate * completed) / sum(completed)
  const passRateLocs = locations.filter((l) => (l.inspections.firstPassRate ?? -1) >= 0 && l.inspections.completedMtd > 0);
  const passRateVolume = passRateLocs.reduce((sum, l) => sum + l.inspections.completedMtd, 0);
  const avgPassRate = passRateVolume > 0
    ? Math.round(passRateLocs.reduce((sum, l) => sum + (l.inspections.firstPassRate ?? 0) * l.inspections.completedMtd, 0) / passRateVolume)
    : -1;

  return (
    <AllLocationsCategorySection
      title="INSPECTIONS — ALL LOCATIONS"
      titleColor="#06b6d4"
      metrics={[
        { label: "Passed This Month", value: totalCompleted, color: "#22d3ee" },
        { label: "Avg CC → PTO Days", value: avgDays, decimals: 1, suffix: "d", color: "#60a5fa" },
        { label: "Scheduled This Week", value: totalScheduled, color: "#f97316" },
        {
          label: "First-Pass Rate",
          value: avgPassRate >= 0 ? avgPassRate : 0,
          suffix: avgPassRate >= 0 ? "%" : "",
          color: avgPassRate >= 0 ? passRateColor(avgPassRate) : "#475569",
          subLabel: avgPassRate < 0 ? "N/A" : undefined,
        },
      ]}
      locations={locations}
      columnHeaders={["PASSED", "AVG DAYS", "THIS WEEK", "PASS RATE", "ON-TIME", "GRADE"]}
      buildLocationRow={(loc) => ({
        location: loc.location,
        metrics: [
          { value: loc.inspections.completedMtd },
          { value: loc.inspections.avgDays > 0 ? `${loc.inspections.avgDays.toFixed(1)}d` : "—" },
          { value: loc.inspections.scheduledThisWeek },
          {
            value: (loc.inspections.firstPassRate ?? -1) >= 0
              ? `${loc.inspections.firstPassRate}%`
              : "—",
            color: (loc.inspections.firstPassRate ?? -1) >= 0
              ? passRateColor(loc.inspections.firstPassRate ?? 0)
              : "#475569",
          },
          {
            value: loc.inspections.onTimePercent >= 0 ? `${loc.inspections.onTimePercent}%` : "—",
            color: onTimeColor(loc.inspections.onTimePercent),
          },
          { value: loc.inspections.grade, color: gradeColor(loc.inspections.grade) },
        ],
      })}
    />
  );
}
