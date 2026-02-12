"use client";

import Link from "next/link";

const sections = [
  {
    title: "Executive Summary",
    route: "/dashboards/executive",
    color: "orange",
    audience: "Executives, Directors, Managers",
    description:
      "High-level overview of the entire project pipeline across all locations. Shows total project count, pipeline value, and overdue tracking at a glance.",
    features: [
      "Total pipeline metrics — project count, value, and overdue tracking",
      "Location breakdown showing per-location project count, value, and overdue projects",
      "Stage-wise distribution with color-coded bars and percentages",
      "Monthly pipeline forecast for forward planning",
      "Real-time data with last updated timestamp",
    ],
  },
  {
    title: "Command Center",
    route: "/dashboards/command-center",
    color: "red",
    audience: "Operations Managers, Supervisors",
    description:
      "Operational nerve center that automatically detects bottlenecks, analyzes crew capacity, and flags issues before they become problems.",
    features: [
      "Automatic alert generation — install overdue, PE PTO overdue, capacity overload",
      "Crew capacity analysis across multiple crews and locations",
      "Monthly capacity vs. scheduled work visualization",
      "Priority scoring system for project urgency",
      "Quick links to related dashboards for drill-down",
    ],
  },
  {
    title: "Master Scheduler",
    route: "/dashboards/scheduler",
    color: "purple",
    audience: "Operations Managers, Schedulers",
    description:
      "Central scheduling hub that combines site surveys, construction, and inspections into one calendar view. Week and month views with drag-and-drop.",
    features: [
      "Combined view of all scheduling types (surveys, construction, inspections)",
      "Week and month calendar views",
      "Drag-and-drop rescheduling",
      "Crew assignment visibility",
      "Capacity indicators per day",
    ],
  },
  {
    title: "Site Survey Scheduler",
    route: "/dashboards/site-survey-scheduler",
    color: "cyan",
    audience: "Survey Schedulers, Operations, Sales (limited)",
    description:
      "Drag-and-drop scheduler for site surveys with crew availability, time slot selection, and automatic Zuper job creation.",
    features: [
      "Drag projects onto calendar dates to schedule",
      "Time slot picker — select a specific crew member and time",
      "Automatic Zuper job creation with crew assignment",
      "Crew availability visualization per day",
      "\"My Availability\" button — crew members can manage their own schedule",
      "\"Manage Availability\" link for admins to configure crew schedules",
      "Rescheduling workflow — click scheduled events to view or reschedule",
      "SALES users have a 2-day minimum lead time restriction",
    ],
  },
  {
    title: "Inspection Scheduler",
    route: "/dashboards/inspection-scheduler",
    color: "purple",
    audience: "Inspection Schedulers, Operations, Inspectors",
    description:
      "Schedule inspections with crew/slot assignment, Zuper integration, and overdue tracking. Shows inspector names and times on calendar events.",
    features: [
      "Drag-and-drop inspection scheduling with time slot picker",
      "Inspector assignment sent to Zuper for proper job routing",
      "Overdue indicators — red warning for past-due inspections",
      "Smart overdue: re-inspections that pass clear the original overdue flag",
      "Inspector name and time displayed on calendar events",
      "Rescheduling workflow with 3-state modal (View/Schedule/Reschedule)",
      "Past-date blocking prevents scheduling in the past",
      "\"My Availability\" for inspector self-service",
    ],
  },
  {
    title: "Construction Scheduler",
    route: "/dashboards/construction-scheduler",
    color: "orange",
    audience: "Construction Schedulers, Crew Leads",
    description:
      "Schedule construction jobs with multi-day support, crew availability tracking, and Zuper job synchronization.",
    features: [
      "Drag-and-drop calendar-based construction scheduling",
      "Multi-day job tracking (Day 1/N indicator)",
      "Crew availability by location with capacity visualization",
      "Red = fully booked, Yellow = limited capacity",
      "Overdue project warnings",
      "Links to HubSpot and Zuper job records",
    ],
  },
  {
    title: "Site Survey Dashboard",
    route: "/dashboards/site-survey",
    color: "cyan",
    audience: "Survey Coordinators, Operations",
    description:
      "Track site survey progress through all stages from scheduling to completion.",
    features: [
      "Status filtering — Ready to Schedule, Awaiting Reply, Scheduled, In Progress, Completed, On-Hold",
      "Project search by name, address, or PROJ number",
      "Deal owner and site surveyor tracking",
      "Schedule and completion date visibility",
    ],
  },
  {
    title: "Construction Dashboard",
    route: "/dashboards/construction",
    color: "orange",
    audience: "Construction Coordinators, Project Managers",
    description:
      "Track construction project status from ready-to-build through completion and revisions.",
    features: [
      "Status groups: Pre-Construction, In Progress, Completion, Revisions",
      "Stages: Ready to Build, Scheduled, On Our Way, Started, In Progress, Loose Ends, Complete",
      "Multi-select filtering by status, location, and stage",
      "Project search functionality",
    ],
  },
  {
    title: "Inspections Dashboard",
    route: "/dashboards/inspections",
    color: "green",
    audience: "Inspection Coordinators, Inspectors, Operations",
    description:
      "Track inspection outcomes across all projects. Monitor pass/fail rates and identify projects needing re-inspection.",
    features: [
      "Inspection status tracking: Scheduled, Passed, Failed, Corrections Required, Reinspection Needed",
      "Pass rate analysis by AHJ (Authority Having Jurisdiction)",
      "Status groups for quick filtering: Pre-Inspection, In Progress, Failed/Waiting, Passed, Pending",
      "Corrections needed tracking",
    ],
  },
  {
    title: "Design & Engineering",
    route: "/dashboards/design",
    color: "blue",
    audience: "Design Engineers, Designers",
    description:
      "Design workflow tracker with an integrated inverter clipping analysis tool that calculates DC/AC ratios and identifies systems at risk of energy clipping.",
    features: [
      "Design status and approval status filtering",
      "Inverter clipping analysis — calculates DC/AC ratios with seasonal TSRF decomposition",
      "Clipping risk classification: None, Low, Moderate, High",
      "Battery impact analysis — DC-coupled batteries can absorb excess",
      "Full equipment specs display (modules, inverters, batteries)",
    ],
  },
  {
    title: "Permitting Dashboard",
    route: "/dashboards/permitting",
    color: "green",
    audience: "Permitting Specialists, Project Managers",
    description:
      "Track permit applications through the full lifecycle from submission to approval.",
    features: [
      "Stages: Not Started, Ready to Submit, Submitted, In Review, Corrections Needed, Issued, Approved",
      "Status groups for quick filtering",
      "Permit submit and issue date tracking",
      "Correction submission tracking",
    ],
  },
  {
    title: "Interconnection & PTO",
    route: "/dashboards/interconnection",
    color: "emerald",
    audience: "Interconnection Specialists, Permitting Team",
    description:
      "Track utility interconnection and Permission to Operate (PTO) status from IC submission through PTO grant.",
    features: [
      "IC stages: Submitted, Approved, NEM Approved",
      "PTO stages: Submitted, Granted",
      "Utility submission date tracking",
      "Meter installation tracking",
    ],
  },
  {
    title: "Participate Energy (PE)",
    route: "/dashboards/pe",
    color: "violet",
    audience: "Operations Team, PE Specialists",
    description:
      "Track projects enrolled in the Participate Energy utility incentive program with milestone forecasting.",
    features: [
      "Install, inspection, and PTO forecasting",
      "Days-to-milestone calculations",
      "Stage filtering and analysis",
      "PE-specific project tracking",
    ],
  },
  {
    title: "At-Risk Projects",
    route: "/dashboards/at-risk",
    color: "red",
    audience: "Operations Managers, Supervisors",
    description:
      "Flagged projects requiring immediate attention — overdue installs, inspections, PTO delays, stalled or blocked projects.",
    features: [
      "Risk type filtering: Install, Inspection, PTO, Stalled, Blocked",
      "Sorting by severity, amount, or days overdue",
      "Location filtering",
      "Risk count and value aggregation by type",
      "Color-coded severity indicators",
    ],
  },
  {
    title: "Equipment Backlog",
    route: "/dashboards/equipment-backlog",
    color: "amber",
    audience: "Procurement, Supply Chain, Operations",
    description:
      "Detailed equipment inventory across the pipeline — modules, inverters, batteries, and EV chargers broken down by location and stage.",
    features: [
      "Location breakdown table: kW DC/AC, modules, inverters, batteries, value",
      "Stage-wise breakdown with expanded specs",
      "Brand/model breakdown for modules, inverters, and batteries",
      "Module wattage and inverter kW AC details",
      "Multi-select filtering by stage and location",
    ],
  },
  {
    title: "Incentives Dashboard",
    route: "/dashboards/incentives",
    color: "yellow",
    audience: "Incentive Managers, Accounting",
    description:
      "Track incentive program status across 3CE, SGIP, PBSR, and CPA programs with payment tracking.",
    features: [
      "Status tracking for 3CE, SGIP, PBSR, and CPA programs",
      "Step-based progress tracking (Step 1-5)",
      "Payment status: Submitted, Approved, Claimed, Paid",
      "Multi-select status filtering",
    ],
  },
  {
    title: "Location Comparison",
    route: "/dashboards/locations",
    color: "indigo",
    audience: "Executives, Operations Directors",
    description:
      "Compare performance across all PB locations side by side — project count, value, overdue rates, and average pipeline days.",
    features: [
      "Location-by-location performance comparison",
      "Per-location: project count, total value, overdue count",
      "Average days in pipeline per location",
      "Stage-wise breakdown per location",
      "Drill-down into individual location detail",
    ],
  },
  {
    title: "Timeline View",
    route: "/dashboards/timeline",
    color: "purple",
    audience: "Executives, Project Managers, Planning Team",
    description:
      "Gantt-style visualization of project timelines from close date through forecasted completion.",
    features: [
      "Gantt chart visualization with month/quarter zoom",
      "Location and stage filtering",
      "Close date to forecasted completion timeline",
      "Monthly project grouping",
    ],
  },
  {
    title: "Optimizer",
    route: "/dashboards/optimizer",
    color: "rose",
    audience: "Operations Managers, Project Leads",
    description:
      "Bottleneck detection and operational efficiency analysis — identifies where projects are getting stuck and why.",
    features: [
      "Bottleneck detection by type: Install, Inspection, PTO, Stalled, Blocked",
      "Severity scoring for prioritization",
      "Location efficiency analysis with average cycle days",
      "Overdue percentage tracking per location",
    ],
  },
  {
    title: "D&R Pipeline",
    route: "/dashboards/dnr",
    color: "teal",
    audience: "D&R Specialists, Project Managers",
    description:
      "Track Detach & Reset projects through their full lifecycle — from kickoff through detach, reset, inspection, and closeout.",
    features: [
      "Full D&R lifecycle stages: Kickoff through Closeout",
      "Status filtering by detach/reset status",
      "Days-since-create aging tracking",
      "Payment block status tracking",
    ],
  },
  {
    title: "Service Pipeline",
    route: "/dashboards/service",
    color: "sky",
    audience: "Service Coordinators, Service Managers",
    description:
      "Track service projects from preparation through site visit, work completion, inspection, and invoicing.",
    features: [
      "Service stages: Project Prep, Site Visit, Work In Progress, Inspection, Invoicing, Completed",
      "Color-coded stage visualization",
      "Deal amount aggregation",
      "Days-since-create aging for service aging",
    ],
  },
  {
    title: "Mobile Dashboard",
    route: "/dashboards/mobile",
    color: "zinc",
    audience: "Field Users, On-Site Supervisors",
    description:
      "Compact mobile-optimized view with quick status cards for on-the-go access to pipeline, RTB, overdue, PE, and inspection data.",
    features: [
      "Quick status overview: Home, RTB, Overdue, PE, Inspection views",
      "Location statistics with count and value",
      "Overdue project count and value",
      "Inspection queue visibility",
    ],
  },
];

