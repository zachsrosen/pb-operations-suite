"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Stats {
  totalProjects: number;
  totalValue: number;
  peCount: number;
  peValue: number;
  rtbCount: number;
  blockedCount: number;
  constructionCount: number;
  inspectionBacklog: number;
  ptoBacklog: number;
  locationCounts: Record<string, number>;
  stageCounts: Record<string, number>;
  totalSystemSizeKw: number;
  totalBatteryKwh: number;
  lastUpdated: string;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch('/api/projects?stats=true&context=executive');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setStats(data.stats);
        setError(null);
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
    // Refresh every 5 minutes
    const interval = setInterval(loadStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent">
            PB Operations Suite
          </h1>
          <div className="text-sm text-zinc-500">
            {loading ? 'Loading...' : error ? error : stats?.lastUpdated ? (
              <>Last updated: {new Date(stats.lastUpdated).toLocaleString()}</>
            ) : ''}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Active Projects"
            value={loading ? '...' : stats?.totalProjects ?? '—'}
            color="orange"
          />
          <StatCard
            label="Pipeline Value"
            value={loading ? '...' : stats?.totalValue ? `$${(stats.totalValue / 1000000).toFixed(1)}M` : '—'}
            color="green"
          />
          <StatCard
            label="PE Projects"
            value={loading ? '...' : stats?.peCount ?? '—'}
            color="emerald"
          />
          <StatCard
            label="Ready To Build"
            value={loading ? '...' : stats?.rtbCount ?? '—'}
            color="blue"
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <MiniStat label="Construction" value={loading ? '...' : stats?.constructionCount ?? '—'} />
          <MiniStat label="Inspection Backlog" value={loading ? '...' : stats?.inspectionBacklog ?? '—'} alert={!loading && (stats?.inspectionBacklog ?? 0) > 50} />
          <MiniStat label="PTO Backlog" value={loading ? '...' : stats?.ptoBacklog ?? '—'} alert={!loading && (stats?.ptoBacklog ?? 0) > 50} />
          <MiniStat label="Blocked" value={loading ? '...' : stats?.blockedCount ?? '—'} alert={!loading && (stats?.blockedCount ?? 0) > 20} />
          <MiniStat label="Total kW" value={loading ? '...' : stats?.totalSystemSizeKw ? `${Math.round(stats.totalSystemSizeKw).toLocaleString()}` : '—'} />
        </div>

        {/* Stage Breakdown */}
        {stats?.stageCounts && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Pipeline by Stage</h2>
            <div className="space-y-3">
              {(() => {
                const stageOrder = [
                  'Close Out', 'Permission To Operate', 'Inspection', 'Construction',
                  'Ready To Build', 'RTB - Blocked', 'Permitting & Interconnection',
                  'Design & Engineering', 'Site Survey', 'Project Rejected'
                ];
                return Object.entries(stats.stageCounts)
                  .sort((a, b) => {
                    const aIdx = stageOrder.indexOf(a[0]);
                    const bIdx = stageOrder.indexOf(b[0]);
                    if (aIdx === -1 && bIdx === -1) return a[0].localeCompare(b[0]);
                    if (aIdx === -1) return 1;
                    if (bIdx === -1) return -1;
                    return aIdx - bIdx;
                  })
                  .map(([stage, count]) => (
                    <StageBar key={stage} stage={stage} count={count as number} total={stats.totalProjects} />
                  ));
              })()}
            </div>
          </div>
        )}

        {/* Location Breakdown */}
        {stats?.locationCounts && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4">Projects by Location</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(stats.locationCounts)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .map(([location, count]) => (
                  <div key={location} className="bg-zinc-800/50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-white">{count as number}</div>
                    <div className="text-sm text-zinc-400">{location}</div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Operations Dashboards */}
        <h2 className="text-lg font-semibold text-zinc-300 mb-4 mt-8">Operations Dashboards</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <DashboardLink
            href="/dashboards/pb-unified-command-center.html"
            title="Command Center"
            description="Pipeline overview, scheduling, PE tracking, revenue, and alerts in one view"
            tag="PRIMARY"
            tagColor="orange"
          />
          <DashboardLink
            href="/dashboards/pb-optimization-dashboard.html"
            title="Pipeline Optimizer"
            description="AI-powered scheduling optimization and bottleneck detection"
            tag="ANALYTICS"
            tagColor="purple"
          />
          <DashboardLink
            href="/dashboards/pb-master-scheduler-v3.html"
            title="Master Scheduler"
            description="Drag-and-drop scheduling calendar with crew management"
            tag="SCHEDULING"
            tagColor="blue"
          />
          <DashboardLink
            href="/dashboards/pipeline-at-risk.html"
            title="At-Risk Projects"
            description="Critical alerts for overdue projects by severity and revenue impact"
            tag="ALERTS"
            tagColor="red"
          />
          <DashboardLink
            href="/dashboards/pipeline-locations.html"
            title="Location Comparison"
            description="Performance metrics and project distribution across all locations"
            tag="ANALYTICS"
            tagColor="purple"
          />
          <DashboardLink
            href="/dashboards/pipeline-timeline.html"
            title="Timeline View"
            description="Gantt-style timeline showing project progression and milestones"
            tag="PLANNING"
            tagColor="blue"
          />
        </div>

        {/* Participate Energy & Leadership */}
        <h2 className="text-lg font-semibold text-zinc-300 mb-4">Participate Energy & Leadership</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <DashboardLink
            href="/dashboards/participate-energy-dashboard.html"
            title="PE Dashboard"
            description="Dedicated PE tracking with milestone status and compliance monitoring"
            tag="PE"
            tagColor="emerald"
          />
          <DashboardLink
            href="/dashboards/pipeline-executive-summary.html"
            title="Executive Summary"
            description="High-level KPIs, charts, and trends for leadership review"
            tag="LEADERSHIP"
            tagColor="purple"
          />
          <DashboardLink
            href="/dashboards/pb-mobile-dashboard.html"
            title="Mobile Dashboard"
            description="Touch-optimized view for field teams with quick project lookup"
            tag="MOBILE"
            tagColor="blue"
          />
        </div>

        {/* API Endpoints */}
        <h2 className="text-lg font-semibold text-zinc-300 mb-4">API Endpoints</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/api/projects?stats=true" target="_blank" className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">Projects + Stats</span>
            </div>
            <p className="text-sm text-zinc-500">Full project data with statistics</p>
          </a>
          <a href="/api/projects?context=pe" target="_blank" className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">PE Projects</span>
            </div>
            <p className="text-sm text-zinc-500">Participate Energy project data</p>
          </a>
          <a href="/api/projects?context=scheduling" target="_blank" className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-green-500/50 transition-all">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-green-500 font-mono text-sm">GET</span>
              <span className="font-semibold text-white">Scheduling</span>
            </div>
            <p className="text-sm text-zinc-500">RTB and schedulable projects</p>
          </a>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/30',
    green: 'from-green-500/20 to-green-500/5 border-green-500/30',
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30',
    blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/30',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-6`}>
      <div className="text-3xl font-bold text-white mb-1">{value}</div>
      <div className="text-sm text-zinc-400">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`bg-zinc-900/50 border rounded-lg p-4 text-center ${alert ? 'border-red-500/50' : 'border-zinc-800'}`}>
      <div className={`text-xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function StageBar({ stage, count, total }: { stage: string; count: number; total: number }) {
  const percentage = (count / total) * 100;

  const stageColors: Record<string, string> = {
    'Site Survey': 'bg-blue-500',
    'Design & Engineering': 'bg-indigo-500',
    'Permitting & Interconnection': 'bg-purple-500',
    'RTB - Blocked': 'bg-red-500',
    'Ready To Build': 'bg-yellow-500',
    'Construction': 'bg-orange-500',
    'Inspection': 'bg-amber-500',
    'Permission To Operate': 'bg-lime-500',
    'Close Out': 'bg-green-500',
    'Project Complete': 'bg-emerald-500',
  };

  return (
    <div className="flex items-center gap-4">
      <div className="w-40 text-sm text-zinc-400 truncate">{stage}</div>
      <div className="flex-1 bg-zinc-800 rounded-full h-6 overflow-hidden">
        <div
          className={`h-full ${stageColors[stage] || 'bg-zinc-600'} flex items-center justify-end pr-2`}
          style={{ width: `${Math.max(percentage, 5)}%` }}
        >
          <span className="text-xs font-medium text-white">{count}</span>
        </div>
      </div>
      <div className="w-12 text-right text-sm text-zinc-500">{percentage.toFixed(0)}%</div>
    </div>
  );
}

function DashboardLink({ href, title, description, tag, tagColor }: { href: string; title: string; description: string; tag?: string; tagColor?: string }) {
  const tagColors: Record<string, string> = {
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
  };

  return (
    <Link
      href={href}
      className="block bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 hover:border-orange-500/50 hover:bg-zinc-900 transition-all group"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-white group-hover:text-orange-400 transition-colors">{title}</h3>
        {tag && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded border ${tagColors[tagColor || 'blue']}`}>
            {tag}
          </span>
        )}
      </div>
      <p className="text-sm text-zinc-500">{description}</p>
    </Link>
  );
}
