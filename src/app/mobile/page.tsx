"use client";

import { useState, useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";

export default function MobilePage() {
  const { projects, stats, loading, error, lastUpdated, refresh } = useProjects({
    context: "executive",
    includeStats: true,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<typeof projects[0] | null>(null);

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects.slice(0, 20);
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.pbLocation.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.ahj.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [projects, searchQuery]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="PB Mobile"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
        rightContent={
          <button
            onClick={() => refresh()}
            className="text-xs px-3 py-1.5 bg-orange-500 text-black font-semibold rounded"
          >
            Refresh
          </button>
        }
      />

      <main className="px-4 py-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold stat-number text-orange-400">
              {stats?.rtbCount || 0}
            </div>
            <div className="text-xs text-zinc-500">Ready to Build</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold stat-number text-blue-400">
              {stats?.constructionCount || 0}
            </div>
            <div className="text-xs text-zinc-500">In Construction</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Project List */}
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-8 text-zinc-500">Loading...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center py-8 text-zinc-500">No projects found</div>
          ) : (
            filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => setSelectedProject(project.id === selectedProject?.id ? null : project)}
                className={`bg-zinc-900 border rounded-xl p-4 cursor-pointer transition-all ${
                  selectedProject?.id === project.id
                    ? "border-orange-500 bg-orange-500/5"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="text-sm font-semibold text-white truncate">{project.name}</div>
                    <div className="text-xs text-zinc-500">{project.pbLocation} - {project.ahj}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold stat-number text-orange-400">
                      ${((project.amount || 0) / 1000).toFixed(0)}k
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      project.stage === "Ready To Build"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : project.stage === "RTB - Blocked"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : project.stage === "Construction"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-zinc-700 text-zinc-400"
                    }`}
                  >
                    {project.stage}
                  </span>
                  {project.isParticipateEnergy && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      PE
                    </span>
                  )}
                </div>

                {/* Expanded Details */}
                {selectedProject?.id === project.id && (
                  <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-zinc-500">System Size</div>
                        <div className="text-white">{project.equipment.systemSizeKwdc.toFixed(1)} kW</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Install Days</div>
                        <div className="text-white">{project.daysForInstallers}</div>
                      </div>
                      {project.forecastedInstallDate && (
                        <div>
                          <div className="text-zinc-500">Forecast Install</div>
                          <div className="text-white">{project.forecastedInstallDate}</div>
                        </div>
                      )}
                      {project.constructionScheduleDate && (
                        <div>
                          <div className="text-zinc-500">Scheduled</div>
                          <div className="text-white">{project.constructionScheduleDate}</div>
                        </div>
                      )}
                    </div>

                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-2 text-center bg-blue-500/20 text-blue-400 rounded-lg text-sm"
                    >
                      Open in HubSpot
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {!searchQuery && filteredProjects.length < projects.length && (
          <div className="text-center py-4 text-xs text-zinc-500">
            Showing {filteredProjects.length} of {projects.length} projects. Use search to find more.
          </div>
        )}
      </main>
    </div>
  );
}