const adminSections = [
  {
    title: "User Management",
    route: "/admin/users",
    description:
      "Manage user accounts, roles, and permissions. Assign roles to control what each team member can access and do.",
    features: [
      "Roles: Admin, Manager, Operations Manager, Project Manager, Operations, Tech Ops, Designer, Permitting, Viewer, Sales",
      "Per-user permission overrides: schedule surveys/installs/inspections, sync to Zuper, manage users/availability",
      "Location restrictions — limit users to specific PB locations",
      "Last active indicator with relative timestamps",
      "Bulk role updates with multi-select",
    ],
  },
  {
    title: "Crew Availability Management",
    route: "/admin/crew-availability",
    description:
      "Configure recurring weekly schedules for crew members, block specific dates, and manage crew assignments across locations.",
    features: [
      "Add/edit recurring availability slots per crew member, location, and job type",
      "Day-of-week scheduling with start/end time and timezone",
      "Date-specific overrides — block specific dates for PTO, training, etc.",
      "\"Sync from Code\" to import existing schedules from configuration",
      "\"Seed Teams\" to add DTC & Westminster crew teams from Zuper",
      "Filter by crew member, location, or day of week",
    ],
  },
  {
    title: "Activity Audit Log",
    route: "/admin/activity",
    description:
      "Full audit trail of user activity — logins, scheduling actions, Zuper sync events, role changes, and errors.",
    features: [
      "Date range filtering: Today, 7 Days, 30 Days, All",
      "Email search for specific user activity",
      "Activity type summary cards",
      "CSV export for compliance and reporting",
      "Auto-refresh toggle for real-time monitoring",
    ],
  },
];

