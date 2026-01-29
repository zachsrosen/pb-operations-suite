"use client";

import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard } from "@/components/ui";

export default function TimelinePage() {
  const { projects, loading, error, lastUpdated } = useProjects({
    context: "executive",
    includeStats: false,
  });

  // Group projects by forecasted install month
  const timeline = useMemo(() => {
    const grouped: Record<string, typeof projects> = {};
    const now = new Date();

    projects.forEach((p) => {
      const date = p.forecastedInstallDate || p.constructionScheduleDate;
      if (!date) return;

      const monthKey = date.substring(0, 7);
      if (!grouped[monthKey]) grouped[monthKey] = [];
      grouped[monthKey].push(p);
    });

    // Sort by month
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, monthProjects]) => ({
        month,
        monthLabel: new Date(month + "-01").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
        projects: monthProjects.sort((a, b) => {
          const dateA = a.forecastedInstallDate || a.constructionScheduleDate || "";
          const dateB = b.forecastedInstallDate || b.constructionScheduleDate || "";
          return dateA.localeCompare(dateB);
        }),
        totalValue: monthProjects.reduce((sum, p) => sum + (p.amount || 0), 0),
      }));
  }, [projects]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Timeline View"
        subtitle="Gantt-style timeline showing project progression and milestones"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Scheduled Projects"
            value={timeline.reduce((sum, t) => sum + t.projects.length, 0)}
            loading={loading}
          />
          <StatCard
            label="Months Covered"
            value={timeline.length}
            loading={loading}
          />
          <StatCard
            label="Total Scheduled Value"
            value={`$${(timeline.reduce((sum, t) => sum + t.totalValue, 0) / 1000000).toFixed(2)}M`}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Avg Per Month"
            value={
              timeline.length > 0
                ? Math.round(timeline.reduce((sum, t) => sum + t.projects.length, 0) / timeline.length)
                : 0
            }
            loading={loading}
          />
        </div>

        {/* Timeline */}
        <div className="space-y-6">
          {timeline.map((monthData) => (
            <div key={monthData.month} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-white">{monthData.monthLabel}</h3>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-zinc-400">{monthData.projects.length} projects</span>
                  <span className="text-sm font-bold stat-number text-orange-400">
                    ${(monthData.totalValue / 1000000).toFixed(2)}M
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {monthData.projects.map((project) => {
                  const scheduleDate = project.forecastedInstallDate || project.constructionScheduleDate;
                  return (
                    <div
                      key={project.id}
                      className={`flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg border-l-4 ${
                        project.stage === "Construction"
                          ? "border-l-blue-500"
                          : project.isRtb
                          ? "border-l-emerald-500"
                          : "border-l-zinc-600"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-xs text-zinc-500 w-20">{scheduleDate}</div>
                        <div>
                          <div className="text-sm font-medium text-white">{project.name}</div>
                          <div className="text-xs text-zinc-500">
                            {project.pbLocation} - {project.stage}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {project.isParticipateEnergy && (
                          <span className="badge badge-pe">PE</span>
                        )}
                        <span className="text-sm font-bold stat-number text-orange-400">
                          ${((project.amount || 0) / 1000).toFixed(0)}k
                        </span>
                        <a
                          href={project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {timeline.length === 0 && !loading && (
            <div className="text-center py-16 text-zinc-500">
              No scheduled projects found.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
