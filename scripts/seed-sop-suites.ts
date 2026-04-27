/**
 * Seed the Suites SOP tab — one section per suite plus an overview.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-suites.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "suites";
const TAB_LABEL = "Suites";
const TAB_SORT = 13;

// ─── Sections ─────────────────────────────────────────────────────

const OVERVIEW = `
<h1>Suites Overview</h1>

<p>The Tech Ops Suite is organized into ten <strong>departmental suites</strong>. Each suite is a landing page that groups the dashboards a particular team uses every day. Pick the suite that matches your work — you don't need to memorize URLs.</p>

<h2>The Ten Suites</h2>

<table>
<thead><tr><th>Suite</th><th>What lives here</th><th>URL</th></tr></thead>
<tbody>
<tr><td><strong>Operations</strong></td><td>Scheduling, timeline, inventory, equipment ops</td><td><code>/suites/operations</code></td></tr>
<tr><td><strong>Design &amp; Engineering</strong></td><td>Design reviews, clipping, AHJ rules, engineering tools</td><td><code>/suites/design-engineering</code></td></tr>
<tr><td><strong>Permitting &amp; Interconnection</strong></td><td>Permit hub, IC hub, action queues, SLA monitoring</td><td><code>/suites/permitting-interconnection</code></td></tr>
<tr><td><strong>Service</strong></td><td>Priority queue, ticket board, service scheduling, customer 360</td><td><code>/suites/service</code></td></tr>
<tr><td><strong>D&amp;R + Roofing</strong></td><td>Detach &amp; reset and roofing pipelines + schedulers</td><td><code>/suites/dnr-roofing</code></td></tr>
<tr><td><strong>Intelligence</strong></td><td>At-risk projects, QC metrics, alerts, optimizer, project management</td><td><code>/suites/intelligence</code></td></tr>
<tr><td><strong>Executive</strong></td><td>Revenue, command center, capacity, forecasts</td><td><code>/suites/executive</code></td></tr>
<tr><td><strong>Accounting</strong></td><td>Payment tracking, AR, PE deals, invoicing</td><td><code>/suites/accounting</code></td></tr>
<tr><td><strong>Sales &amp; Marketing</strong></td><td>Sales pipeline, pricing calculator, estimator, adders</td><td><code>/suites/sales-marketing</code></td></tr>
<tr><td><strong>Admin</strong></td><td>Users, security, compliance, system config</td><td><code>/admin</code></td></tr>
</tbody>
</table>

<h2>Who Sees Which Suite</h2>

<p>The <strong>suite switcher</strong> in the top-right shows you only the suites you can access. Visibility is driven by your assigned roles.</p>

<table>
<thead><tr><th>Suite</th><th>Roles in switcher</th></tr></thead>
<tbody>
<tr><td>Operations</td><td>ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS</td></tr>
<tr><td>Design &amp; Engineering</td><td>ADMIN, OWNER, PM, TECH_OPS, DESIGN</td></tr>
<tr><td>Permitting &amp; Interconnection</td><td>ADMIN, OWNER, PM, TECH_OPS, PERMIT, INTERCONNECT</td></tr>
<tr><td>Service</td><td>ADMIN, OWNER, PM, OPS_MGR, OPS, SERVICE</td></tr>
<tr><td>D&amp;R + Roofing</td><td>ADMIN, OWNER, PM, OPS_MGR, ROOFING</td></tr>
<tr><td>Intelligence</td><td>ADMIN, OWNER, PM, OPS_MGR, INTELLIGENCE</td></tr>
<tr><td>Executive</td><td>ADMIN, OWNER</td></tr>
<tr><td>Accounting</td><td>ADMIN, OWNER, ACCOUNTING</td></tr>
<tr><td>Sales &amp; Marketing</td><td>ADMIN, OWNER, SALES_MANAGER, SALES, MARKETING</td></tr>
<tr><td>Admin</td><td>ADMIN only</td></tr>
</tbody>
</table>

<div class="info"><strong>Multi-role users</strong> see the union of suites across all their roles — the highest-privilege role wins for each individual suite. So a user with <code>OPS</code> + <code>SALES</code> sees both Operations and Sales &amp; Marketing in their switcher.</div>

<h2>The Suite Switcher</h2>

<p>Click your initials in the top-right of any page → the switcher shows every suite you can access plus the dashboard you're currently on. Pick a suite to land on its hub page.</p>

<h2>Direct URL Access vs the Switcher</h2>

<div class="warn">For <strong>PM</strong> and <strong>OPS_MGR</strong> roles, direct URL access to the Executive suite works (<code>/suites/executive</code> loads), but the Executive suite is hidden from their switcher. This is intentional — leadership dashboards are technically reachable for cross-functional analysis but not promoted in day-to-day nav.</div>

<h2>Permission Booleans (override role defaults)</h2>

<p>Beyond role-based access, individual users can have specific permissions toggled on or off:</p>
<ul>
<li><code>canScheduleSurveys</code>, <code>canScheduleInstalls</code>, <code>canScheduleInspections</code></li>
<li><code>canSyncZuper</code>, <code>canManageUsers</code>, <code>canManageAvailability</code></li>
<li><code>canEditDesign</code>, <code>canEditPermitting</code></li>
<li><code>canViewAllLocations</code></li>
</ul>

<p>If you can see a suite but a specific button is disabled, ask your admin to flip the relevant permission boolean on your user record.</p>
`;

const OPERATIONS = `
<h1>Operations Suite</h1>

<p><strong>URL:</strong> <code>/suites/operations</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS</p>

<p>The Operations Suite is the main daily workspace for ops coordinators and managers. It groups everything you need to move projects from Ready To Build through PTO: schedulers, jobs map, equipment forecasting, and the catalog/inventory tools.</p>

<h2>Cards on the Suite Page</h2>

<h3>Scheduling &amp; Map</h3>
<ul>
<li><strong>Master Schedule</strong> (<code>/dashboards/scheduler</code>) — Drag-and-drop scheduling calendar with crew management.</li>
<li><strong>Jobs Map</strong> (<code>/dashboards/map</code>) — Map of scheduled and unscheduled work with crew positions and proximity insights.</li>
<li><strong>Forecast Schedule</strong> (<code>/dashboards/forecast-schedule</code>) — Calendar view of all forecasted installs by stage and location.</li>
<li><strong>Equipment Backlog</strong> (<code>/dashboards/equipment-backlog</code>) — Equipment forecasting by brand, model, and stage.</li>
</ul>

<h3>Site Survey</h3>
<ul>
<li><strong>Site Survey Schedule</strong> — Calendar for scheduling surveys with Zuper integration.</li>
<li><strong>Site Survey Execution</strong> — Status tracking and completion monitoring.</li>
<li><strong>Survey Metrics</strong> — Turnaround by office and surveyor, completion rates.</li>
</ul>

<h3>Construction</h3>
<ul>
<li><strong>Construction Schedule</strong> — Calendar for scheduling installs.</li>
<li><strong>Construction Execution</strong> — Status, scheduling, and progress tracking.</li>
<li><strong>Construction Completion Metrics</strong> — Average start-to-completion times by location.</li>
</ul>

<h3>Inspections</h3>
<ul>
<li><strong>Inspection Schedule</strong> — Calendar for scheduling inspections.</li>
<li><strong>Inspections Execution</strong> — Status tracking and AHJ analysis.</li>
<li><strong>Inspection Metrics</strong> — Turnaround, first-time pass rates, failure tracking by AHJ.</li>
</ul>

<h3>Catalog &amp; Inventory</h3>
<ul>
<li><strong>Product Catalog</strong> — Browse the full equipment catalog.</li>
<li><strong>Planset BOM</strong> (<code>/dashboards/bom</code>) — Extract BOM from a planset PDF and push to a deal.</li>
<li><strong>Submit New Product</strong> — Wizard for adding a new SKU.</li>
<li><strong>Inventory Hub</strong>, <strong>Catalog Management</strong>, <strong>Product Request Queue</strong>, <strong>Product Catalog Comparison</strong></li>
</ul>

<h3>Comms &amp; Tasks</h3>
<ul>
<li><strong>Comms</strong> — Outbound communications hub.</li>
<li><strong>My Tasks</strong> — Your personal task queue.</li>
</ul>
`;

const DESIGN_ENGINEERING = `
<h1>Design &amp; Engineering Suite</h1>

<p><strong>URL:</strong> <code>/suites/design-engineering</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, TECH_OPS, DESIGN</p>

<p>Home base for in-house designers and tech ops. Tracks design review queues, revision cycles, AHJ rules, and equipment performance flags.</p>

<h2>Cards on the Suite Page</h2>

<h3>Overview</h3>
<ul>
<li><strong>D&amp;E Overview</strong> — Summary metrics, status funnel, and action items.</li>
</ul>

<h3>Action Queues</h3>
<ul>
<li><strong>Plan Review Queue</strong> — Projects in initial or final design review.</li>
<li><strong>Design Approval Queue</strong> (<code>/dashboards/pending-approval</code>) — Survey done needing design, designs ready to send, DAs awaiting customer approval.</li>
<li><strong>Design Revisions</strong> — Projects in revision cycles with rejection reasons and turnaround.</li>
</ul>

<h3>Pipeline &amp; Metrics</h3>
<ul>
<li><strong>Design Pipeline Funnel</strong> — Sales-to-DA throughput funnel.</li>
<li><strong>D&amp;E Metrics</strong> — DA turnaround and revisions by office, designer productivity, monthly trends.</li>
<li><strong>D&amp;E Dept Analytics</strong> — Cross-state analytics, status breakdowns, ops clarification queue.</li>
</ul>

<h3>Equipment &amp; Production</h3>
<ul>
<li><strong>Clipping &amp; System Analytics</strong> — Seasonal clipping detection, equipment performance trends, system review flags.</li>
<li><strong>Production Issues</strong> — Every project flagged for production review, grouped by location/stage/risk/owner/equipment.</li>
</ul>

<h3>Reference &amp; Tools</h3>
<ul>
<li><strong>AHJ Design Requirements</strong> — AHJ-specific design rules, rejection patterns, turnaround.</li>
<li><strong>Utility Design Requirements</strong> — Utility-specific constraints and specifications.</li>
<li><strong>Solar Surveyor</strong>, <strong>Solar Designer</strong>, <strong>TSRF Calculator</strong> — Engineering tools.</li>
</ul>
`;

const PERMITTING_INTERCONNECTION = `
<h1>Permitting &amp; Interconnection Suite</h1>

<p><strong>URL:</strong> <code>/suites/permitting-interconnection</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, TECH_OPS, PERMIT, INTERCONNECT</p>

<p>Combined home for the permit team and the interconnection team. Per-job action queues, revision tracking, AHJ/utility analytics, and SLA monitoring.</p>

<h2>Cards on the Suite Page</h2>

<h3>Hubs (top of page)</h3>
<ul>
<li><strong>Permit Hub</strong> (<code>/dashboards/permit-hub</code>) — All-in-one permit dashboard.</li>
<li><strong>Interconnection Hub</strong> (<code>/dashboards/ic-hub</code>) — All-in-one IC dashboard.</li>
</ul>

<h3>Overview &amp; Action Queues</h3>
<ul>
<li><strong>P&amp;I Overview</strong> — Summary across permitting, IC, and PTO pipelines.</li>
<li><strong>Permit Action Queue</strong> — Permit-only items: ready-to-submit, resubmit, stale.</li>
<li><strong>IC &amp; PTO Action Queue</strong> — Interconnection and PTO items with status.</li>
</ul>

<h3>Revisions</h3>
<ul>
<li><strong>Permit Revisions</strong> — Permit revision queue.</li>
<li><strong>IC Revisions</strong> — Interconnection revision queue.</li>
</ul>

<h3>Metrics &amp; Analytics</h3>
<ul>
<li><strong>P&amp;I Metrics</strong> — Permits submitted/issued/pending, IC apps, PTO status, revenue.</li>
<li><strong>Timeline &amp; SLA</strong> — Configurable SLA targets with AHJ/utility benchmarks.</li>
<li><strong>P&amp;I Dept Analytics</strong> — Combined turnaround and action-needed views.</li>
</ul>

<h3>External-system Trackers</h3>
<ul>
<li><strong>AHJ Tracker</strong> — Per-AHJ turnaround, rejection rates, volume.</li>
<li><strong>Utility Tracker</strong> — Per-utility IC timelines, PTO tracking, bottlenecks.</li>
<li><strong>Incentives</strong> — Rebate and incentive program tracking.</li>
</ul>
`;

const SERVICE = `
<h1>Service Suite</h1>

<p><strong>URL:</strong> <code>/suites/service</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, OPS_MGR, OPS, SERVICE</p>

<p>Daily workspace for the service team. Centered on the priority queue (which deals/tickets need attention) and the ticket board (kanban). Includes service scheduling and customer 360.</p>

<h2>Cards on the Suite Page</h2>

<h3>Daily Workflow</h3>
<ul>
<li><strong>Service Overview</strong> (<code>/dashboards/service-overview</code>) — Priority queue command center. <em>Start your day here.</em></li>
<li><strong>Ticket Board</strong> (<code>/dashboards/service-tickets</code>) — Kanban for HubSpot service tickets. Filter, reassign, change status, add notes.</li>
<li><strong>Service Schedule</strong> — Calendar for Zuper service visit/revisit jobs.</li>
<li><strong>Unscheduled Jobs</strong> — Zuper jobs awaiting a date, with age-based urgency flags.</li>
<li><strong>Jobs Map</strong> (filtered to service) — Map of service work + crew positions.</li>
</ul>

<h3>Customer Lookup</h3>
<ul>
<li><strong>Customer History</strong> (<code>/dashboards/service-customers</code>) — Search by name, email, phone, or address. See all deals, tickets, jobs.</li>
</ul>

<h3>Pipeline &amp; Forecasting</h3>
<ul>
<li><strong>Service Pipeline</strong> — Service deal tracking with stage progression.</li>
<li><strong>Service Equipment Backlog</strong> — Service-pipeline equipment forecasting.</li>
<li><strong>Service Catalog</strong> — Browse service products, pricing, availability.</li>
</ul>

<h3>Engineering Tools</h3>
<ul>
<li><strong>Solar Surveyor</strong>, <strong>TSRF Peak Power Calculator</strong> — When you need to spec a service replacement.</li>
</ul>

<div class="info">For Service Priority Queue scoring details (tiers, factors, manual overrides), see the <strong>Service</strong> tab in this SOP guide.</div>
`;

const DNR_ROOFING = `
<h1>D&amp;R + Roofing Suite</h1>

<p><strong>URL:</strong> <code>/suites/dnr-roofing</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, OPS_MGR, ROOFING</p>

<p>Combined hub for Detach &amp; Reset and Roofing teams. Both have separate pipelines and schedulers but live in the same suite for cross-team visibility.</p>

<h2>Cards on the Suite Page</h2>

<h3>D&amp;R</h3>
<ul>
<li><strong>D&amp;R Pipeline</strong> — D&amp;R project tracking through pipeline stages.</li>
<li><strong>D&amp;R Scheduler</strong> — Calendar for Zuper detach, reset, and inspection jobs.</li>
</ul>

<h3>Roofing</h3>
<ul>
<li><strong>Roofing Pipeline</strong> — Roofing project tracking through pipeline stages.</li>
<li><strong>Roofing Scheduler</strong> — Calendar for Zuper roofing jobs.</li>
</ul>

<div class="info">D&amp;R and Roofing run on different HubSpot pipelines (<code>HUBSPOT_PIPELINE_DNR</code> and <code>HUBSPOT_PIPELINE_ROOFING</code>) — pipelines are configured via env vars.</div>
`;

const INTELLIGENCE = `
<h1>Intelligence Suite</h1>

<p><strong>URL:</strong> <code>/suites/intelligence</code> — <strong>Roles:</strong> ADMIN, OWNER, PM, OPS_MGR, INTELLIGENCE</p>

<p>Cross-functional analytics for project managers and ops leadership. Surfaces at-risk work, alerts, throughput optimization, and PM workload.</p>

<h2>Cards on the Suite Page</h2>

<ul>
<li><strong>At-Risk Projects</strong> — Overdue milestones, stalled stages, severity scoring.</li>
<li><strong>QC Metrics</strong> — Time-between-stages analytics by office and utility.</li>
<li><strong>Alerts</strong> — Overdue installs, PE PTO risks, capacity overload warnings.</li>
<li><strong>Timeline View</strong> — Gantt-style timeline showing project progression and milestones.</li>
<li><strong>Pipeline Overview</strong> — Full project pipeline with filters, priority scoring, and milestone tracking.</li>
<li><strong>Pipeline Optimizer</strong> — Identify scheduling opportunities and optimize throughput.</li>
<li><strong>Project Management</strong> — PM workload, DA backlog, stuck deals, revenue tracking.</li>
</ul>
`;

const EXECUTIVE = `
<h1>Executive Suite</h1>

<p><strong>URL:</strong> <code>/suites/executive</code> — <strong>Roles in switcher:</strong> ADMIN, OWNER</p>

<div class="info">PM and OPS_MGR roles can reach Executive dashboards by direct URL but the suite is hidden from their switcher.</div>

<p>Leadership-level metrics: revenue, capacity, location comparison, and cross-state analytics. Designed for at-a-glance reads rather than per-deal action.</p>

<h2>Cards on the Suite Page</h2>

<h3>Revenue &amp; Performance</h3>
<ul>
<li><strong>Revenue</strong> — Revenue by stage, backlog forecasts, location breakdowns, milestone timelines.</li>
<li><strong>Executive Summary</strong> — High-level pipeline and stage analysis with location and monthly trends.</li>
<li><strong>Revenue Calendar</strong> — Monthly calendar of daily deal value of scheduled field work.</li>
<li><strong>Sales Pipeline</strong> — Active deals, funnel, proposal tracking.</li>
<li><strong>Design Pipeline Funnel</strong> — Sales → Survey → DA Sent → DA Approved with monthly cohorts.</li>
</ul>

<h3>Operational Health</h3>
<ul>
<li><strong>Preconstruction Metrics</strong> — Survey, DA, permitting, IC KPIs with 12-month trends.</li>
<li><strong>Command Center</strong> — Real-time live metrics and alerts.</li>
<li><strong>Capacity Planning</strong> — Crew capacity vs. forecasted installs by location and month.</li>
<li><strong>Location Comparison</strong> — Side-by-side performance and pipeline breakdown.</li>
<li><strong>Territory Map</strong> — Colorado office territories, deal distribution, proposed rebalancing.</li>
</ul>

<h3>Quality &amp; Forecast</h3>
<ul>
<li><strong>Zuper Compliance</strong> — Per-user scorecards and crew-composition comparisons.</li>
<li><strong>Forecast Accuracy</strong> — How well the model predicts reality across milestones.</li>
<li><strong>Forecast Timeline</strong> — Project-by-project PTO forecast with variance.</li>
</ul>

<h3>Customer-Facing</h3>
<ul>
<li><strong>Customer Estimator (preview)</strong> — Public-facing instant solar estimator.</li>
</ul>
`;

const ACCOUNTING = `
<h1>Accounting Suite</h1>

<p><strong>URL:</strong> <code>/suites/accounting</code> — <strong>Roles:</strong> ADMIN, OWNER, ACCOUNTING</p>

<p>Daily workspace for the accounting team — payment tracking, AR aging, ready-to-invoice, PE deal compliance.</p>

<h2>Cards on the Suite Page</h2>

<ul>
<li><strong>Payment Action Queue</strong> — Rejected invoices, overdue payments, ready-to-invoice work milestones.</li>
<li><strong>Payment Tracking</strong> — Per-project payment status (not yet paid, partially paid, fully paid).</li>
<li><strong>Ready to Invoice</strong> — Work milestones hit but no invoice created yet, grouped by milestone.</li>
<li><strong>Accounts Receivable</strong> — Invoices sent but unpaid, grouped by aging bucket (0–30, 31–60, 61–90, 90+).</li>
<li><strong>PE Deals &amp; Payments</strong> — All PE-tagged deals with auto-calculated EPC, lease factor, and payment splits.</li>
<li><strong>PE Dashboard</strong> — Participate Energy milestone tracking and compliance.</li>
</ul>

<div class="info">For payment-milestone trigger points (DA / CC / PTO / PE M1 / PE M2) and known invoice product SKUs, ask an admin or check the SOP Reference tab.</div>
`;

const SALES_MARKETING = `
<h1>Sales &amp; Marketing Suite</h1>

<p><strong>URL:</strong> <code>/suites/sales-marketing</code> — <strong>Roles:</strong> ADMIN, OWNER, SALES_MANAGER, SALES, MARKETING</p>

<p>Pipeline visibility, pricing, and the customer-facing estimator. SALES role also gets access to the Site Survey Scheduler from here.</p>

<h2>Cards on the Suite Page</h2>

<h3>Tools (top of page)</h3>
<ul>
<li><strong>Request a Product</strong> — Submit a request for a SKU not yet in the catalog.</li>
</ul>

<h3>Pipeline &amp; Pricing</h3>
<ul>
<li><strong>Sales Pipeline</strong> — Active deals, funnel visualization, proposal tracking.</li>
<li><strong>Pricing Calculator</strong> — Price solar + battery systems with PE lease value calculator and COGS breakdown.</li>
</ul>

<h3>Adders (in progress)</h3>
<ul>
<li><strong>Adder Catalog 🚧</strong> — Governed list of system adders (MPU, trenching, steep roof) with prices and shop overrides. <em>Preview only.</em></li>
<li><strong>Adder Triage 🚧</strong> — Mobile questionnaire to capture system conditions at point of sale. <em>Preview only.</em></li>
</ul>

<h3>Customer-Facing</h3>
<ul>
<li><strong>Estimator</strong> — Customer-facing quote estimator: solar, battery, EV, D&amp;R.</li>
<li><strong>Site Survey Schedule</strong> — Schedule customer site surveys (subject to the 2-day-out rule for SALES role).</li>
</ul>

<div class="warn"><strong>Sales lead-time rule:</strong> if you have the SALES role, you cannot schedule a site survey for today or tomorrow. The earliest available date is 2 days out.</div>
`;

const ADMIN = `
<h1>Admin</h1>

<p><strong>URL:</strong> <code>/admin</code> — <strong>Roles:</strong> ADMIN only</p>

<p>System-level controls. Most users will never see this. Admins use it to manage users, run security &amp; compliance checks, and edit the SOP guide itself.</p>

<h2>What's in Admin</h2>

<ul>
<li><strong>User Management</strong> — Create, edit, deactivate users; assign roles and permission booleans.</li>
<li><strong>Activity Logs</strong> — Per-user audit trail of actions (login, scheduling, sync, etc.).</li>
<li><strong>Security &amp; Anomaly Events</strong> — Audit anomaly events with risk levels (LOW / MEDIUM / HIGH / CRITICAL).</li>
<li><strong>System Config</strong> — Maintenance mode toggle, pipeline IDs, location calendar mappings.</li>
<li><strong>SOP Editor</strong> — Edit any SOP section with version history and revision suggestions.</li>
<li><strong>Workflows</strong> (when <code>ADMIN_WORKFLOWS_ENABLED</code> is on) — Visual workflow builder for automating sequences across HubSpot/Zuper/email/AI.</li>
</ul>

<div class="info">Admin routes are protected at the middleware layer — even if a non-admin guesses the URL, the request is rejected before the page renders.</div>
`;

const SECTIONS = [
  { id: "suites-overview", group: "Suites", title: "Overview", color: "blue", order: 0, content: OVERVIEW },
  { id: "suites-operations", group: "Suites", title: "Operations", color: "orange", order: 1, content: OPERATIONS },
  { id: "suites-de", group: "Suites", title: "Design & Engineering", color: "cyan", order: 2, content: DESIGN_ENGINEERING },
  { id: "suites-pi", group: "Suites", title: "Permitting & Interconnection", color: "purple", order: 3, content: PERMITTING_INTERCONNECTION },
  { id: "suites-service", group: "Suites", title: "Service", color: "emerald", order: 4, content: SERVICE },
  { id: "suites-dnr", group: "Suites", title: "D&R + Roofing", color: "amber", order: 5, content: DNR_ROOFING },
  { id: "suites-intelligence", group: "Suites", title: "Intelligence", color: "blue", order: 6, content: INTELLIGENCE },
  { id: "suites-executive", group: "Suites", title: "Executive", color: "red", order: 7, content: EXECUTIVE },
  { id: "suites-accounting", group: "Suites", title: "Accounting", color: "green", order: 8, content: ACCOUNTING },
  { id: "suites-sales-marketing", group: "Suites", title: "Sales & Marketing", color: "purple", order: 9, content: SALES_MARKETING },
  { id: "suites-admin", group: "Suites", title: "Admin", color: "red", order: 10, content: ADMIN },
];

async function main() {
  const existingTab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!existingTab) {
    await prisma.sopTab.create({ data: { id: TAB_ID, label: TAB_LABEL, sortOrder: TAB_SORT } });
    console.log(`Created tab: ${TAB_ID} (${TAB_LABEL})`);
  }

  for (const section of SECTIONS) {
    const existing = await prisma.sopSection.findUnique({ where: { id: section.id } });
    if (existing && !FORCE) {
      console.log(`  Skip "${section.id}" (exists; --force to overwrite).`);
      continue;
    }
    if (existing && FORCE) {
      await prisma.sopSection.update({
        where: { id: section.id },
        data: {
          sidebarGroup: section.group,
          title: section.title,
          dotColor: section.color,
          sortOrder: section.order,
          content: section.content.trim(),
          version: { increment: 1 },
          updatedBy: "system@photonbrothers.com",
        },
      });
      console.log(`  Overwrote "${section.id}" (--force).`);
      continue;
    }
    await prisma.sopSection.create({
      data: {
        id: section.id,
        tabId: TAB_ID,
        sidebarGroup: section.group,
        title: section.title,
        dotColor: section.color,
        sortOrder: section.order,
        content: section.content.trim(),
        version: 1,
        updatedBy: "system@photonbrothers.com",
      },
    });
    console.log(`  Created section: ${section.id} — ${section.title}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
