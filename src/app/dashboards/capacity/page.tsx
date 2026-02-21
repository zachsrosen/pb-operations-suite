"use client";

import { useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { useExecutiveData } from "@/hooks/useExecutiveData";
import { formatCurrencyExec } from "@/lib/executive-shared";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";

export default function CapacityPage() {
  const { projects, loading, error, lastUpdated, fetchData, capacityAnalysis, accessChecked } =
    useExecutiveData("capacity");

  const [optStats, setOptStats] = useState<{
    totalGap: number;
    overCapacity: number;
    underCapacity: number;
    locationCount: number;
  } | null>(null);

  const runOptimization = () => {
    let totalGap = 0;
    let overCapacity = 0;
    let underCapacity = 0;
    Object.values(capacityAnalysis).forEach((cap) => {
      Object.values(cap.monthly_forecast).forEach((m) => {
        const gap = m.days_needed - cap.monthly_capacity;
        if (gap > 0) {
          totalGap += gap;
          overCapacity++;
        } else {
          underCapacity++;
        }
      });
    });
    setOptStats({
      totalGap,
      overCapacity,
      underCapacity,
      locationCount: Object.keys(capacityAnalysis).length,
    });
  };

  if (!accessChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted text-lg">Checking access...</div>
      </div>
    );
  }

  return (
    <DashboardShell
      title="Capacity Planning"
      subtitle={`${Object.keys(capacityAnalysis).length} locations`}
      accentColor="blue"
      lastUpdated={lastUpdated}
    >
      {loading && projects.length === 0 ? (
        <LoadingSpinner color="blue" message="Loading capacity data..." />
      ) : error && projects.length === 0 ? (
        <ErrorState message={error} onRetry={fetchData} color="blue" />
      ) : (
        <>
          {/* Optimizer Panel */}
          <div className="bg-surface border border-orange-500 rounded-xl p-5 mb-6">
            <div className="text-base font-semibold text-orange-500 mb-3">AI Capacity Optimizer</div>
            <p className="text-xs text-muted mb-4">Analyze forecasted installs vs. available crew capacity across all locations</p>
            <button
              onClick={runOptimization}
              className="px-6 py-3 bg-gradient-to-br from-orange-500 to-orange-400 border-none text-black font-bold rounded-lg cursor-pointer text-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(249,115,22,0.4)]"
            >
              Analyze Capacity Gaps
            </button>
            {optStats && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold font-mono text-red-500">{optStats.totalGap}</div>
                  <div className="text-[0.65rem] text-muted">Days Over Capacity</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold font-mono text-yellow-500">{optStats.overCapacity}</div>
                  <div className="text-[0.65rem] text-muted">Months Overloaded</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold font-mono text-emerald-500">{optStats.underCapacity}</div>
                  <div className="text-[0.65rem] text-muted">Months OK</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold font-mono">{optStats.locationCount}</div>
                  <div className="text-[0.65rem] text-muted">Locations</div>
                </div>
              </div>
            )}
          </div>

          {/* Capacity Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Object.entries(capacityAnalysis).map(([location, cap]) => {
              const monthKeys = Object.keys(cap.monthly_forecast).sort().slice(0, 6);
              const maxDays = Math.max(
                cap.monthly_capacity,
                ...monthKeys.map((k) => cap.monthly_forecast[k]?.days_needed || 0)
              );

              return (
                <div key={location} className="bg-surface border border-t-border rounded-xl p-5">
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-base font-semibold">{location}</div>
                    <div className="text-[0.7rem] text-muted">{cap.crews.length} crew(s) - {cap.monthly_capacity} days/mo</div>
                  </div>

                  {/* CSS Bar Chart */}
                  <div className="h-48 mb-4 flex items-end gap-1.5">
                    {monthKeys.length > 0 ? (
                      monthKeys.map((k) => {
                        const forecast = cap.monthly_forecast[k]?.days_needed || 0;
                        const forecastPct = maxDays > 0 ? (forecast / maxDays) * 100 : 0;
                        const capacityPct = maxDays > 0 ? (cap.monthly_capacity / maxDays) * 100 : 0;
                        const isOver = forecast > cap.monthly_capacity;
                        return (
                          <div key={k} className="flex-1 flex flex-col items-center justify-end h-full relative">
                            <div className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-500/60" style={{ bottom: `${capacityPct}%` }} />
                            <div
                              className={`w-full rounded-t transition-all ${isOver ? "bg-red-500/70" : "bg-blue-500/70"}`}
                              style={{ height: `${forecastPct}%`, minHeight: forecast > 0 ? "4px" : "0" }}
                              title={`${forecast} days forecasted`}
                            />
                            <div className="text-[0.6rem] text-muted mt-1">{k.substring(5)}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted/70 text-xs">No forecast data</div>
                    )}
                  </div>

                  {/* Legend */}
                  <div className="flex gap-4 justify-center mb-4 text-[0.6rem] text-muted">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded-sm bg-blue-500/70" />
                      Forecasted
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 border-t-2 border-dashed border-emerald-500/60" style={{ width: 12 }} />
                      Capacity
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-xl font-bold font-mono">{cap.total_projects}</div>
                      <div className="text-[0.6rem] text-muted">Projects</div>
                    </div>
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-xl font-bold font-mono text-emerald-500">{cap.rtb_count}</div>
                      <div className="text-[0.6rem] text-muted">RTB</div>
                    </div>
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-xl font-bold font-mono text-emerald-500">{cap.pe_count}</div>
                      <div className="text-[0.6rem] text-muted">PE Projects</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
