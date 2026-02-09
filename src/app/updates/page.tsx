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
    version: "1.18.0",
    date: "2026-02-08",
    title: "Dynamic Status Filters & Multi-Select",
    description: "All scheduler status filters now pull values directly from HubSpot data and support multi-select.",
    changes: [
      { type: "feature", text: "Multi-select status filters on Construction, Inspection, and Site Survey schedulers" },
      { type: "improvement", text: "Status filter options are now dynamically generated from actual project data instead of hardcoded lists" },
      { type: "fix", text: "Fixed construction scheduler status filter showing inaccurate/mismatched options" },
      { type: "fix", text: "Fixed inspection scheduler status filter not matching HubSpot values" },
      { type: "fix", text: "Fixed site survey scheduler status filter with stale hardcoded values" },
    ],
  },
  {
    version: "1.17.0",
    date: "2026-02-08",
    title: "Equipment Backlog Dashboard & Location Filtering",
    description: "New equipment forecasting dashboard and interactive location filtering on the home page.",
    changes: [
      { type: "feature", text: "Equipment Backlog dashboard - equipment breakdown by brand, model, and stage with forecasting" },
      { type: "feature", text: "Multi-select PB location and deal stage filtering on Equipment Backlog" },
      { type: "feature", text: "CSV export of equipment data for procurement and forecasting" },
      { type: "feature", text: "Summary view with modules, inverters, and batteries grouped by brand/model" },
      { type: "feature", text: "Projects view with sortable table of all equipment details" },
      { type: "feature", text: "Interactive location filtering on home page - click 'Projects by Location' cards to filter all stats" },
      { type: "feature", text: "Multi-location API support - filter stats by multiple PB locations simultaneously" },
      { type: "improvement", text: "Active filter banner shows selected locations with one-click clear" },
      { type: "improvement", text: "Unselected location cards dim when filter is active for visual clarity" },
      { type: "fix", text: "Fixed location filter not applying due to React dependency loop" },
    ],
  },
  {
    version: "1.16.0",
    date: "2026-02-08",
    title: "Theme Toggle & Inspection Fix",
    description: "Dark/light theme toggle added to all remaining pages, and inspection status filter fixed.",
    changes: [
      { type: "feature", text: "ThemeToggle added to Construction Scheduler, Command Center, and Mobile dashboards" },
      { type: "feature", text: "Light theme support (dashboard-bg class) on all dashboard pages" },
      { type: "fix", text: "Fixed 'Ready For Inspection' status filter - case mismatch with HubSpot field value" },
      { type: "improvement", text: "Removed Total kW stat from home page (per request)" },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-02-08",
    title: "PWA Support & Dark/Light Theme",
    description: "Install the app on your phone or desktop, plus a new dark/light theme toggle.",
    changes: [
      { type: "feature", text: "Progressive Web App (PWA) - install PB Operations Suite on iOS, Android, and desktop" },
      { type: "feature", text: "Dark/light theme toggle with localStorage persistence" },
      { type: "feature", text: "Mobile-responsive scheduler views - all schedulers optimized for phone screens" },
      { type: "improvement", text: "Runtime CSS injection for theme support (bypasses Tailwind v4 PostCSS limitations)" },
      { type: "improvement", text: "Service worker for offline caching and faster load times" },
      { type: "internal", text: "Web app manifest with icons for Add to Home Screen" },
      { type: "fix", text: "Dependency vulnerabilities patched - Next.js 16.1.4 → 16.1.6, tar updated" },
    ],
  },
  {
    version: "1.14.0",
    date: "2026-02-07",
    title: "Admin User Impersonation",
    description: "Admins can now log in as any user to review functionality and troubleshoot issues.",
    changes: [
      { type: "feature", text: "User impersonation - admins can 'View As' any non-admin user from User Management" },
      { type: "feature", text: "Impersonation banner - orange banner shows when viewing as another user with quick exit button" },
      { type: "feature", text: "Full impersonation audit trail - all impersonation start/stop events logged to ActivityLog" },
      { type: "improvement", text: "All dashboards and APIs respect impersonated user's role and permissions" },
      { type: "internal", text: "New API: /api/admin/impersonate for starting/stopping user impersonation" },
      { type: "internal", text: "Database field: impersonatingUserId on User model tracks active impersonation" },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-02-07",
    title: "Granular User Permissions & Roadmap Management",
    description: "Per-user permission overrides, expanded user roles, and admin roadmap status management.",
    changes: [
      { type: "feature", text: "Granular permissions modal - set per-user permission overrides (surveys, installs, Zuper sync, user management)" },
      { type: "feature", text: "Location restrictions - limit users to specific PB locations (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo)" },
      { type: "feature", text: "Roadmap admin mode - admins can mark items as Planned, In Progress, Under Review, or Completed" },
      { type: "feature", text: "Database-backed roadmap - votes and status changes persist across deployments" },
      { type: "improvement", text: "All 7 user roles now visible in admin panel (ADMIN, MANAGER, OPERATIONS, DESIGNER, PERMITTING, VIEWER, SALES)" },
      { type: "improvement", text: "Site Survey Scheduler availability display improved - shows all slots without truncation" },
      { type: "improvement", text: "Availability grouped by surveyor name with pill badges showing slot counts" },
      { type: "internal", text: "New API: /api/admin/users/permissions for granular permission updates" },
      { type: "internal", text: "Activity logging for permission changes" },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-02-07",
    title: "Security & Role-Based Access Control",
    description: "Comprehensive security improvements with granular role permissions and crew notifications.",
    changes: [
      { type: "feature", text: "Role-based scheduling permissions - control who can schedule surveys, installs, and inspections" },
      { type: "feature", text: "Scheduling notification emails - crew members receive email when scheduled for appointments" },
      { type: "feature", text: "New user roles: OPERATIONS, DESIGNER, PERMITTING with specific access controls" },
      { type: "feature", text: "CrewMember database model - secure storage for Zuper user configurations" },
      { type: "feature", text: "Admin crew management API - /api/admin/crew endpoint for crew CRUD operations" },
      { type: "improvement", text: "Security headers added to all responses (CSP, HSTS, X-Frame-Options, etc.)" },
      { type: "improvement", text: "Database-backed rate limiting - 5 requests per 15 minutes" },
      { type: "improvement", text: "API authentication enforcement in middleware" },
      { type: "internal", text: "Granular permissions: canScheduleSurveys, canScheduleInstalls, canEditDesign, etc." },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-02-06",
    title: "Dashboard Status Groups Reorganization",
    description: "Reorganized status filter groups across all dashboards for better workflow organization.",
    changes: [
      { type: "improvement", text: "Design dashboard - revision statuses grouped by type (DA, Permit, Utility, As-Built)" },
      { type: "improvement", text: "Design Approval - 'Ready' section with Ready For Review and Draft Created" },
      { type: "improvement", text: "Design Approval - 'Sent to Customer' now includes Sent to Customer status" },
      { type: "improvement", text: "Permitting - As-Built Revisions moved to Rejections & Revisions group" },
      { type: "improvement", text: "Interconnection - Xcel Site Plan & SLD moved to Special Cases" },
      { type: "improvement", text: "Construction - Scheduled & Pending NC Design Review moved to Pre-Construction" },
      { type: "improvement", text: "Construction - 'On Our Way' status moved to In Progress group" },
      { type: "improvement", text: "Site Survey - 'Needs Revisit' moved to Scheduling group" },
      { type: "fix", text: "D&R dashboard - removed unused Reset and Detach status filters" },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-02-05",
    title: "Scheduler Calendar Improvements",
    description: "All scheduler calendars now show complete event lists without truncation.",
    changes: [
      { type: "improvement", text: "Master Scheduler shows all events per day (no more '+X more' truncation)" },
      { type: "improvement", text: "Site Survey Scheduler shows all events per day" },
      { type: "improvement", text: "Construction Scheduler shows all events per day" },
      { type: "improvement", text: "Inspection Scheduler shows all events per day" },
      { type: "improvement", text: "Calendar cells now scrollable for days with many events" },
      { type: "fix", text: "Fixed Feb 5th showing '+2' instead of all scheduled projects" },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-02-05",
    title: "Activity Tracking & Database Caching",
    description: "Comprehensive activity logging and database caching for improved performance and analytics.",
    changes: [
      { type: "feature", text: "Activity tracking on all 21 dashboards" },
      { type: "feature", text: "Admin Activity Log page - view all user actions" },
      { type: "feature", text: "Zuper job caching in database for faster lookups" },
      { type: "feature", text: "HubSpot project caching for improved performance" },
      { type: "feature", text: "Schedule records stored permanently for history" },
      { type: "improvement", text: "Dashboard views, searches, and filters are now logged" },
      { type: "improvement", text: "Scheduling actions tracked with full context" },
      { type: "internal", text: "PostgreSQL database with Prisma ORM (Neon serverless)" },
      { type: "internal", text: "Activity log includes IP, user agent, and session tracking" },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-02-04",
    title: "Construction & Inspection Schedulers",
    description: "New dedicated schedulers for construction and inspection teams with full Zuper integration.",
    changes: [
      { type: "feature", text: "Construction Scheduler - dedicated calendar for scheduling construction installs" },
      { type: "feature", text: "Inspection Scheduler - dedicated calendar for scheduling inspections" },
      { type: "feature", text: "Drag-and-drop rescheduling on all scheduler calendars" },
      { type: "improvement", text: "All schedulers now support rescheduling by dragging events to new dates" },
      { type: "improvement", text: "Roadmap voting now persists across sessions" },
      { type: "fix", text: "Fixed back button navigation on scheduler pages" },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-02-04",
    title: "Zuper Job Links in Schedulers",
    description: "Direct links to Zuper jobs now appear alongside HubSpot links in both scheduler tools.",
    changes: [
      { type: "feature", text: "Zuper job links in Site Survey Scheduler list view" },
      { type: "feature", text: "Zuper job links in Master Scheduler project queue cards" },
      { type: "feature", text: "Zuper links in schedule confirmation modals" },
      { type: "feature", text: "Zuper links in project detail modals" },
      { type: "improvement", text: "Projects automatically fetch Zuper job UIDs on load" },
      { type: "internal", text: "New /api/zuper/jobs/lookup endpoint for batch job lookups" },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-02-04",
    title: "Product Roadmap & Feature Voting",
    description: "New interactive roadmap where you can vote on features and submit your own ideas.",
    changes: [
      { type: "feature", text: "Product Roadmap page - view all planned features and their status" },
      { type: "feature", text: "Feature voting - upvote the features you want to see built next" },
      { type: "feature", text: "Submit ideas - propose new features and improvements" },
      { type: "feature", text: "Filter by status (Planned, In Progress, Under Review, Completed)" },
      { type: "feature", text: "Filter by category (Performance, Features, Integrations, UX, Analytics)" },
      { type: "improvement", text: "Roadmap linked from Updates page and header navigation" },
      { type: "improvement", text: "Updated guide documentation with all recent features" },
    ],
  },
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
          <div className="flex items-center gap-4">
            <Link
              href="/roadmap"
              className="flex items-center gap-2 text-xs text-zinc-400 hover:text-orange-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Roadmap
            </Link>
            <div className="text-xs text-zinc-500">
              v{UPDATES[0].version}
            </div>
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

        {/* Roadmap CTA */}
        <div className="mt-12 p-6 bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl text-center">
          <h3 className="text-lg font-semibold text-white mb-2">Want to shape what&apos;s next?</h3>
          <p className="text-zinc-400 text-sm mb-4">
            Vote on upcoming features and submit your own ideas on the Product Roadmap.
          </p>
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            View Roadmap & Vote
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-zinc-600">
          <p>Have a specific bug report or urgent request?</p>
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