const colorMap: Record<string, string> = {
  orange: "border-orange-500/30 from-orange-500/10 to-orange-500/5 text-orange-400",
  red: "border-red-500/30 from-red-500/10 to-red-500/5 text-red-400",
  purple: "border-purple-500/30 from-purple-500/10 to-purple-500/5 text-purple-400",
  cyan: "border-cyan-500/30 from-cyan-500/10 to-cyan-500/5 text-cyan-400",
  blue: "border-blue-500/30 from-blue-500/10 to-blue-500/5 text-blue-400",
  green: "border-green-500/30 from-green-500/10 to-green-500/5 text-green-400",
  emerald: "border-emerald-500/30 from-emerald-500/10 to-emerald-500/5 text-emerald-400",
  violet: "border-violet-500/30 from-violet-500/10 to-violet-500/5 text-violet-400",
  amber: "border-amber-500/30 from-amber-500/10 to-amber-500/5 text-amber-400",
  yellow: "border-yellow-500/30 from-yellow-500/10 to-yellow-500/5 text-yellow-400",
  indigo: "border-indigo-500/30 from-indigo-500/10 to-indigo-500/5 text-indigo-400",
  rose: "border-rose-500/30 from-rose-500/10 to-rose-500/5 text-rose-400",
  teal: "border-teal-500/30 from-teal-500/10 to-teal-500/5 text-teal-400",
  sky: "border-sky-500/30 from-sky-500/10 to-sky-500/5 text-sky-400",
  zinc: "border-muted/30 from-zinc-500/10 to-zinc-500/5 text-muted",
};

