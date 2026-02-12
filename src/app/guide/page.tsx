"use client";

import Link from "next/link";

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-t-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity">
            PB Operations Suite
          </Link>
          <div className="flex items-center gap-4">
            <kbd className="hidden sm:inline-flex text-xs text-muted border border-t-border rounded px-2 py-1">
              <span className="font-mono">⌘K</span>
              <span className="ml-1 text-muted/70">Search</span>
            </kbd>
            <Link href="/" className="text-sm text-muted hover:text-orange-400 transition-colors">
              &larr; Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-2">Dashboard Guide</h1>
        <p className="text-muted mb-8">Learn how to use each dashboard in the PB Operations Suite</p>

        {/* Global Navigation */}
        <section className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Global Navigation</h2>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                <kbd className="bg-surface-2 px-2 py-0.5 rounded text-xs font-mono text-orange-400">⌘K</kbd>
                or
                <kbd className="bg-surface-2 px-2 py-0.5 rounded text-xs font-mono text-orange-400">Ctrl+K</kbd>
                Quick Search
              </h3>
              <p className="text-foreground/80 mb-3">
                Press <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">⌘K</kbd> (Mac) or <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+K</kbd> (Windows) anywhere to open the global search. You can:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted ml-2">
                <li><strong className="text-foreground/80">Search dashboards</strong> - Type a dashboard name to quickly navigate (e.g., &quot;scheduler&quot;, &quot;design&quot;, &quot;PE&quot;)</li>
                <li><strong className="text-foreground/80">Search projects</strong> - Type a project name, PROJ #, or address to find specific projects</li>
                <li><strong className="text-foreground/80">Navigate with keyboard</strong> - Use <kbd className="bg-surface-2 px-1 py-0.5 rounded text-xs font-mono">↑↓</kbd> arrows and <kbd className="bg-surface-2 px-1 py-0.5 rounded text-xs font-mono">Enter</kbd> to select</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Multi-Select Filters */}
        <section className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border border-indigo-500/30 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-indigo-400 mb-4">Multi-Select Filters</h2>
          <p className="text-foreground/80 mb-4">
            The department dashboards (Design, Permitting, Interconnection) now feature advanced multi-select filters
            that allow you to filter by multiple values simultaneously.
          </p>

          <h3 className="font-semibold text-foreground mb-2">How to Use Multi-Select Filters:</h3>
          <ol className="list-decimal list-inside space-y-2 text-foreground/80 mb-4">
            <li>Click any filter button to open the dropdown</li>
            <li>Use the search box at the top to find specific options</li>
            <li>Click individual options to select/deselect them</li>
            <li>Click group headers to select/deselect entire groups</li>
            <li>Use &quot;Select All&quot; or &quot;Clear All&quot; for bulk actions</li>
          </ol>

          <h3 className="font-semibold text-foreground mb-2">Status Groups:</h3>
          <p className="text-muted text-sm mb-3">
            Statuses are organized into logical groups to make filtering easier. Click a group header to toggle all statuses in that group.
          </p>

          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="bg-skeleton rounded-lg p-3">
              <h4 className="font-medium text-indigo-400 mb-2">Design Dashboard</h4>
              <ul className="space-y-1 text-muted">
                <li><span className="text-foreground/80">Design Status:</span> Initial Design, Engineering, DA Revisions, etc.</li>
                <li><span className="text-foreground/80">Design Approval:</span> In Review, Sent to Customer, Approved/Rejected</li>
              </ul>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <h4 className="font-medium text-purple-400 mb-2">Permitting Dashboard</h4>
              <ul className="space-y-1 text-muted">
                <li><span className="text-foreground/80">Permit Status:</span> Pre-Submission, Submitted, Rejections, Completed</li>
                <li><span className="text-foreground/80">Inspection Status:</span> Pre-Inspection, In Progress, Failed, Passed</li>
              </ul>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <h4 className="font-medium text-orange-400 mb-2">Interconnection Dashboard</h4>
              <ul className="space-y-1 text-muted">
                <li><span className="text-foreground/80">IC Status:</span> Initial Submission, Waiting, Rejections, Approved</li>
                <li><span className="text-foreground/80">PTO Status:</span> Pre-Submission, Submitted, Waiting, Completed</li>
              </ul>
            </div>
            <div className="bg-skeleton rounded-lg p-3">
              <h4 className="font-medium text-muted mb-2">Visual Indicators</h4>
              <ul className="space-y-1 text-muted">
                <li><span className="text-indigo-400">Colored button</span> = Filters are active</li>
                <li><span className="text-foreground/80">Gray button</span> = No filters (showing all)</li>
                <li><span className="text-foreground/80">Checkbox filled</span> = Selected / partial selection</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Project Search Bar */}
        <section className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/30 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-blue-400 mb-4">Project Search Bar</h2>
          <p className="text-foreground/80 mb-4">
            Each department dashboard includes a dedicated search bar for finding specific projects within the current view.
          </p>

          <h3 className="font-semibold text-foreground mb-2">Search Capabilities:</h3>
          <ul className="list-disc list-inside space-y-1 text-foreground/80">
            <li><strong>PROJ #</strong> - Search by project number (e.g., &quot;PROJ-12345&quot;)</li>
            <li><strong>Customer Name</strong> - Search by the project or customer name</li>
            <li><strong>Address/Location</strong> - Search by street address or city</li>
          </ul>

          <p className="text-muted text-sm mt-3">
            The search is instant - results filter as you type. The search works in combination with your multi-select filters.
          </p>
        </section>

        {/* Quick Reference */}
        <section className="bg-surface/50 border border-t-border rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Quick Reference</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-t-border">
                  <th className="pb-3 text-orange-400">Dashboard</th>
                  <th className="pb-3 text-orange-400">Best For</th>
                  <th className="pb-3 text-orange-400">Use When You Need To...</th>
                </tr>
              </thead>
              <tbody className="text-foreground/80">
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Command Center</td>
                  <td className="py-3">Daily Operations</td>
                  <td className="py-3">Get complete pipeline overview</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Master Scheduler</td>
                  <td className="py-3">Scheduling</td>
                  <td className="py-3">Schedule installs, manage crews</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Site Survey Scheduler</td>
                  <td className="py-3">Survey Team</td>
                  <td className="py-3">Schedule surveys with Zuper sync</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Construction Scheduler</td>
                  <td className="py-3">Install Team</td>
                  <td className="py-3">Schedule installs with Zuper sync</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Inspection Scheduler</td>
                  <td className="py-3">Inspection Team</td>
                  <td className="py-3">Schedule inspections with Zuper sync</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Design & Engineering</td>
                  <td className="py-3">Design Team</td>
                  <td className="py-3">Track design progress & approvals</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Permitting</td>
                  <td className="py-3">Permit Team</td>
                  <td className="py-3">Track permits & inspections</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Site Survey</td>
                  <td className="py-3">Survey Team</td>
                  <td className="py-3">Schedule & track site surveys</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Construction</td>
                  <td className="py-3">Ops Team</td>
                  <td className="py-3">Track construction progress</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Interconnection</td>
                  <td className="py-3">IC Team</td>
                  <td className="py-3">Track IC apps & PTO status</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Incentives</td>
                  <td className="py-3">Admin Team</td>
                  <td className="py-3">Track 3CE, SGIP, CPA programs</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">At-Risk Projects</td>
                  <td className="py-3">Problem Solving</td>
                  <td className="py-3">Find overdue or stalled projects</td>
                </tr>
                <tr className="border-b border-t-border">
                  <td className="py-3 font-medium">Equipment Backlog</td>
                  <td className="py-3">Procurement</td>
                  <td className="py-3">Equipment forecasting by brand &amp; stage</td>
                </tr>
                <tr>
                  <td className="py-3 font-medium">PE Dashboard</td>
                  <td className="py-3">PE Compliance</td>
                  <td className="py-3">Track Participate Energy milestones</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Operations Dashboards */}
        <h2 className="text-2xl font-semibold mb-4">Operations Dashboards</h2>

        <DashboardCard
          title="Command Center"
          tag="PRIMARY"
          tagColor="orange"
          purpose="Central operations hub for daily pipeline management"
          features={[
            "Pipeline overview with total projects, RTB count, PE projects, and pipeline value",
            "Revenue tracking by stage and location",
            "Capacity planning by crew and location",
            "PE reporting with export capabilities (Excel, CSV)",
            "Alerts for overdue milestones"
          ]}
          howToUse={[
            "Use the tabs at the top to switch views (Pipeline, Revenue, Capacity, PE, Alerts)",
            "Filter by location using the dropdown",
            "Filter by PE status (All/PE Only/Non-PE)",
            "Search for specific projects by name or AHJ",
            "Click 'Scheduler' to jump to the Master Scheduler"
          ]}
          tips={[
            "Start your day here to get an overview of the entire pipeline",
            "Check the Alerts tab for projects needing immediate attention",
            "Use the PE tab for generating PE compliance reports"
          ]}
          url="/dashboards/command-center"
        />

        <DashboardCard
          title="Master Scheduler"
          tag="SCHEDULING"
          tagColor="blue"
          purpose="Schedule installations and inspections with crew management"
          features={[
            "Three views: Month Calendar, Week Grid, Gantt Timeline",
            "Multi-select location filters - view multiple locations at once",
            "Drag-and-drop scheduling for projects",
            "Stage filtering: Survey, RTB, Blocked, Construction, Inspection",
            "Crew capacity tracking and conflict detection",
            "Auto-optimize by difficulty then revenue priority",
            "Calendar, Week, and Gantt views filter by selected locations"
          ]}
          howToUse={[
            "Select a view using tabs (Month/Week/Gantt) or press 1, 2, 3",
            "Use the location filter buttons to select one or more locations",
            "Filter the queue by stage using the tabs on the left",
            "Drag projects from the left queue onto calendar dates",
            "Set duration and assign crew in the modal that appears",
            "Use 'Auto-Optimize' to schedule all RTB projects automatically"
          ]}
          keyboardShortcuts={[
            { keys: "1, 2, 3", action: "Switch views (Month, Week, Gantt)" },
            { keys: "Alt + ← / →", action: "Navigate previous/next" },
            { keys: "Ctrl + O", action: "Auto-optimize schedule" },
            { keys: "Ctrl + E", action: "Export to CSV" },
            { keys: "Esc", action: "Close modals / Deselect" }
          ]}
          tips={[
            "Use location filters to focus on specific locations - the calendar and crews update automatically",
            "Use Auto-Optimize to quickly schedule all RTB projects - it prioritizes easy projects first",
            "Multi-day events skip weekends automatically (Fri → Mon)",
            "Inspections are auto-scheduled 2 business days after construction"
          ]}
          url="/dashboards/scheduler"
        />

        <DashboardCard
          title="Site Survey Scheduler"
          tag="SCHEDULING"
          tagColor="cyan"
          purpose="Dedicated calendar for scheduling site surveys with Zuper FSM integration"
          features={[
            "Monthly calendar view optimized for site survey scheduling",
            "Multi-select location filters - view multiple locations at once",
            "Availability overlay showing technician availability from Zuper",
            "Drag-and-drop scheduling with automatic Zuper job creation",
            "Project cards show survey status, system size, and scheduling state",
            "Green/yellow/red indicators show daily availability status"
          ]}
          howToUse={[
            "Use location filter buttons to select which locations to view",
            "Toggle 'Show Availability' to see Zuper technician availability",
            "Drag projects from the queue onto calendar dates to schedule",
            "Confirm scheduling to automatically create/update Zuper jobs",
            "Check the availability indicators: green = available, yellow = limited, red = busy"
          ]}
          tips={[
            "The availability overlay pulls real-time data from Zuper including time-offs and scheduled jobs",
            "Projects without a Zuper job will have one created automatically when scheduled",
            "Projects already in Zuper will have their job rescheduled when moved",
            "Use multi-select to view surveys across multiple locations at once"
          ]}
          url="/dashboards/site-survey-scheduler"
        />

        <DashboardCard
          title="Construction Scheduler"
          tag="SCHEDULING"
          tagColor="emerald"
          purpose="Dedicated calendar for scheduling construction/installation jobs with Zuper FSM integration"
          features={[
            "Monthly calendar view optimized for construction scheduling",
            "Multi-select location filters - view multiple locations at once",
            "Availability overlay showing crew availability from Zuper",
            "Drag-and-drop scheduling with automatic Zuper job creation",
            "Project cards show install status, system size, and battery info",
            "Reschedule existing jobs by dragging to new dates"
          ]}
          howToUse={[
            "Use location filter buttons to select which locations to view",
            "Toggle 'Show Availability' to see Zuper technician availability",
            "Drag projects from the queue onto calendar dates to schedule",
            "Drag existing calendar events to reschedule them",
            "Confirm scheduling to automatically create/update Zuper jobs"
          ]}
          tips={[
            "Construction jobs default to 2 days duration",
            "Projects already in Zuper will have their job rescheduled when moved",
            "The availability overlay shows real-time data from Zuper"
          ]}
          url="/dashboards/construction-scheduler"
        />

        <DashboardCard
          title="Inspection Scheduler"
          tag="SCHEDULING"
          tagColor="purple"
          purpose="Dedicated calendar for scheduling inspections with Zuper FSM integration"
          features={[
            "Monthly calendar view optimized for inspection scheduling",
            "Multi-select location filters - view multiple locations at once",
            "Availability overlay showing inspector availability from Zuper",
            "Drag-and-drop scheduling with automatic Zuper job creation",
            "Project cards show inspection status and system size",
            "Reschedule existing inspections by dragging to new dates"
          ]}
          howToUse={[
            "Use location filter buttons to select which locations to view",
            "Toggle 'Show Availability' to see Zuper technician availability",
            "Drag projects from the queue onto calendar dates to schedule",
            "Drag existing calendar events to reschedule them",
            "Confirm scheduling to automatically create/update Zuper jobs"
          ]}
          tips={[
            "Inspections default to ~2 hours duration",
            "Failed inspections can be easily rescheduled by dragging",
            "Track inspection status (Ready, Scheduled, Passed, Failed)"
          ]}
          url="/dashboards/inspection-scheduler"
        />

        <DashboardCard
          title="Pipeline Optimizer"
          tag="ANALYTICS"
          tagColor="purple"
          purpose="AI-powered bottleneck detection and priority scheduling"
          features={[
            "Automatic bottleneck identification across pipeline stages",
            "Priority scoring based on revenue, PE status, and urgency",
            "Location efficiency analysis",
            "Optimized schedule generation"
          ]}
          howToUse={[
            "Review the bottleneck analysis at the top",
            "Check the priority queue (top 10 highest-priority projects)",
            "Click 'Generate Optimized Schedule' to auto-schedule",
            "Export the optimized schedule as CSV"
          ]}
          url="/dashboards/optimizer"
        />

        {/* How Auto-Optimize Works */}
        <section className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/30 rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-blue-400 mb-4">How &quot;Optimize Schedule&quot; Works</h3>
          <p className="text-foreground/80 mb-4">
            The Auto-Optimize feature in the Master Scheduler automatically schedules RTB (Ready To Build) projects
            AND their inspections, prioritizing easier projects first to maximize throughput.
          </p>

          <h4 className="font-semibold text-foreground mb-2">The Algorithm:</h4>
          <ol className="list-decimal list-inside space-y-2 text-foreground/80 mb-4">
            <li><strong>Finds unscheduled RTB projects</strong> - Projects that are Ready To Build but don&apos;t have a scheduled date</li>
            <li><strong>Sorts by difficulty, then revenue</strong> - Easiest projects first (difficulty 1-5), then by highest revenue within same difficulty</li>
            <li><strong>Checks crew availability</strong> - Looks at each crew&apos;s existing schedule to find their next open date</li>
            <li><strong>Schedules construction</strong> - Assigns each project to the crew&apos;s next available workday</li>
            <li><strong>Auto-schedules inspections</strong> - Automatically schedules inspection 2 business days after construction ends</li>
            <li><strong>Schedules pending inspections</strong> - Also schedules any projects already in the Inspection stage</li>
          </ol>

          <h4 className="font-semibold text-foreground mb-2">Key Features:</h4>
          <ul className="list-disc list-inside space-y-1 text-foreground/80">
            <li><span className="text-green-400">Difficulty-First Prioritization</span> - Easier projects (D1-D2) scheduled before harder ones (D4-D5)</li>
            <li><span className="text-green-400">Revenue as Tiebreaker</span> - Within same difficulty, higher-value projects go first</li>
            <li><span className="text-green-400">Automatic Inspection Scheduling</span> - Inspections scheduled 2 business days after construction</li>
            <li><span className="text-green-400">Weekend Avoidance</span> - Only schedules on business days (Mon-Fri)</li>
            <li><span className="text-green-400">Crew-Aware</span> - Respects each crew&apos;s existing commitments</li>
            <li><span className="text-green-400">Duration-Aware</span> - Accounts for job duration when calculating next availability</li>
          </ul>
        </section>

        {/* Design, Permitting, IC, Incentives */}
        <h2 className="text-2xl font-semibold mb-4">Department Dashboards</h2>

        <DashboardCard
          title="Design & Engineering"
          tag="DESIGN"
          tagColor="indigo"
          purpose="Track design status, design approvals, and engineering milestones"
          features={[
            "Multi-select filters for Design Status, Design Approval, Location, and Stage",
            "11 Design Status groups (Initial Design, Engineering, DA Revisions, etc.)",
            "5 Design Approval groups (In Review, Sent to Customer, Approved/Rejected, etc.)",
            "Project search by PROJ #, name, or address",
            "Direct links to HubSpot records"
          ]}
          howToUse={[
            "Use multi-select filters to view multiple statuses at once",
            "Click group headers to toggle entire status groups",
            "Use the search bar to find specific projects",
            "Click project names to open in HubSpot",
            "Sort by clicking column headers"
          ]}
          statusGroups={[
            { name: "Design Status Groups", items: ["Initial Design", "Engineering & Completion", "DA Revisions", "Permit Revisions", "Utility Revisions", "As-Built Revisions", "Needs Clarification", "New Construction", "Xcel", "Other", "Archived"] },
            { name: "Design Approval Groups", items: ["In Review", "Sent to Customer", "Approved/Rejected", "Revisions", "Pending Changes"] }
          ]}
          tips={[
            "Filter by 'Initial Design' group to see projects just starting the design process",
            "Use 'DA Revisions' group to find projects with customer-requested changes",
            "The 'DA Approved - Final Design Review' status indicates customer has approved the final design"
          ]}
          url="/dashboards/design"
        />

        <DashboardCard
          title="Permitting & Inspections"
          tag="PERMITS"
          tagColor="purple"
          purpose="Track permit applications, AHJ turnaround times, and inspection status"
          features={[
            "Multi-select filters for Permit Status, Inspection Status, Location, and Stage",
            "6 Permit Status groups (Pre-Submission, Submitted, Rejections, etc.)",
            "6 Inspection Status groups (Pre-Inspection, In Progress, Failed, etc.)",
            "Project search by PROJ #, name, or address",
            "Permit submit and issue date tracking"
          ]}
          howToUse={[
            "Filter by 'Submitted' group to see permits pending approval",
            "Use 'Rejections & Revisions' to find permits needing corrections",
            "Filter Inspection Status by 'Failed' to see projects needing re-inspection",
            "Search by AHJ name to see permits for a specific jurisdiction"
          ]}
          statusGroups={[
            { name: "Permit Status Groups", items: ["Pre-Submission", "Submitted", "Rejections & Revisions", "As-Built Revisions", "SolarApp", "Completed", "Other"] },
            { name: "Inspection Status Groups", items: ["Pre-Inspection", "In Progress", "Failed/Waiting", "Passed", "Pending", "Other"] }
          ]}
          tips={[
            "Use 'SolarApp' group to filter projects using expedited SolarApp permitting",
            "Check 'Failed/Waiting' inspection group to prioritize re-inspections",
            "Monitor 'Submitted' group to track pending permits and average turnaround times"
          ]}
          url="/dashboards/permitting"
        />

        <DashboardCard
          title="Interconnection & PTO"
          tag="IC"
          tagColor="orange"
          purpose="Track interconnection applications, approvals, and Permission to Operate"
          features={[
            "Multi-select filters for IC Status, PTO Status, Location, and Stage",
            "7 IC Status groups (Initial Submission, Waiting, Rejections, etc.)",
            "7 PTO Status groups (Pre-Submission, Submitted, Waiting, etc.)",
            "Project search by PROJ #, name, or address",
            "IC submit and approval date tracking"
          ]}
          howToUse={[
            "Filter by 'Waiting' group to see projects pending utility response",
            "Use 'Rejections & Revisions' to find IC applications needing corrections",
            "Filter PTO by 'Submitted' to track PTO applications in progress",
            "Check 'Completed' group to see projects with granted PTO"
          ]}
          statusGroups={[
            { name: "IC Status Groups", items: ["Initial Submission", "Waiting", "Rejections & Revisions", "Approved", "Special Cases", "Xcel", "Other"] },
            { name: "PTO Status Groups", items: ["Pre-Submission", "Submitted", "Rejections", "Waiting", "Xcel Photos", "Completed", "Other"] }
          ]}
          tips={[
            "PE projects often have stricter PTO deadlines - filter by stage to find PE projects first",
            "Use 'Xcel' groups for projects with Xcel Energy-specific requirements",
            "Monitor 'Approved' IC status and 'Pre-Submission' PTO status to find projects ready for PTO submission"
          ]}
          url="/dashboards/interconnection"
        />

        <DashboardCard
          title="Site Survey"
          tag="SURVEY"
          tagColor="blue"
          purpose="Track site survey scheduling, completion, and status"
          features={[
            "Multi-select filters for Site Survey Status, Location, and Stage",
            "4 Status groups: Scheduling, In Progress, Completion, On Hold",
            "Survey scheduling and completion date tracking",
            "Project search by PROJ #, name, or address",
            "Turnaround time analytics"
          ]}
          howToUse={[
            "Filter by 'Scheduling' group to see surveys needing to be scheduled",
            "Use 'In Progress' group to track ongoing surveys",
            "Check 'Needs Revisit' for surveys requiring follow-up",
            "Monitor 'On Hold' group for blocked surveys"
          ]}
          statusGroups={[
            { name: "Site Survey Status Groups", items: ["Scheduling (Ready to Schedule, Awaiting Reply, Scheduled)", "In Progress (On Our Way, Started, In Progress)", "Completion (Needs Revisit, Completed)", "On Hold (Scheduling On-Hold, No Site Survey Needed, Pending Loan Approval, Waiting on Change Order)"] }
          ]}
          tips={[
            "Filter by 'Ready to Schedule' to find surveys needing scheduling",
            "Check 'Needs Revisit' for surveys that may need corrections",
            "Use the search bar to find specific projects by customer name or address"
          ]}
          url="/dashboards/site-survey"
        />

        <DashboardCard
          title="Construction"
          tag="CONSTRUCTION"
          tagColor="orange"
          purpose="Track construction status, scheduling, and progress"
          features={[
            "Multi-select filters for Construction Status, Location, and Stage",
            "5 Status groups: Pre-Construction, Scheduling, In Progress, Completion, Revisions",
            "Construction scheduling and completion date tracking",
            "Project search by PROJ #, name, or address",
            "Blocked/Rejected project tracking"
          ]}
          howToUse={[
            "Filter by 'Pre-Construction' to see projects preparing for construction",
            "Use 'In Progress' group to track active construction",
            "Monitor 'Loose Ends Remaining' for nearly complete jobs",
            "Check 'Revisions' group for projects needing design changes"
          ]}
          statusGroups={[
            { name: "Construction Status Groups", items: ["Pre-Construction (Rejected, Blocked, Ready to Build)", "Scheduling (Scheduled, On Our Way)", "In Progress (Started, In Progress, Loose Ends Remaining)", "Completion (Construction Complete)", "Revisions (Revisions Needed, In Design For Revisions, Revisions Complete, Pending New Construction Design Review)"] }
          ]}
          tips={[
            "Filter by 'Ready to Build' to see projects ready for scheduling",
            "Use 'Loose Ends Remaining' to find jobs close to completion",
            "Check 'Revisions' statuses to find projects with design issues"
          ]}
          url="/dashboards/construction"
        />

        <DashboardCard
          title="Incentives"
          tag="INCENTIVES"
          tagColor="emerald"
          purpose="Track incentive program applications across 3CE, SGIP, PBSR, and CPA"
          features={[
            "Multi-program tracking (3CE, SGIP, PBSR, CPA)",
            "Status breakdown by program",
            "Application status filtering",
            "Revenue tracking by incentive program",
            "Filter by any combination of program statuses"
          ]}
          howToUse={[
            "View the program breakdown cards at the top for quick status",
            "Use filters to find projects with specific program statuses",
            "Track which projects are eligible for which incentives",
            "Monitor application progress for revenue forecasting"
          ]}
          tips={[
            "Cross-reference with the PE Dashboard for Participate Energy incentive tracking",
            "SGIP projects often have storage components - check battery information",
            "CPA projects have specific documentation requirements"
          ]}
          url="/dashboards/incentives"
        />

        {/* Alerts & Analytics */}
        <h2 className="text-2xl font-semibold mb-4">Alerts & Analytics</h2>

        <DashboardCard
          title="At-Risk Projects"
          tag="ALERTS"
          tagColor="red"
          purpose="Real-time alerts for projects that need attention"
          features={[
            "Risk scoring algorithm (Critical vs Warning severity)",
            "Filter by risk type and location",
            "Revenue at risk calculations",
            "Direct links to HubSpot records"
          ]}
          riskTypes={[
            { type: "Install Overdue", desc: "Past forecasted installation date" },
            { type: "Inspection Overdue", desc: "Past inspection deadline" },
            { type: "PTO Overdue", desc: "Past PTO deadline" },
            { type: "Stalled", desc: "No stage movement in 30+ days" },
            { type: "Blocked", desc: "RTB-Blocked or On-Hold status" }
          ]}
          tips={[
            "Check this dashboard daily to catch problems early",
            "Critical (red) issues should be addressed same-day",
            "Warning (yellow) issues should be resolved within the week",
            "Use 'Revenue at Risk' to prioritize high-value projects"
          ]}
          url="/dashboards/at-risk"
        />

        <DashboardCard
          title="Location Comparison"
          tag="ANALYTICS"
          tagColor="purple"
          purpose="Compare performance across all locations"
          features={[
            "Location-by-location metrics comparison",
            "Metric toggle (Count, Value, Avg PTO Days, Overdue)",
            "Click-to-drill-down on locations",
            "Stage distribution per location"
          ]}
          howToUse={[
            "Compare metrics across Westminster, Centennial, Colorado Springs, SLO, and Camarillo",
            "Toggle between count, value, and efficiency metrics",
            "Click on a location to see detailed breakdown",
            "Identify high-performing and struggling locations"
          ]}
          url="/dashboards/locations"
        />

        <DashboardCard
          title="Equipment Backlog"
          tag="EQUIPMENT"
          tagColor="cyan"
          purpose="Equipment forecasting by brand, model, and pipeline stage"
          features={[
            "Summary view: modules, inverters, and batteries grouped by brand/model",
            "Projects view: sortable table with full equipment details per job",
            "Equipment breakdown by pipeline stage (kW DC, module count, value)",
            "Multi-select PB location and deal stage filtering",
            "CSV export for procurement and equipment planning"
          ]}
          howToUse={[
            "Use Summary view to see total equipment needed across the pipeline",
            "Filter by location to forecast equipment needs per branch",
            "Filter by stage to see what's needed for upcoming construction",
            "Switch to Projects view for job-level equipment details",
            "Export to CSV for sharing with procurement teams"
          ]}
          url="/dashboards/equipment-backlog"
        />

        {/* PE & Leadership */}
        <h2 className="text-2xl font-semibold mb-4">PE & Leadership</h2>

        <DashboardCard
          title="PE Dashboard"
          tag="PE"
          tagColor="emerald"
          purpose="Track Participate Energy projects and milestone compliance"
          features={[
            "PE project overview with value tracking",
            "Milestone forecasting (Install, Inspection, PTO)",
            "6-month forecast chart",
            "Status-based filtering (Overdue, Due Soon, On Track)",
            "N/A indicator for projects without forecast dates"
          ]}
          howToUse={[
            "Overview tab: High-level PE metrics and compliance rate",
            "Projects tab: All PE projects with sort options",
            "Milestones tab: Projects grouped by milestone type",
            "Sort by PTO/Inspection/Install/Value to prioritize work"
          ]}
          tips={[
            "Projects showing 'N/A' for days don't have a forecast date set in HubSpot",
            "Red 'overdue' badges indicate milestones past their forecast date",
            "Use the export function for PE compliance reporting"
          ]}
          url="/dashboards/pe"
        />

        <DashboardCard
          title="Executive Summary"
          tag="LEADERSHIP"
          tagColor="purple"
          purpose="Leadership-level KPIs and trends"
          features={[
            "High-level KPI cards (Pipeline Value, Project Count, Overdue)",
            "Stage distribution bar chart",
            "Pipeline value by location (doughnut chart)",
            "6-month PTO forecast trend line",
            "Location health scores"
          ]}
          colorLegend={[
            { color: "bg-green-500", label: "80%+ on track" },
            { color: "bg-yellow-500", label: "60-80% on track" },
            { color: "bg-red-500", label: "<60% on track" }
          ]}
          url="/dashboards/executive"
        />

        {/* System Features */}
        <h2 className="text-2xl font-semibold mb-4">System Features</h2>

        <section className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-emerald-400 mb-4">Product Updates</h3>
          <p className="text-foreground/80 mb-4">
            Stay informed about new features, improvements, and fixes with the Product Updates page.
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground/80 mb-4">
            <li>Click the <strong>&quot;Updates&quot;</strong> link in the header to view the changelog</li>
            <li>Each release is version-tagged with a date and description</li>
            <li>Changes are categorized: <span className="text-emerald-400">New</span> (features), <span className="text-blue-400">Improved</span> (enhancements), <span className="text-orange-400">Fixed</span> (bug fixes), <span className="text-muted">Internal</span> (technical changes)</li>
            <li>The current version is shown in the top right of the Updates page</li>
          </ul>
          <Link href="/updates" className="inline-block text-sm text-emerald-400 hover:text-emerald-300 font-mono">
            /updates &rarr;
          </Link>
        </section>

        <section className="bg-gradient-to-br from-zinc-500/10 to-zinc-500/5 border border-muted/30 rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-foreground/80 mb-4">Maintenance Mode</h3>
          <p className="text-foreground/80 mb-4">
            During deployments and updates, you may see the &quot;Updates in Progress&quot; page.
          </p>
          <ul className="list-disc list-inside space-y-2 text-foreground/80 mb-4">
            <li>This means we&apos;re deploying improvements - usually takes less than a minute</li>
            <li>The page will <strong>automatically refresh</strong> when updates are complete</li>
            <li>You can also click &quot;Try again now&quot; to manually check</li>
            <li>No data is lost during maintenance - your work is preserved in HubSpot</li>
          </ul>
          <p className="text-muted text-sm">
            If you see this page for more than 5 minutes, contact zach@photonbrothers.com
          </p>
        </section>

        {/* Common Features */}
        <section className="bg-surface/50 border border-t-border rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Common Features Across All Dashboards</h2>
          <ul className="space-y-3 text-foreground/80">
            <li className="flex items-start gap-3">
              <span className="text-green-400 mt-1">&#9679;</span>
              <span><strong>Live Data:</strong> All dashboards connect to HubSpot with 5-minute auto-refresh</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 mt-1">&#9679;</span>
              <span><strong>Direct Links:</strong> Click any project to open it directly in HubSpot</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-purple-400 mt-1">&#9679;</span>
              <span><strong>Multi-Location:</strong> Filter and compare across all 5 locations</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-orange-400 mt-1">&#9679;</span>
              <span><strong>Export Options:</strong> CSV, Excel, and clipboard exports available</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted mt-1">&#9679;</span>
              <span><strong>Color Coding:</strong> Red = Overdue/Critical, Yellow = Warning/Due Soon, Green = On Track</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-indigo-400 mt-1">&#9679;</span>
              <span><strong>Global Search:</strong> Press <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">⌘K</kbd> or <kbd className="bg-surface-2 px-1.5 py-0.5 rounded text-xs font-mono">Ctrl+K</kbd> to search anywhere</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 mt-1">&#9679;</span>
              <span><strong>Multi-Select Filters:</strong> Select multiple values in filters for more precise filtering</span>
            </li>
          </ul>
        </section>

        {/* Getting Started */}
        <section className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Getting Started</h2>
          <ol className="list-decimal list-inside space-y-2 text-foreground/80">
            <li>Start with the <strong>Command Center</strong> for a complete pipeline overview</li>
            <li>Use <strong>At-Risk Projects</strong> to identify problems needing immediate attention</li>
            <li>Check <strong>Design & Engineering</strong>, <strong>Permitting</strong>, or <strong>Interconnection</strong> for stage-specific status</li>
            <li>Schedule site surveys in the <strong>Site Survey Scheduler</strong> with Zuper integration</li>
            <li>Schedule installs in the <strong>Master Scheduler</strong> - use Auto-Optimize for quick scheduling</li>
            <li>Monitor <strong>Incentives</strong> for program application status</li>
            <li>Check <strong>PE Dashboard</strong> for Participate Energy compliance</li>
            <li>Share <strong>Executive Summary</strong> with leadership for KPI reviews</li>
            <li>Check <strong>Updates</strong> to see the latest features and improvements</li>
          </ol>

          <div className="mt-6 p-4 bg-skeleton rounded-lg">
            <h3 className="font-semibold text-foreground mb-2">Pro Tips:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted">
              <li>Use <kbd className="bg-surface-2 px-1 py-0.5 rounded text-xs font-mono">⌘K</kbd> to quickly jump between dashboards</li>
              <li>Multi-select filters let you see multiple status groups at once</li>
              <li>Click column headers to sort tables by any field</li>
              <li>All times and dates are in your local timezone</li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-t-border text-center text-muted text-sm">
          <p>PB Operations Suite | Photon Brothers</p>
          <p className="mt-1">Data refreshes automatically every 5 minutes from HubSpot</p>
        </footer>
      </main>
    </div>
  );
}

