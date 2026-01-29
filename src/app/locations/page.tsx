"use client";

import { useMemo, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard, StageBreakdown, ProjectTable } from "@/components/ui";
import { LOCATIONS, CREWS_BY_LOCATION, type LocationKey } from "@/lib/config";

export default function LocationsPage() {
  const { projects, stats, loading, error, lastUpdated } = useProjects({
    context: "executive",
    includeStats: true,
  });

  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  const locationData = useMemo(() => {
    const data: Record<
      string,
      {
        count: number;
        value: number;
        rtb: number;
        pe: number;
        blocked: number;
        construction: number;
        avgDaysInPipeline: number;
        stageCounts: Record<string, number>;
        projects: typeof projects;
      }
    > = {};

    projects.forEach((p) => {
      if (!data[p.pbLocation]) {
        data[p.pbLocation] = {
          count: 0,
          value: 0,
          rtb: 0,
          pe: 0,
          blocked: 0,
          construction: 0,
          avgDaysInPipeline: 0,
          stageCounts: {},
          projects: [],
        };
      }

      const loc = data[p.pbLocation];
      loc.count++;
      loc.value += p.amount || 0;
      if (p.isRtb) loc.rtb++;
      if (p.isParticipateEnergy) loc.pe++;
      if (p.isBlocked) loc.blocked++;
      if (p.stage === "Construction") loc.construction++;
      loc.avgDaysInPipeline += p.daysSinceClose || 0;
      loc.stageCounts[p.stage] = (loc.stageCounts[p.stage] || 0) + 1;
      loc.projects.push(p);
    });

    // Calculate averages
    Object.values(data).forEach((loc) => {
      if (loc.count > 0) {
        loc.avgDaysInPipeline = Math.round(loc.avgDaysInPipeline / loc.count);
      }
    });

    return data;
  }, [projects]);

  const sortedLocations = Object.entries(locationData).sort((a, b) => b[1].value - a[1].value);

  const selectedLocationData = selectedLocation ? locationData[selectedLocation] : null;

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Location Comparison"
        subtitle="Performance metrics and project distribution across all locations"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Overall Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Locations"
            value={Object.keys(locationData).length}
            loading={loading}
          />
          <StatCard
            label="Total Pipeline"
            value={`$${((stats?.totalValue || 0) / 1000000).toFixed(2)}M`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Total Projects"
            value={stats?.totalProjects || 0}
            loading={loading}
          />
          <StatCard
            label="Total RTB"
            value={stats?.rtbCount || 0}
            color="green"
            loading={loading}
          />
        </div>

        {/* Location Cards Grid */}
        <h2 className="text-lg font-semibold mb-4">Location Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {sortedLocations.map(([location, data]) => {
            const crewConfig = CREWS_BY_LOCATION[location as LocationKey];
            const isSelected = selectedLocation === location;

            return (
              <div
                key={location}
                onClick={() => setSelectedLocation(isSelected ? null : location)}
                className={`bg-zinc-900/50 border rounded-xl p-5 cursor-pointer transition-all ${
                  isSelected
                    ? "border-orange-500 bg-orange-500/5"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{location}</h3>
                    <p className="text-xs text-zinc-500">
                      {crewConfig?.crews.length || 0} crews - {crewConfig?.monthlyCapacity || 0}/month capacity
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold stat-number text-orange-400">
                      ${(data.value / 1000000).toFixed(2)}M
                    </div>
                    <div className="text-xs text-zinc-500">{data.count} projects</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-4">
                  <div className="text-center bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-lg font-bold stat-number text-emerald-400">{data.rtb}</div>
                    <div className="text-[10px] text-zinc-500">RTB</div>
                  </div>
                  <div className="text-center bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-lg font-bold stat-number text-blue-400">{data.construction}</div>
                    <div className="text-[10px] text-zinc-500">Build</div>
                  </div>
                  <div className="text-center bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-lg font-bold stat-number text-emerald-400">{data.pe}</div>
                    <div className="text-[10px] text-zinc-500">PE</div>
                  </div>
                  <div className="text-center bg-zinc-800/50 rounded-lg p-2">
                    <div className={`text-lg font-bold stat-number ${data.blocked > 5 ? "text-red-400" : "text-yellow-400"}`}>
                      {data.blocked}
                    </div>
                    <div className="text-[10px] text-zinc-500">Blocked</div>
                  </div>
                </div>

                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Avg. {data.avgDaysInPipeline} days in pipeline</span>
                  <span className="text-orange-400">{isSelected ? "Click to close" : "Click for details"}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Location Detail */}
        {selectedLocationData && (
          <div className="bg-zinc-900/50 border border-orange-500/30 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4 text-orange-400">{selectedLocation} Details</h2>

            {/* Stage Breakdown */}
            <div className="mb-6">
              <StageBreakdown
                stageCounts={selectedLocationData.stageCounts}
                totalProjects={selectedLocationData.count}
              />
            </div>

            {/* Projects Table */}
            <h3 className="text-sm font-semibold mb-3">Projects ({selectedLocationData.count})</h3>
            <ProjectTable
              projects={selectedLocationData.projects}
              loading={loading}
              columns={["index", "name", "stage", "value", "install", "priority", "actions"]}
              maxHeight="400px"
            />
          </div>
        )}
      </main>
    </div>
  );
}
