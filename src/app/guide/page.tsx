"use client";

import Link from "next/link";

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity">
            PB Operations Suite
          </Link>
          <Link href="/" className="text-sm text-zinc-400 hover:text-orange-400 transition-colors">
            &larr; Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold mb-2">Dashboard Guide</h1>
        <p className="text-zinc-400 mb-8">Learn how to use each dashboard in the PB Operations Suite</p>

        {/* Quick Reference */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Quick Reference</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-zinc-700">
                  <th className="pb-3 text-orange-400">Dashboard</th>
                  <th className="pb-3 text-orange-400">Best For</th>
                  <th className="pb-3 text-orange-400">Use When You Need To...</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Command Center</td>
                  <td className="py-3">Daily Operations</td>
                  <td className="py-3">Get complete pipeline overview</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Master Scheduler</td>
                  <td className="py-3">Scheduling</td>
                  <td className="py-3">Schedule installs, manage crews</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Design & Engineering</td>
                  <td className="py-3">Design Team</td>
                  <td className="py-3">Track design progress & approvals</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Permitting</td>
                  <td className="py-3">Permit Team</td>
                  <td className="py-3">Track permits & inspections</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Interconnection</td>
                  <td className="py-3">IC Team</td>
                  <td className="py-3">Track IC apps & PTO status</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">Incentives</td>
                  <td className="py-3">Admin Team</td>
                  <td className="py-3">Track 3CE, SGIP, CPA programs</td>
                </tr>
                <tr className="border-b border-zinc-800">
                  <td className="py-3 font-medium">At-Risk Projects</td>
                  <td className="py-3">Problem Solving</td>
                  <td className="py-3">Find overdue or stalled projects</td>
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
          url="/dashboards/pb-unified-command-center.html"
        />

        <DashboardCard
          title="Master Scheduler"
          tag="SCHEDULING"
          tagColor="blue"
          purpose="Schedule site surveys, installations, and inspections with crew management"
          features={[
            "Three views: Month Calendar, Week Grid, Gantt Timeline",
            "Drag-and-drop scheduling for projects",
            "Stage filtering: Survey, RTB, Blocked, Construction, Inspection",
            "Crew capacity tracking and conflict detection",
            "Auto-optimize by revenue priority",
            "Zuper FSM integration for work order creation"
          ]}
          howToUse={[
            "Select a view using tabs (Month/Week/Gantt) or press 1, 2, 3",
            "Filter the queue by stage using the tabs on the left",
            "Drag projects from the left queue onto calendar dates",
            "Set duration and assign crew in the modal that appears",
            "Use 'Auto-Optimize' to schedule all RTB projects by revenue priority"
          ]}
          keyboardShortcuts={[
            { keys: "1, 2, 3", action: "Switch views (Month, Week, Gantt)" },
            { keys: "Alt + ← / →", action: "Navigate previous/next" },
            { keys: "Ctrl + O", action: "Auto-optimize schedule" },
            { keys: "Ctrl + E", action: "Export to CSV" },
            { keys: "Esc", action: "Close modals / Deselect" }
          ]}
          url="/dashboards/pb-master-scheduler-v3.html"
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
          url="/dashboards/pb-optimization-dashboard.html"
        />

        {/* How Auto-Optimize Works */}
        <section className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/30 rounded-xl p-6 mb-8">
          <h3 className="text-xl font-semibold text-blue-400 mb-4">How "Optimize Schedule" Works</h3>
          <p className="text-zinc-300 mb-4">
            The Auto-Optimize feature in the Master Scheduler automatically schedules RTB (Ready To Build) projects
            AND their inspections, prioritizing easier projects first to maximize throughput.
          </p>

          <h4 className="font-semibold text-white mb-2">The Algorithm:</h4>
          <ol className="list-decimal list-inside space-y-2 text-zinc-300 mb-4">
            <li><strong>Finds unscheduled RTB projects</strong> - Projects that are Ready To Build but don&apos;t have a scheduled date</li>
            <li><strong>Sorts by difficulty, then revenue</strong> - Easiest projects first (difficulty 1-5), then by highest revenue within same difficulty</li>
            <li><strong>Checks crew availability</strong> - Looks at each crew&apos;s existing schedule to find their next open date</li>
            <li><strong>Schedules construction</strong> - Assigns each project to the crew&apos;s next available workday</li>
            <li><strong>Auto-schedules inspections</strong> - Automatically schedules inspection 2 business days after construction ends</li>
            <li><strong>Schedules pending inspections</strong> - Also schedules any projects already in the Inspection stage</li>
          </ol>

          <h4 className="font-semibold text-white mb-2">Key Features:</h4>
          <ul className="list-disc list-inside space-y-1 text-zinc-300">
            <li><span className="text-green-400">Difficulty-First Prioritization</span> - Easier projects (D1-D2) scheduled before harder ones (D4-D5)</li>
            <li><span className="text-green-400">Revenue as Tiebreaker</span> - Within same difficulty, higher-value projects go first</li>
            <li><span className="text-green-400">Automatic Inspection Scheduling</span> - Inspections scheduled 2 business days after construction</li>
            <li><span className="text-green-400">Weekend Avoidance</span> - Only schedules on business days (Mon-Fri)</li>
            <li><span className="text-green-400">Crew-Aware</span> - Respects each crew&apos;s existing commitments</li>
            <li><span className="text-green-400">Duration-Aware</span> - Accounts for job duration when calculating next availability</li>
          </ul>
        </section>

        {/* Design, Permitting, IC, Incentives */}
        <h2 className="text-2xl font-semibold mb-4">Design, Permitting, Interconnection & Incentives</h2>

        <DashboardCard
          title="Design & Engineering"
          tag="DESIGN"
          tagColor="indigo"
          purpose="Track design status, layout approvals, and engineering milestones"
          features={[
            "Design status breakdown (In Progress, Complete, Approved, etc.)",
            "Layout approval tracking",
            "Design completion dates",
            "Filter by design status and location",
            "Direct links to HubSpot records"
          ]}
          howToUse={[
            "Use the status filter to focus on specific design stages",
            "Sort by design completion date to prioritize reviews",
            "Click project names to open in HubSpot",
            "Monitor the status breakdown for bottlenecks"
          ]}
          url="/dashboards/design-engineering-dashboard.html"
        />

        <DashboardCard
          title="Permitting & Inspections"
          tag="PERMITS"
          tagColor="purple"
          purpose="Track permit applications, AHJ turnaround times, and inspection status"
          features={[
            "Permit status tracking (Submitted, Approved, Issued)",
            "Inspection status and scheduling",
            "AHJ turnaround time analysis",
            "Permit submit and issue date tracking",
            "Filter by permit status, inspection status, and location"
          ]}
          howToUse={[
            "Filter by permit status to see what's pending vs approved",
            "Check inspection status for projects ready for final inspection",
            "Use date columns to track timeline and identify delays",
            "Click project names to update records in HubSpot"
          ]}
          url="/dashboards/permitting-dashboard.html"
        />

        <DashboardCard
          title="Interconnection & PTO"
          tag="IC"
          tagColor="orange"
          purpose="Track interconnection applications, approvals, and Permission to Operate"
          features={[
            "IC application status (Submitted, Approved, etc.)",
            "PTO status tracking",
            "IC submit and approval date tracking",
            "Utility company breakdown",
            "Filter by IC status, PTO status, and location"
          ]}
          howToUse={[
            "Filter by IC status to see pending applications",
            "Track PTO status for projects nearing completion",
            "Use date columns to monitor IC timeline",
            "Identify projects waiting on utility approval"
          ]}
          url="/dashboards/interconnection-dashboard.html"
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
          url="/dashboards/incentives-dashboard.html"
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
          url="/dashboards/pipeline-at-risk.html"
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
          url="/dashboards/pipeline-locations.html"
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
            "Status-based filtering (Overdue, Due Soon, On Track)"
          ]}
          howToUse={[
            "Overview tab: High-level PE metrics and compliance rate",
            "Projects tab: All PE projects with sort options",
            "Milestones tab: Projects grouped by milestone type",
            "Sort by PTO/Inspection/Install/Value to prioritize work"
          ]}
          url="/dashboards/participate-energy-dashboard.html"
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
          url="/dashboards/pipeline-executive-summary.html"
        />

        {/* Common Features */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Common Features Across All Dashboards</h2>
          <ul className="space-y-3 text-zinc-300">
            <li className="flex items-start gap-3">
              <span className="text-green-400 mt-1">●</span>
              <span><strong>Live Data:</strong> All dashboards connect to HubSpot with 5-minute auto-refresh</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 mt-1">●</span>
              <span><strong>Direct Links:</strong> Click any project to open it directly in HubSpot</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-purple-400 mt-1">●</span>
              <span><strong>Multi-Location:</strong> Filter and compare across all 5 locations</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-orange-400 mt-1">●</span>
              <span><strong>Export Options:</strong> CSV, Excel, and clipboard exports available</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-zinc-400 mt-1">●</span>
              <span><strong>Color Coding:</strong> Red = Overdue/Critical, Yellow = Warning/Due Soon, Green = On Track</span>
            </li>
          </ul>
        </section>

        {/* Getting Started */}
        <section className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-orange-400 mb-4">Getting Started</h2>
          <ol className="list-decimal list-inside space-y-2 text-zinc-300">
            <li>Start with the <strong>Command Center</strong> for a complete pipeline overview</li>
            <li>Use <strong>At-Risk Projects</strong> to identify problems needing immediate attention</li>
            <li>Check <strong>Design & Engineering</strong>, <strong>Permitting</strong>, or <strong>Interconnection</strong> for stage-specific status</li>
            <li>Schedule work in the <strong>Master Scheduler</strong> - use Auto-Optimize for quick scheduling</li>
            <li>Monitor <strong>Incentives</strong> for program application status</li>
            <li>Check <strong>PE Dashboard</strong> for Participate Energy compliance</li>
            <li>Share <strong>Executive Summary</strong> with leadership for KPI reviews</li>
          </ol>
        </section>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-zinc-800 text-center text-zinc-500 text-sm">
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
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${tagColors[tagColor]}`}>
          {tag}
        </span>
      </div>

      <p className="text-zinc-400 mb-4">
        <strong className="text-zinc-300">Purpose:</strong> {purpose}
      </p>

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-2">Key Features:</h4>
        <ul className="list-disc list-inside space-y-1 text-sm text-zinc-400">
          {features.map((feature, i) => (
            <li key={i}>{feature}</li>
          ))}
        </ul>
      </div>

      {howToUse && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">How to Use:</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-zinc-400">
            {howToUse.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {keyboardShortcuts && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">Keyboard Shortcuts:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {keyboardShortcuts.map((shortcut, i) => (
              <div key={i} className="flex items-center gap-2">
                <kbd className="bg-zinc-800 px-2 py-0.5 rounded text-xs font-mono text-orange-400">{shortcut.keys}</kbd>
                <span className="text-zinc-400">{shortcut.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {riskTypes && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">Risk Types:</h4>
          <ul className="space-y-1 text-sm">
            {riskTypes.map((risk, i) => (
              <li key={i} className="text-zinc-400">
                <strong className="text-red-400">{risk.type}</strong> - {risk.desc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {colorLegend && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">Health Score Colors:</h4>
          <div className="flex gap-4 text-sm">
            {colorLegend.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded ${item.color}`}></div>
                <span className="text-zinc-400">{item.label}</span>
              </div>
            ))}
          </div>
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
