"use client";

import { useProjects } from "@/hooks/useProjects";
import {
  Header,
  StatCard,
  StatCardGrid,
  MiniStatGrid,
  StageBreakdown,
  LocationGrid,
  DashboardLink,
  DashboardGrid,
  ApiEndpointLink,
} from "@/components/ui";
import { getDashboardsByCategory } from "@/lib/config";

export default function Home() {
  const { projects, stats, loading, error, lastUpdated } = useProjects({
    context: "executive",
    includeStats: true,
  });

  const operationsDashboards = getDashboardsByCategory("operations");
  const pipelinesDashboards = getDashboardsByCategory("pipelines");
  const leadershipDashboards = getDashboardsByCategory("leadership");

  return (
    <div className="min-h-screen bg-background text-white">
      <Header
        title="PB Operations Suite"
        lastUpdated={lastUpdated || undefined}
        loading={loading}
        error={error}
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Main Stats Grid */}
        <StatCardGrid>
          <StatCard
            label="Active Projects"
            value={loading ? "..." : stats?.totalProjects ?? "—"}
            color="orange"
          />
          <StatCard
            label="Pipeline Value"
            value={loading ? "..." : stats?.totalValue ? `$${(stats.totalValue / 1000000).toFixed(1)}M` : "—"}
            color="green"
          />
          <StatCard
            label="PE Projects"
            value={loading ? "..." : stats?.peCount ?? "—"}
            color="emerald"
          />
          <StatCard
            label="Ready To Build"
            value={loading ? "..." : stats?.rtbCount ?? "—"}
            color="blue"
          />
        </StatCardGrid>

        {/* Secondary Stats */}
        <MiniStatGrid>
          <StatCard
            label="Construction"
            value={loading ? "..." : stats?.constructionCount ?? "—"}
            size="mini"
          />
          <StatCard
            label="Inspection Backlog"
            value={loading ? "..." : stats?.inspectionBacklog ?? "—"}
            size="mini"
            alert={!loading && (stats?.inspectionBacklog ?? 0) > 50}
          />
          <StatCard
            label="PTO Backlog"
            value={loading ? "..." : stats?.ptoBacklog ?? "—"}
            size="mini"
            alert={!loading && (stats?.ptoBacklog ?? 0) > 50}
          />
          <StatCard
            label="Blocked"
            value={loading ? "..." : stats?.blockedCount ?? "—"}
            size="mini"
            alert={!loading && (stats?.blockedCount ?? 0) > 20}
          />
          <StatCard
            label="Total kW"
            value={loading ? "..." : stats?.totalSystemSizeKw ? `${Math.round(stats.totalSystemSizeKw).toLocaleString()}` : "—"}
            size="mini"
          />
        </MiniStatGrid>

        {/* Stage Breakdown */}
        {stats?.stageCounts && (
          <StageBreakdown stageCounts={stats.stageCounts} totalProjects={stats.totalProjects} />
        )}

        {/* Location Breakdown */}
        {stats?.locationCounts && <LocationGrid locationCounts={stats.locationCounts} />}

        {/* Operations Dashboards */}
        <DashboardGrid title="Operations Dashboards">
          {operationsDashboards.map((dashboard) => (
            <DashboardLink
              key={dashboard.id}
              href={dashboard.path}
              title={dashboard.title}
              description={dashboard.description}
              tag={dashboard.tag}
              tagColor={dashboard.tagColor}
            />
          ))}
        </DashboardGrid>

        {/* Other Pipelines */}
        <DashboardGrid title="Other Pipelines">
          {pipelinesDashboards.map((dashboard) => (
            <DashboardLink
              key={dashboard.id}
              href={dashboard.path}
              title={dashboard.title}
              description={dashboard.description}
              tag={dashboard.tag}
              tagColor={dashboard.tagColor}
            />
          ))}
        </DashboardGrid>

        {/* Participate Energy & Leadership */}
        <DashboardGrid title="Participate Energy & Leadership">
          {leadershipDashboards.map((dashboard) => (
            <DashboardLink
              key={dashboard.id}
              href={dashboard.path}
              title={dashboard.title}
              description={dashboard.description}
              tag={dashboard.tag}
              tagColor={dashboard.tagColor}
            />
          ))}
        </DashboardGrid>

        {/* API Endpoints */}
        <h2 className="text-lg font-semibold text-zinc-300 mb-4">API Endpoints</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ApiEndpointLink
            href="/api/projects?stats=true"
            method="GET"
            title="Projects + Stats"
            description="Full project data with statistics"
          />
          <ApiEndpointLink
            href="/api/projects?context=pe"
            method="GET"
            title="PE Projects"
            description="Participate Energy project data"
          />
          <ApiEndpointLink
            href="/api/projects?context=scheduling"
            method="GET"
            title="Scheduling"
            description="RTB and schedulable projects"
          />
        </div>
      </main>
    </div>
  );
}
