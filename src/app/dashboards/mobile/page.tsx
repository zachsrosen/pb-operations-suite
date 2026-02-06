"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatMoney } from "@/lib/format";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RawProject {
  id: string;
  name: string;
  pbLocation?: string;
  stage: string;
  amount?: number;
  url?: string;
  closeDate?: string;
  ptoGrantedDate?: string;
  isParticipateEnergy?: boolean;
}

interface ProcessedProject extends RawProject {
  displayName: string;
  daysOverdue: number;
  daysSinceClose: number;
}

interface LocationStat {
  count: number;
  rtb: number;
  pe: number;
  value: number;
}

interface PipelineStats {
  total: number;
  rtb: number;
  rtbBlocked: number;
  pe: number;
  inspection: number;
  overdue: number;
  totalValue: number;
  locations: Record<string, LocationStat>;
}

type ViewName = "home" | "rtb" | "overdue" | "pe" | "inspection";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const EXPECTED_PTO_DAYS = 139;

function extractDisplayName(name?: string): string {
  if (!name) return "Unknown";
  const parts = name.split("|");
  return parts[1]?.trim() || parts[0]?.trim() || "Unknown";
}

function formatOverdue(days: number): string {
  if (days === 0) return "due today";
  if (days === 1) return "1 day overdue";
  return `${days} days overdue`;
}

// Use shared formatMoney from @/lib/format
const formatCurrency = formatMoney;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
      <div className="w-10 h-10 border-3 border-zinc-700 border-t-orange-500 rounded-full animate-spin mb-4" />
      <div className="text-sm">Loading pipeline data...</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-red-400">
      <div className="text-3xl mb-4">&#9888;&#65039;</div>
      <div className="text-sm mb-4">Failed to load data</div>
      <button
        onClick={onRetry}
        className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-2 rounded-lg text-sm transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function ProjectCard({
  project,
  variant,
}: {
  project: ProcessedProject;
  variant: "priority" | "rtb" | "overdue" | "pe" | "inspection";
}) {
  const borderColor = (() => {
    if (variant === "overdue" || (variant === "priority" && project.daysOverdue > 100))
      return "border-l-red-500";
    if (variant === "pe" || project.isParticipateEnergy)
      return "border-l-green-500";
    if (variant === "priority" || project.stage === "RTB - Blocked")
      return "border-l-amber-500";
    return "border-l-zinc-600";
  })();

  return (
    <a
      href={project.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className={`block bg-[#1e293b] rounded-lg p-3 mb-2 border-l-[3px] ${borderColor} no-underline text-inherit active:bg-[#334155] transition-colors`}
    >
      <div className="flex items-center gap-2 font-medium text-[0.85rem] mb-1">
        <span className="truncate">{project.displayName}</span>
        {project.isParticipateEnergy && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.6rem] font-semibold bg-green-500/20 text-green-400">
            PE
          </span>
        )}
        {variant === "rtb" && project.stage === "RTB - Blocked" && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.6rem] font-semibold bg-red-500/20 text-red-400">
            Blocked
          </span>
        )}
      </div>
      <div className="text-[0.7rem] text-zinc-400">
        {project.pbLocation || "Unknown"}
        {(variant === "priority" || variant === "overdue") &&
          ` | ${formatOverdue(project.daysOverdue)}`}
        {variant === "rtb" && ` | ${project.stage}`}
        {variant === "pe" && ` | ${project.stage}`}
      </div>
      <div className="flex gap-1 mt-2">
        <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-semibold bg-orange-500/20 text-orange-400">
          {formatCurrency(project.amount || 0)}
        </span>
        {(variant === "priority" || variant === "overdue") && project.daysOverdue > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-semibold bg-red-500/20 text-red-400">
            {project.daysOverdue}d
          </span>
        )}
      </div>
    </a>
  );
}

function SectionHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="flex justify-between items-center mb-4">
      <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold">
        {title}
      </h2>
      <button
        onClick={onBack}
        className="bg-[#1e293b] border-none text-zinc-300 px-3 py-1.5 rounded text-sm hover:bg-[#334155] transition-colors"
      >
        &larr; Back
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Nav icons (inline SVGs for mobile bottom nav)                      */
/* ------------------------------------------------------------------ */

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5 mx-auto mb-0.5" fill="none" stroke={active ? "currentColor" : "currentColor"} strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
    </svg>
  );
}

function HammerIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5 mx-auto mb-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
    </svg>
  );
}

function AlertIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5 mx-auto mb-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function LeafIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5 mx-auto mb-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4-4-8-7.5-8-12a8 8 0 0116 0c0 4.5-4 8-8 12z" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-5 h-5 mx-auto mb-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function MobileDashboardPage() {
  const [projects, setProjects] = useState<RawProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentView, setCurrentView] = useState<ViewName>("home");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  /* ---- Data fetching ---- */
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/projects?context=executive");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setProjects(data.projects);
      setLastUpdated(new Date().toLocaleTimeString());
      setLoading(false);
    } catch {
      setLoading(false);
      setError(true);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  /* ---- Computed data ---- */
  const stats: PipelineStats = useMemo(() => {
    const now = new Date();
    const locations: Record<string, LocationStat> = {};

    let overdue = 0;
    projects.forEach((p) => {
      // locations
      const loc = p.pbLocation || "Unknown";
      if (!locations[loc]) locations[loc] = { count: 0, rtb: 0, pe: 0, value: 0 };
      locations[loc].count++;
      if (p.stage === "Ready To Build") locations[loc].rtb++;
      if (p.isParticipateEnergy) locations[loc].pe++;
      locations[loc].value += p.amount || 0;

      // overdue
      if (
        !p.ptoGrantedDate &&
        p.stage !== "Project Complete" &&
        p.stage !== "Close Out" &&
        p.closeDate
      ) {
        const daysSinceClose = Math.floor(
          (now.getTime() - new Date(p.closeDate + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceClose > EXPECTED_PTO_DAYS) overdue++;
      }
    });

    return {
      total: projects.length,
      rtb: projects.filter((p) => p.stage === "Ready To Build").length,
      rtbBlocked: projects.filter((p) => p.stage === "RTB - Blocked").length,
      pe: projects.filter((p) => p.isParticipateEnergy).length,
      inspection: projects.filter((p) => p.stage === "Inspection").length,
      overdue,
      totalValue: projects.reduce((sum, p) => sum + (p.amount || 0), 0),
      locations,
    };
  }, [projects]);

  const overdueProjects: ProcessedProject[] = useMemo(() => {
    const now = new Date();
    return projects
      .map((p) => {
        const closeDate = p.closeDate ? new Date(p.closeDate + "T12:00:00") : null;
        const daysSinceClose = closeDate
          ? Math.floor((now.getTime() - closeDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const daysOverdue = daysSinceClose - EXPECTED_PTO_DAYS;
        return {
          ...p,
          displayName: extractDisplayName(p.name),
          daysOverdue,
          daysSinceClose,
        };
      })
      .filter(
        (p) =>
          p.daysOverdue > 0 &&
          !p.ptoGrantedDate &&
          p.stage !== "Project Complete" &&
          p.stage !== "Close Out"
      )
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [projects]);

  const priorityProjects = useMemo(
    () => overdueProjects.slice(0, 5),
    [overdueProjects]
  );

  const rtbProjects: ProcessedProject[] = useMemo(() => {
    return projects
      .filter((p) => p.stage === "Ready To Build" || p.stage === "RTB - Blocked")
      .map((p) => ({
        ...p,
        displayName: extractDisplayName(p.name),
        daysOverdue: 0,
        daysSinceClose: 0,
      }));
  }, [projects]);

  const peProjects: ProcessedProject[] = useMemo(() => {
    return projects
      .filter((p) => p.isParticipateEnergy)
      .map((p) => ({
        ...p,
        displayName: extractDisplayName(p.name),
        daysOverdue: 0,
        daysSinceClose: 0,
      }));
  }, [projects]);

  const inspectionProjects: ProcessedProject[] = useMemo(() => {
    return projects
      .filter((p) => p.stage === "Inspection")
      .map((p) => ({
        ...p,
        displayName: extractDisplayName(p.name),
        daysOverdue: 0,
        daysSinceClose: 0,
      }));
  }, [projects]);

  const locationEntries = useMemo(() => {
    return Object.entries(stats.locations)
      .filter(([loc]) => loc !== "Unknown")
      .sort((a, b) => b[1].count - a[1].count);
  }, [stats.locations]);

  /* ---- View switching ---- */
  const switchView = useCallback((view: ViewName) => {
    setCurrentView(view);
    window.scrollTo(0, 0);
  }, []);

  /* ---- Navigation items ---- */
  const navItems: { view: ViewName; label: string; Icon: React.FC<{ active: boolean }> }[] = [
    { view: "home", label: "Home", Icon: HomeIcon },
    { view: "rtb", label: "RTB", Icon: HammerIcon },
    { view: "overdue", label: "Overdue", Icon: AlertIcon },
    { view: "pe", label: "PE", Icon: LeafIcon },
    { view: "inspection", label: "Inspect", Icon: SearchIcon },
  ];

  /* ---- Render views ---- */
  function renderHomeView() {
    return (
      <div>
        {/* Quick Actions */}
        <div className="p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => switchView("rtb")}
              className="bg-[#1e293b] border border-zinc-700 rounded-xl p-4 text-center active:bg-[#334155] transition-colors"
            >
              <div className="text-2xl mb-1">&#128296;</div>
              <div className="text-[0.8rem] text-zinc-300">Ready to Build</div>
              <div className="text-xl font-bold text-orange-400 mt-1">
                {stats.rtb}
              </div>
            </button>
            <button
              onClick={() => switchView("overdue")}
              className="bg-[#1e293b] border border-zinc-700 rounded-xl p-4 text-center active:bg-[#334155] transition-colors"
            >
              <div className="text-2xl mb-1">&#9888;&#65039;</div>
              <div className="text-[0.8rem] text-zinc-300">Overdue</div>
              <div className="text-xl font-bold text-red-400 mt-1">
                {stats.overdue}
              </div>
            </button>
            <button
              onClick={() => switchView("pe")}
              className="bg-[#1e293b] border border-zinc-700 rounded-xl p-4 text-center active:bg-[#334155] transition-colors"
            >
              <div className="text-2xl mb-1">&#127793;</div>
              <div className="text-[0.8rem] text-zinc-300">PE Projects</div>
              <div className="text-xl font-bold text-green-400 mt-1">
                {stats.pe}
              </div>
            </button>
            <button
              onClick={() => switchView("inspection")}
              className="bg-[#1e293b] border border-zinc-700 rounded-xl p-4 text-center active:bg-[#334155] transition-colors"
            >
              <div className="text-2xl mb-1">&#128269;</div>
              <div className="text-[0.8rem] text-zinc-300">Inspection</div>
              <div className="text-xl font-bold text-orange-400 mt-1">
                {stats.inspection}
              </div>
            </button>
          </div>
        </div>

        {/* Today's Priority */}
        <div className="p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
            Today&apos;s Priority
          </h2>
          {priorityProjects.length > 0 ? (
            priorityProjects.map((p) => (
              <ProjectCard key={p.id} project={p} variant="priority" />
            ))
          ) : (
            <div className="text-zinc-500 text-center py-4 text-sm">
              No priority projects
            </div>
          )}
        </div>

        {/* By Location */}
        <div className="p-4">
          <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
            By Location
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {locationEntries.map(([loc, data]) => (
              <div
                key={loc}
                className="bg-[#334155] rounded-lg p-3"
              >
                <div className="text-[0.75rem] text-zinc-400">{loc}</div>
                <div className="text-xl font-bold text-white">{data.count}</div>
                <div className="text-[0.65rem] text-zinc-400">
                  {data.rtb} RTB | {data.pe} PE
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderRtbView() {
    return (
      <div className="p-4">
        <SectionHeader title="Ready to Build" onBack={() => switchView("home")} />
        {rtbProjects.length > 0 ? (
          rtbProjects.slice(0, 20).map((p) => (
            <ProjectCard key={p.id} project={p} variant="rtb" />
          ))
        ) : (
          <div className="text-zinc-500 text-sm">No RTB projects</div>
        )}
      </div>
    );
  }

  function renderOverdueView() {
    return (
      <div className="p-4">
        <SectionHeader title="Overdue Projects" onBack={() => switchView("home")} />
        {overdueProjects.length > 0 ? (
          overdueProjects.slice(0, 20).map((p) => (
            <ProjectCard key={p.id} project={p} variant="overdue" />
          ))
        ) : (
          <div className="text-zinc-500 text-sm">No overdue projects</div>
        )}
      </div>
    );
  }

  function renderPeView() {
    return (
      <div className="p-4">
        <SectionHeader title="Participate Energy" onBack={() => switchView("home")} />
        {peProjects.length > 0 ? (
          peProjects.slice(0, 20).map((p) => (
            <ProjectCard key={p.id} project={p} variant="pe" />
          ))
        ) : (
          <div className="text-zinc-500 text-sm">No PE projects</div>
        )}
      </div>
    );
  }

  function renderInspectionView() {
    return (
      <div className="p-4">
        <SectionHeader title="Inspection Stage" onBack={() => switchView("home")} />
        {inspectionProjects.length > 0 ? (
          inspectionProjects.slice(0, 20).map((p) => (
            <ProjectCard key={p.id} project={p} variant="inspection" />
          ))
        ) : (
          <div className="text-zinc-500 text-sm">No inspection projects</div>
        )}
      </div>
    );
  }

  function renderCurrentView() {
    switch (currentView) {
      case "home":
        return renderHomeView();
      case "rtb":
        return renderRtbView();
      case "overdue":
        return renderOverdueView();
      case "pe":
        return renderPeView();
      case "inspection":
        return renderInspectionView();
    }
  }

  /* ---- Main render ---- */
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Mobile-optimized full-bleed layout (no DashboardShell) */}
      <div className="max-w-lg mx-auto w-full flex-1 pb-16">
        {/* Gradient header with live stats */}
        <div className="bg-gradient-to-br from-orange-600 to-amber-500 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-orange-100 opacity-80">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>
                {lastUpdated ? `Live \u2022 ${lastUpdated}` : "Loading..."}
              </span>
            </div>
            <a
              href="/"
              className="text-orange-100 hover:text-white text-xs font-medium transition-colors"
            >
              &larr; Home
            </a>
          </div>
          <h1 className="text-lg font-bold text-white mt-2">PB Pipeline</h1>
          <div className="flex gap-3 mt-3 overflow-x-auto pb-1">
            {[
              { value: loading ? "--" : stats.total, label: "Projects" },
              { value: loading ? "--" : stats.rtb, label: "RTB" },
              { value: loading ? "--" : stats.pe, label: "PE" },
              { value: loading ? "--" : stats.overdue, label: "Overdue" },
              {
                value: loading
                  ? "--"
                  : `$${(stats.totalValue / 1_000_000).toFixed(1)}M`,
                label: "Value",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg text-center shrink-0"
              >
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-[0.65rem] text-orange-100 opacity-80">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alert banner */}
        {!loading && stats.overdue > 100 && (
          <div className="bg-red-600 px-4 py-3 flex items-center gap-2">
            <span className="text-lg">&#128680;</span>
            <span className="text-sm flex-1">
              {stats.overdue} projects overdue &mdash; {stats.rtbBlocked} RTB
              blocked
            </span>
          </div>
        )}

        {/* Content area */}
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorState onRetry={loadData} />
        ) : (
          renderCurrentView()
        )}
      </div>

      {/* Bottom Navigation - scoped to max-w-lg */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#12121a] border-t border-zinc-800 z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-lg mx-auto flex">
          {navItems.map(({ view, label, Icon }) => (
            <button
              key={view}
              onClick={() => switchView(view)}
              className={`flex-1 text-center py-3 text-[0.7rem] transition-colors ${
                currentView === view
                  ? "text-orange-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon active={currentView === view} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