const crewTeams = [
  {
    location: "DTC",
    teams: [
      { name: "Godzilla", lead: "Jeremy", type: "Electrician", capabilities: "Inspections, MPUs, GW3s, Split Service, Site Survey, Service, EV, Sub Panels" },
      { name: "Mothman", lead: "Olek", type: "Electrician", capabilities: "MPUs, GW3s, Split Service, EV, Sub, Service, Loose Ends" },
      { name: "Nessie", lead: "Paul", type: "Electrician", capabilities: "TBUS, PW3, AC Coupled, Inspections, EV, Sub Panels, Roof Work" },
      { name: "Sasquatch", lead: "Gaige", type: "Electrician", capabilities: "TBUS, PW3, AC Coupled, EV, Sub Panels, Roof Work" },
      { name: "Thunderbird", lead: "Dan", type: "Inspector", capabilities: "Site Survey, Inspections, Service, Loose Ends" },
      { name: "Jackalope", lead: "Emerill & Ian", type: "Roof Team", capabilities: "All Roof Scope" },
      { name: "Chupacabra", lead: "Kaleb & Kevin", type: "Roof Team", capabilities: "All Roof Scope" },
    ],
  },
  {
    location: "Westminster",
    teams: [
      { name: "Summit", lead: "Adolphe", type: "Electrician", capabilities: "Inspections, MPUs, GW3s, Split Service, EV, Sub, Service, Live" },
      { name: "Keystone", lead: "Chris K", type: "Electrician", capabilities: "MPUs, GW3s, Split Service, EV, Sub, Service, Inspections" },
      { name: "Denali", lead: "Chad", type: "Electrician", capabilities: "Inspections, Service, Loose Ends, GW3, MPU, Sub" },
      { name: "Kilimanjaro", lead: "Nathan, Tyler & Dalton", type: "Roof Team", capabilities: "All Roof Scope" },
      { name: "Everest", lead: "Jose & Tony", type: "Roof Team", capabilities: "All Roof Scope" },
    ],
  },
];

