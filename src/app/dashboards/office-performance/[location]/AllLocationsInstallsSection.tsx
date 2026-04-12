// src/app/dashboards/office-performance/[location]/AllLocationsInstallsSection.tsx

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

export default function AllLocationsInstallsSection({ locations }: Props) {
  const totalCompleted = locations.reduce((sum, l) => sum + l.installs.completedMtd, 0);
  const avgDays = locations.length > 0
    ? locations.reduce((sum, l) => sum + l.installs.avgDays, 0) / locations.length
    : 0;
  const totalScheduled = locations.reduce((sum, l) => sum + l.installs.scheduledThisWeek, 0);
  const totalKw = locations.reduce((sum, l) => sum + (l.installs.kwInstalledMtd ?? 0), 0);

  return (
    <AllLocationsCategorySection
      title="INSTALLS — ALL LOCATIONS"
      titleColor="#22c55e"
      metrics={[
        { label: "Completed This Month", value: totalCompleted, color: "#4ade80" },
        { label: "Avg Days per Install", value: avgDays, decimals: 1, suffix: "d", color: "#60a5fa" },
        { label: "Scheduled This Week", value: totalScheduled, color: "#f97316" },
        { label: "kW Installed MTD", value: totalKw, decimals: 1, color: "#facc15" },
      ]}
      locations={locations}
      columnHeaders={["COMPLETED", "AVG DAYS", "THIS WEEK", "kW", "ON-TIME", "GRADE"]}
      buildLocationRow={(loc) => ({
        location: loc.location,
        metrics: [
          { value: loc.installs.completedMtd },
          { value: loc.installs.avgDays > 0 ? `${loc.installs.avgDays.toFixed(1)}d` : "—" },
          { value: loc.installs.scheduledThisWeek },
          { value: loc.installs.kwInstalledMtd ? `${loc.installs.kwInstalledMtd.toFixed(1)}` : "—" },
          {
            value: loc.installs.onTimePercent >= 0 ? `${loc.installs.onTimePercent}%` : "—",
            color: onTimeColor(loc.installs.onTimePercent),
          },
          { value: loc.installs.grade, color: gradeColor(loc.installs.grade) },
        ],
      })}
    />
  );
}