interface DashboardCardProps {
  title: string;
  tag: string;
  tagColor: string;
  purpose: string;
  features: string[];
  howToUse?: string[];
  keyboardShortcuts?: { keys: string; action: string }[];
  riskTypes?: { type: string; desc: string }[];
  colorLegend?: { color: string; label: string }[];
  statusGroups?: { name: string; items: string[] }[];
  tips?: string[];
  url: string;
}

function DashboardCard({
  title,
  tag,
  tagColor,
  purpose,
  features,
  howToUse,
  keyboardShortcuts,
  riskTypes,
  colorLegend,
  statusGroups,
  tips,
  url
}: DashboardCardProps) {
  const tagColors: Record<string, string> = {
    orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
    emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    green: 'bg-green-500/20 text-green-400 border-green-500/30',
    indigo: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  };

  return (
    <div className="bg-surface/50 border border-t-border rounded-xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${tagColors[tagColor]}`}>
          {tag}
        </span>
      </div>

      <p className="text-muted mb-4">
        <strong className="text-foreground/80">Purpose:</strong> {purpose}
      </p>

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-foreground/80 mb-2">Key Features:</h4>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted">
          {features.map((feature, i) => (
            <li key={i}>{feature}</li>
          ))}
        </ul>
      </div>

      {howToUse && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground/80 mb-2">How to Use:</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted">
            {howToUse.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {keyboardShortcuts && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground/80 mb-2">Keyboard Shortcuts:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {keyboardShortcuts.map((shortcut, i) => (
              <div key={i} className="flex items-center gap-2">
                <kbd className="bg-surface-2 px-2 py-0.5 rounded text-xs font-mono text-orange-400">{shortcut.keys}</kbd>
                <span className="text-muted">{shortcut.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {riskTypes && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground/80 mb-2">Risk Types:</h4>
          <ul className="space-y-1 text-sm">
            {riskTypes.map((risk, i) => (
              <li key={i} className="text-muted">
                <strong className="text-red-400">{risk.type}</strong> - {risk.desc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {colorLegend && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground/80 mb-2">Health Score Colors:</h4>
          <div className="flex gap-4 text-sm">
            {colorLegend.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded ${item.color}`}></div>
                <span className="text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {statusGroups && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-foreground/80 mb-2">Status Filter Groups:</h4>
          <div className="space-y-2">
            {statusGroups.map((group, i) => (
              <div key={i} className="text-sm">
                <span className="text-muted">{group.name}: </span>
                <span className="text-muted">{group.items.join(", ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tips && (
        <div className="mb-4 p-3 bg-skeleton rounded-lg">
          <h4 className="text-sm font-semibold text-yellow-400 mb-2">Tips:</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted">
            {tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={url}
        className="inline-block text-sm text-orange-400 hover:text-orange-300 font-mono"
      >
        {url} &rarr;
      </Link>
    </div>
  );
}
