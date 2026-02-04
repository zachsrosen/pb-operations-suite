"use client";

import Link from "next/link";

interface UpdateEntry {
  version: string;
  date: string;
  title: string;
  description: string;
  changes: {
    type: "feature" | "improvement" | "fix" | "internal";
    text: string;
  }[];
}

const UPDATES: UpdateEntry[] = [
  {
    version: "1.5.0",
    date: "2026-02-04",
    title: "Maintenance Mode & Product Updates Page",
    description: "Added deployment tools and transparency features for better communication with your team.",
    changes: [
      { type: "feature", text: "Maintenance mode page - shows 'Updates in Progress' during deployments" },
      { type: "feature", text: "Product Updates page (this page!) - changelog showing all releases" },
      { type: "feature", text: "Automatic maintenance detection - page auto-refreshes when updates complete" },
      { type: "feature", text: "ROADMAP.md file tracking planned features and priorities" },
      { type: "improvement", text: "Added 'Updates' link in header navigation" },
      { type: "internal", text: "Environment variable MAINTENANCE_MODE controls maintenance state" },
      { type: "internal", text: "Deployment webhook endpoint for Vercel integration" },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-02-04",
    title: "Multi-Select Filters & Availability Overlay",
    description: "Enhanced scheduling tools with better filtering and Zuper availability integration.",
    changes: [
      { type: "feature", text: "Multi-select location filters on Site Survey Scheduler and Master Scheduler" },
      { type: "feature", text: "Availability overlay showing technician availability from Zuper" },
      { type: "feature", text: "Calendar views filter to show only selected locations' jobs and crews" },
      { type: "feature", text: "Week and Gantt views respect location filter selections" },
      { type: "improvement", text: "Crew capacity panel updates based on selected locations" },
      { type: "improvement", text: "Green/yellow/red indicators show availability status on calendar days" },
      { type: "internal", text: "Added /api/zuper/availability endpoint combining slots, time-offs, and jobs" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-02-04",
    title: "Site Survey Scheduler & Zuper Integration",
    description: "New dedicated scheduler for site surveys with full Zuper FSM integration.",
    changes: [
      { type: "feature", text: "Site Survey Scheduler - dedicated calendar for scheduling site surveys" },
      { type: "feature", text: "Zuper FSM integration - create and schedule jobs directly in Zuper" },
      { type: "feature", text: "Drag-and-drop scheduling with automatic Zuper sync" },
      { type: "feature", text: "Assisted Scheduling API - fetch available time slots from Zuper" },
      { type: "improvement", text: "Project cards show survey status, scheduling state, and system size" },
      { type: "fix", text: "Fixed Zuper API endpoint for job scheduling (PUT /jobs/schedule)" },
      { type: "fix", text: "Fixed Zuper date format to use 'YYYY-MM-DD HH:mm:ss' instead of ISO" },
      { type: "fix", text: "Fixed Zuper searchJobs to correctly parse nested API response" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-02-01",
    title: "Command Center & PE Dashboard",
    description: "Unified command center and Participate Energy tracking dashboard.",
    changes: [
      { type: "feature", text: "Command Center - unified view of pipeline, scheduling, and alerts" },
      { type: "feature", text: "PE Dashboard - track Participate Energy projects and milestones" },
      { type: "feature", text: "Revenue tracking with forecast dates" },
      { type: "improvement", text: "Real-time data refresh every 5 minutes" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-01-28",
    title: "Master Scheduler & Crew Management",
    description: "Full-featured scheduling calendar with crew assignments and optimization.",
    changes: [
      { type: "feature", text: "Master Scheduler with month, week, and Gantt views" },
      { type: "feature", text: "Crew management with capacity tracking" },
      { type: "feature", text: "Auto-optimize feature for RTB projects" },
      { type: "feature", text: "CSV export for scheduled events" },
      { type: "improvement", text: "Drag-and-drop scheduling between dates and crews" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-01-20",
    title: "Initial Launch",
    description: "First release of PB Operations Suite with core dashboards.",
    changes: [
      { type: "feature", text: "Home page with dashboard navigation and favorites" },
      { type: "feature", text: "Department dashboards - Site Survey, Design, Permitting, Construction" },
      { type: "feature", text: "HubSpot integration for project data" },
      { type: "feature", text: "Authentication with email magic links" },
      { type: "internal", text: "Next.js 16 with Turbopack" },
    ],
  },
];

const TYPE_STYLES = {
  feature: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "New" },
  improvement: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Improved" },
  fix: { bg: "bg-orange-500/10", text: "text-orange-400", label: "Fixed" },
  internal: { bg: "bg-zinc-500/10", text: "text-zinc-400", label: "Internal" },
};

export default function UpdatesPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold">Product Updates</h1>
              <p className="text-xs text-zinc-500">Changelog & Release Notes</p>
            </div>
          </div>
          <div className="text-xs text-zinc-500">
            Current: v{UPDATES[0].version}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8 p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl">
          <p className="text-zinc-400 text-sm">
            Stay up to date with the latest features, improvements, and fixes to PB Operations Suite.
            We continuously improve based on your feedback.
          </p>
        </div>

        {/* Updates Timeline */}
        <div className="space-y-8">
          {UPDATES.map((update, index) => (
            <div key={update.version} className="relative">
              {/* Timeline line */}
              {index < UPDATES.length - 1 && (
                <div className="absolute left-[19px] top-12 bottom-0 w-px bg-zinc-800" />
              )}

              {/* Update Card */}
              <div className="flex gap-4">
                {/* Version badge */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-xs font-bold shadow-lg shadow-orange-500/20">
                    {update.version.split(".")[0]}.{update.version.split(".")[1]}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  <div className="bg-[#12121a] border border-zinc-800 rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="p-4 border-b border-zinc-800">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold">{update.title}</h2>
                          <p className="text-sm text-zinc-500 mt-1">{update.description}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs font-mono text-orange-400">v{update.version}</div>
                          <div className="text-xs text-zinc-600 mt-0.5">{update.date}</div>
                        </div>
                      </div>
                    </div>

                    {/* Changes */}
                    <div className="p-4">
                      <ul className="space-y-2">
                        {update.changes.map((change, i) => {
                          const style = TYPE_STYLES[change.type];
                          return (
                            <li key={i} className="flex items-start gap-2">
                              <span
                                className={`text-[0.65rem] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 ${style.bg} ${style.text}`}
                              >
                                {style.label}
                              </span>
                              <span className="text-sm text-zinc-300">{change.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-zinc-600">
          <p>Have feedback or feature requests?</p>
          <p className="mt-1">
            Contact:{" "}
            <a href="mailto:zach@photonbrothers.com" className="text-orange-400 hover:underline">
              zach@photonbrothers.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