export default function HandbookPage() {
  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white print:text-black">
      {/* Header */}
      <header className="border-b border-t-border px-6 py-4 print:border-t-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity print:text-orange-600"
          >
            PB Operations Suite
          </Link>
          <div className="flex items-center gap-4 print:hidden">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-surface-2 hover:bg-zinc-600 rounded-lg text-sm font-medium transition-colors"
            >
              Print / Save PDF
            </button>
            <Link
              href="/"
              className="text-sm text-muted hover:text-orange-400 transition-colors"
            >
              &larr; Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-2">PB Tech Ops Handbook</h1>
        <p className="text-muted mb-2 print:text-muted/70">
          Comprehensive guide to every dashboard in the PB Operations Suite
        </p>
        <p className="text-xs text-muted mb-8 print:text-muted">
          Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        {/* Table of Contents */}
        <section className="bg-surface/50 border border-t-border rounded-xl p-6 mb-10 print:bg-zinc-50 print:border-t-border">
          <h2 className="text-lg font-semibold mb-4">Table of Contents</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {sections.map((s, i) => (
              <a
                key={s.route}
                href={`#${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="text-muted hover:text-orange-400 transition-colors print:text-muted/50"
              >
                {i + 1}. {s.title}
              </a>
            ))}
            <div className="col-span-full border-t border-t-border mt-2 pt-2 print:border-t-border">
              <span className="text-muted text-xs uppercase tracking-wider">Admin</span>
            </div>
            {adminSections.map((s, i) => (
              <a
                key={s.route}
                href={`#admin-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="text-muted hover:text-orange-400 transition-colors print:text-muted/50"
              >
                A{i + 1}. {s.title}
              </a>
            ))}
            <a
              href="#crew-teams"
              className="text-muted hover:text-orange-400 transition-colors print:text-muted/50"
            >
              Crew Teams & Capabilities
            </a>
          </div>
        </section>

        {/* Quick Start */}
        <section className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-6 mb-10 print:bg-orange-50 print:border-orange-300">
          <h2 className="text-xl font-semibold text-orange-400 mb-3 print:text-orange-600">Quick Start</h2>
          <div className="space-y-3 text-sm text-foreground/80 print:text-muted/50">
            <p>
              <strong className="text-white print:text-black">Global Search:</strong> Press{" "}
              <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono print:bg-zinc-200">
                ⌘K
              </kbd>{" "}
              (Mac) or{" "}
              <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono print:bg-zinc-200">
                Ctrl+K
              </kbd>{" "}
              (Windows) to search dashboards and projects from anywhere.
            </p>
            <p>
              <strong className="text-white print:text-black">Data Source:</strong> All project data comes
              from HubSpot CRM. Scheduling syncs with Zuper for field service management.
              Data refreshes automatically every 5 minutes.
            </p>
            <p>
              <strong className="text-white print:text-black">Access:</strong> Your role determines which
              dashboards you can see and what actions you can take. Contact an admin if you
              need different access.
            </p>
          </div>
        </section>

        {/* Dashboard Sections */}
        <h2 className="text-2xl font-bold mb-6">Dashboards</h2>

        <div className="space-y-6">
          {sections.map((section) => {
            const colors = colorMap[section.color] || colorMap.zinc;
            return (
              <section
                key={section.route}
                id={section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                className={`bg-gradient-to-br ${colors} border rounded-xl p-6 print:bg-white print:border-t-border break-inside-avoid`}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground print:text-black">
                      {section.title}
                    </h3>
                    <p className="text-xs text-muted print:text-muted">
                      {section.route} &middot; {section.audience}
                    </p>
                  </div>
                  <Link
                    href={section.route}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 text-foreground/80 transition-colors print:hidden"
                  >
                    Open
                  </Link>
                </div>
                <p className="text-sm text-foreground/80 mb-3 print:text-muted/50">
                  {section.description}
                </p>
                <ul className="space-y-1">
                  {section.features.map((f, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted print:text-muted/70 flex items-start gap-2"
                    >
                      <span className="text-muted/70 mt-0.5 print:text-muted">&#8226;</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Admin Sections */}
        <h2 className="text-2xl font-bold mt-12 mb-6">Admin Pages</h2>

        <div className="space-y-6">
          {adminSections.map((section) => (
            <section
              key={section.route}
              id={`admin-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              className="bg-gradient-to-br from-zinc-500/10 to-zinc-500/5 border border-muted/30 rounded-xl p-6 print:bg-white print:border-t-border break-inside-avoid"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-foreground print:text-black">
                    {section.title}
                  </h3>
                  <p className="text-xs text-muted">{section.route}</p>
                </div>
                <Link
                  href={section.route}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 text-foreground/80 transition-colors print:hidden"
                >
                  Open
                </Link>
              </div>
              <p className="text-sm text-foreground/80 mb-3 print:text-muted/50">
                {section.description}
              </p>
              <ul className="space-y-1">
                {section.features.map((f, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted print:text-muted/70 flex items-start gap-2"
                  >
                    <span className="text-muted/70 mt-0.5 print:text-muted">&#8226;</span>
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Crew Teams */}
        <h2 className="text-2xl font-bold mt-12 mb-6" id="crew-teams">
          Crew Teams & Capabilities
        </h2>

        <div className="space-y-8">
          {crewTeams.map((loc) => (
            <div key={loc.location}>
              <h3 className="text-lg font-semibold text-orange-400 mb-3 print:text-orange-600">
                {loc.location}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-t-border print:border-t-border">
                      <th className="text-left py-2 px-3 text-muted font-medium print:text-muted/70">
                        Team
                      </th>
                      <th className="text-left py-2 px-3 text-muted font-medium print:text-muted/70">
                        Member(s)
                      </th>
                      <th className="text-left py-2 px-3 text-muted font-medium print:text-muted/70">
                        Type
                      </th>
                      <th className="text-left py-2 px-3 text-muted font-medium print:text-muted/70">
                        Capabilities
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loc.teams.map((team) => (
                      <tr
                        key={team.name}
                        className="border-b border-t-border print:border-t-border"
                      >
                        <td className="py-2 px-3 font-medium text-foreground print:text-black">
                          {team.name}
                        </td>
                        <td className="py-2 px-3 text-foreground/80 print:text-muted/50">
                          {team.lead}
                        </td>
                        <td className="py-2 px-3 text-muted print:text-muted/70">
                          {team.type}
                        </td>
                        <td className="py-2 px-3 text-muted print:text-muted/70">
                          {team.capabilities}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Role Access Matrix */}
        <h2 className="text-2xl font-bold mt-12 mb-6">Role Access Matrix</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-t-border print:border-t-border">
                <th className="text-left py-2 px-2 text-muted font-medium">Role</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Surveys</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Installs</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Inspections</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Zuper</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Users</th>
                <th className="py-2 px-2 text-muted font-medium text-center">Availability</th>
                <th className="py-2 px-2 text-muted font-medium text-center">All Locations</th>
              </tr>
            </thead>
            <tbody>
              {[
                { role: "Admin", s: true, i: true, ins: true, z: true, u: true, a: true, l: true },
                { role: "Manager", s: true, i: true, ins: true, z: true, u: false, a: true, l: true },
                { role: "Ops Manager", s: true, i: true, ins: true, z: true, u: false, a: true, l: true },
                { role: "Project Mgr", s: true, i: true, ins: true, z: true, u: false, a: false, l: true },
                { role: "Operations", s: false, i: true, ins: true, z: true, u: false, a: true, l: true },
                { role: "Tech Ops", s: false, i: false, ins: false, z: false, u: false, a: true, l: false },
                { role: "Designer", s: false, i: false, ins: false, z: false, u: false, a: false, l: true },
                { role: "Permitting", s: false, i: false, ins: false, z: false, u: false, a: false, l: true },
                { role: "Sales", s: true, i: false, ins: false, z: true, u: false, a: false, l: false },
                { role: "Viewer", s: false, i: false, ins: false, z: false, u: false, a: false, l: true },
              ].map((row) => (
                <tr
                  key={row.role}
                  className="border-b border-t-border print:border-t-border"
                >
                  <td className="py-1.5 px-2 font-medium text-foreground print:text-black">
                    {row.role}
                  </td>
                  {[row.s, row.i, row.ins, row.z, row.u, row.a, row.l].map(
                    (v, idx) => (
                      <td
                        key={idx}
                        className="py-1.5 px-2 text-center"
                      >
                        {v ? (
                          <span className="text-green-400 print:text-green-600">Y</span>
                        ) : (
                          <span className="text-muted/70 print:text-muted">&ndash;</span>
                        )}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-t-border text-center text-xs text-muted print:border-t-border">
          <p>PB Operations Suite &middot; Photon Brothers &middot; pbtechops.com</p>
        </div>
      </main>
    </div>
  );
}
