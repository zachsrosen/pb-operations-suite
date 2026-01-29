"use client";

import { useMemo } from "react";
import { useProjects } from "@/hooks/useProjects";
import { Header, StatCard, ProjectTable } from "@/components/ui";

export default function AtRiskPage() {
  const { projects, stats, loading, error, lastUpdated } = useProjects({
    context: "at-risk",
    includeStats: true,
  });

  const atRiskStats = useMemo(() => {
    const overdueInstall = projects.filter(
      (p) => p.daysToInstall !== null && p.daysToInstall < 0 && !p.constructionCompleteDate
    );
    const overdueInspection = projects.filter(
      (p) => p.daysToInspection !== null && p.daysToInspection < 0 && !p.inspectionPassDate
    );
    const overduePto = projects.filter(
      (p) => p.daysToPto !== null && p.daysToPto < 0 && !p.ptoGrantedDate
    );
    const blocked = projects.filter((p) => p.isBlocked);
    const stale = projects.filter((p) => p.daysSinceStageMovement > 30);

    return {
      overdueInstall,
      overdueInspection,
      overduePto,
      blocked,
      stale,
      totalAtRisk: new Set([...overdueInstall, ...overdueInspection, ...overduePto, ...blocked].map((p) => p.id)).size,
      totalValue: projects.reduce((sum, p) => sum + (p.amount || 0), 0),
    };
  }, [projects]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="At-Risk Projects"
        subtitle="Critical alerts for overdue projects by severity and revenue impact"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
        showBackLink
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total At-Risk"
            value={atRiskStats.totalAtRisk}
            subValue={`$${(atRiskStats.totalValue / 1000000).toFixed(2)}M at risk`}
            color="red"
            loading={loading}
          />
          <StatCard
            label="Overdue Install"
            value={atRiskStats.overdueInstall.length}
            color="red"
            loading={loading}
            alert={atRiskStats.overdueInstall.length > 5}
          />
          <StatCard
            label="Overdue Inspection"
            value={atRiskStats.overdueInspection.length}
            color="orange"
            loading={loading}
          />
          <StatCard
            label="Blocked"
            value={atRiskStats.blocked.length}
            color="orange"
            loading={loading}
          />
        </div>

        {/* Overdue Install Section */}
        {atRiskStats.overdueInstall.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-red-400 mb-4">
              Overdue Install ({atRiskStats.overdueInstall.length})
            </h2>
            <ProjectTable
              projects={atRiskStats.overdueInstall.sort((a, b) => (a.daysToInstall || 0) - (b.daysToInstall || 0))}
              loading={loading}
              columns={["index", "name", "location", "stage", "value", "install", "actions"]}
            />
          </div>
        )}

        {/* Overdue Inspection Section */}
        {atRiskStats.overdueInspection.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-orange-400 mb-4">
              Overdue Inspection ({atRiskStats.overdueInspection.length})
            </h2>
            <ProjectTable
              projects={atRiskStats.overdueInspection.sort((a, b) => (a.daysToInspection || 0) - (b.daysToInspection || 0))}
              loading={loading}
              columns={["index", "name", "location", "stage", "value", "inspection", "actions"]}
            />
          </div>
        )}

        {/* Blocked Section */}
        {atRiskStats.blocked.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-yellow-400 mb-4">
              Blocked Projects ({atRiskStats.blocked.length})
            </h2>
            <ProjectTable
              projects={atRiskStats.blocked}
              loading={loading}
              columns={["index", "name", "location", "stage", "value", "priority", "actions"]}
            />
          </div>
        )}

        {/* Stale Projects */}
        {atRiskStats.stale.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-zinc-400 mb-4">
              Stale Projects - No Movement 30+ Days ({atRiskStats.stale.length})
            </h2>
            <ProjectTable
              projects={atRiskStats.stale.sort((a, b) => b.daysSinceStageMovement - a.daysSinceStageMovement)}
              loading={loading}
              columns={["index", "name", "location", "stage", "value", "actions"]}
            />
          </div>
        )}

        {projects.length === 0 && !loading && (
          <div className="text-center py-16 text-zinc-500">
            No at-risk projects found.
          </div>
        )}
      </main>
    </div>
  );
}
