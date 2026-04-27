/**
 * Seed additional Tools sections: Pricing Calculator, Permit Hub, IC Hub,
 * Solar Surveyor, Master Schedule, Pipeline Optimizer, Jobs Map.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-tools-2.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "tools";

// ─── Sections ─────────────────────────────────────────────────────

const PRICING_CALCULATOR = `
<h1>Pricing Calculator</h1>

<p>Price a solar + battery system with per-line equipment selection and a full COGS breakdown. Includes the Participate Energy lease value calculator for PE-tagged deals.</p>

<ul>
<li>URL: <code>/dashboards/pricing-calculator</code></li>
<li>Visible from: Sales &amp; Marketing Suite, Accounting Suite, Admin</li>
</ul>

<h2>Equipment Selection (top of page)</h2>

<p>Four panels — pick the items going into the system:</p>

<ul>
<li><strong>Modules</strong> — pick from active catalog modules (wattage drives system size)</li>
<li><strong>Inverters</strong> — string / hybrid / micro</li>
<li><strong>Batteries</strong> — battery + expansion if applicable</li>
<li><strong>Other</strong> — racking, BOS, monitoring, EV charger, anything not in the first three buckets</li>
</ul>

<p>Each selection contributes to the line items on the quote and to the COGS calculation.</p>

<h2>Cost Breakdown (bottom)</h2>

<table>
<thead><tr><th>Section</th><th>What goes in</th></tr></thead>
<tbody>
<tr><td><strong>COGS</strong></td><td>Hardware unit costs from the catalog (driven by your equipment selections)</td></tr>
<tr><td><strong>Labour</strong></td><td>Crew labour hours × rate</td></tr>
<tr><td><strong>Acquisition Costs</strong></td><td>Sales commission + marketing attribution</td></tr>
<tr><td><strong>Fulfillment Costs</strong></td><td>Permitting, interconnection, PTO, inspection, third-party services</td></tr>
<tr><td><strong>Extra Costs (Roof/Site)</strong></td><td>Adders for difficult roofs, trenching, MPU, sub-panels, etc.</td></tr>
</tbody>
</table>

<h2>Replace Calculator Data</h2>

<p>If you change deal context (different customer, different system) and want to start fresh, click <strong>Replace Calculator Data</strong>. A confirmation dialog warns you before clearing the current state.</p>

<h2>PE Lease Value</h2>

<p>For Participate Energy deals, the calculator surfaces the lease factor and EPC value automatically — same numbers used in the Accounting Suite's PE Deals dashboard.</p>

<div class="info">All catalog data is read live from the internal product database. If a piece of equipment is missing from the dropdown, submit it via the catalog wizard first (see the <a href="/sop?tab=catalog">Catalog tab</a>).</div>
`;

const PERMIT_HUB = `
<h1>Permit Hub</h1>

<p>The all-in-one daily workspace for the permitting team. Split-pane layout: queue on the left, full project detail with action forms on the right.</p>

<ul>
<li>URL: <code>/dashboards/permit-hub</code></li>
<li>Visible to: ADMIN, OWNER, PM, TECH_OPS, PERMIT (per the P&amp;I suite gating)</li>
</ul>

<h2>Layout</h2>

<p>Two-pane view (full viewport height minus the page chrome):</p>

<ul>
<li><strong>Queue (420px left rail)</strong> — every project that needs permit attention, ordered by SLA / staleness</li>
<li><strong>Project Detail (right pane)</strong> — populated when you select a queue item; empty state says "Select a project from the queue to begin."</li>
</ul>

<h2>Real-time Updates</h2>

<p>The queue listens for SSE with cache filter <code>deals:permit</code> and refetches automatically. Stale time is 30 seconds for the manual refetch.</p>

<h2>Project Detail — Six Tabs</h2>

<ol>
<li><strong>Overview</strong> — high-level deal info, current permit status</li>
<li><strong>AHJ</strong> — AHJ-specific rules and historical patterns for this jurisdiction</li>
<li><strong>Planset</strong> — current planset rev with link to the design folder</li>
<li><strong>Correspondence</strong> — log of communications with the AHJ</li>
<li><strong>Status History</strong> — every status transition, who changed it, when</li>
<li><strong>Activity</strong> — full audit trail of actions taken on this project</li>
</ol>

<h2>External-Link Toolbar</h2>

<p>The detail header has quick-launch buttons to the systems you'll need:</p>
<ul>
<li><strong>HubSpot</strong> — the deal record</li>
<li><strong>AHJ Portal</strong> — the AHJ's online submission portal (when known)</li>
<li><strong>Application</strong> — the AHJ application form/PDF</li>
<li><strong>Permit Folder</strong> — Google Drive folder with submission docs</li>
<li><strong>Design Folder</strong> — Drive folder with the planset</li>
</ul>

<p>Buttons are disabled (gray) when the URL isn't on the deal yet — hover for "[label] not available" tooltip.</p>

<h2>Action Forms (right side, status-driven)</h2>

<p>Based on the project's current permit status, the right pane offers exactly one action form. Available forms:</p>

<table>
<thead><tr><th>Action</th><th>Title shown</th></tr></thead>
<tbody>
<tr><td>SUBMIT_TO_AHJ</td><td>Submit to AHJ</td></tr>
<tr><td>RESUBMIT_TO_AHJ</td><td>Resubmit to AHJ</td></tr>
<tr><td>REVIEW_REJECTION</td><td>Review rejection</td></tr>
<tr><td>FOLLOW_UP</td><td>Follow up with AHJ</td></tr>
<tr><td>COMPLETE_REVISION</td><td>Complete revision</td></tr>
<tr><td>START_AS_BUILT_REVISION</td><td>Start as-built revision</td></tr>
<tr><td>COMPLETE_AS_BUILT</td><td>Complete as-built revision</td></tr>
<tr><td>SUBMIT_SOLARAPP</td><td>Submit SolarApp+</td></tr>
<tr><td>MARK_PERMIT_ISSUED</td><td>Mark permit issued</td></tr>
</tbody>
</table>

<p>If no form is available for the current status, the panel shows: <em>"No action form for this status."</em></p>

<div class="info">Each form posts a status transition that updates HubSpot and writes to the status history. The queue refreshes via SSE so the project moves to its new bucket automatically.</div>
`;

const IC_HUB = `
<h1>Interconnection Hub</h1>

<p>The all-in-one daily workspace for the interconnection team. Same split-pane pattern as Permit Hub, but tuned to utility/IC workflows instead of AHJ.</p>

<ul>
<li>URL: <code>/dashboards/ic-hub</code></li>
<li>Visible to: ADMIN, OWNER, PM, TECH_OPS, INTERCONNECT (per P&amp;I suite gating)</li>
</ul>

<h2>Layout</h2>

<p>Same two-pane view as Permit Hub. Queue refetches via SSE with cache filter <code>deals:ic</code>; 30-second stale time.</p>

<h2>Project Detail — Six Tabs</h2>

<ol>
<li><strong>Overview</strong></li>
<li><strong>Utility</strong> — utility-specific requirements, IC application notes</li>
<li><strong>Planset</strong></li>
<li><strong>Correspondence</strong></li>
<li><strong>Status History</strong></li>
<li><strong>Activity</strong></li>
</ol>

<h2>Action Forms</h2>

<table>
<thead><tr><th>Action</th><th>Title shown</th></tr></thead>
<tbody>
<tr><td>SUBMIT_TO_UTILITY</td><td>Submit to Utility</td></tr>
<tr><td>RESUBMIT_TO_UTILITY</td><td>Resubmit to Utility</td></tr>
<tr><td>REVIEW_REJECTION</td><td>Review utility rejection</td></tr>
<tr><td>FOLLOW_UP</td><td>Follow up with utility</td></tr>
<tr><td>COMPLETE_REVISION</td><td>Complete IC revision</td></tr>
<tr><td>PROVIDE_INFORMATION</td><td>Provide information to utility</td></tr>
<tr><td>MARK_IC_APPROVED</td><td>Mark IC approved</td></tr>
</tbody>
</table>

<p>Status drives the form choice — same pattern as Permit Hub.</p>

<div class="info">For per-utility analytics (turnaround, bottleneck detection), see the <a href="/sop?tab=trackers">AHJ &amp; Utility tab</a>'s Utility Tracker section.</div>
`;

const SOLAR_SURVEYOR = `
<h1>Solar Surveyor</h1>

<p>Interactive solar site survey + design tool. Used to design system layouts, run shade analysis, and generate revisions tied to a HubSpot project.</p>

<ul>
<li>URL: <code>/dashboards/solar-surveyor</code></li>
<li>Visible from: Operations, Design &amp; Engineering, Service suites (each carries a <code>?suite=</code> query param so the back-link returns to the right place)</li>
<li>Login required — unauthenticated users redirect to <code>/login</code></li>
</ul>

<h2>Three Entry Modes</h2>

<table>
<thead><tr><th>Mode</th><th>What it is</th><th>When it's used</th></tr></thead>
<tbody>
<tr><td><strong>Native</strong> ("browser")</td><td>The full in-app surveyor</td><td>Default for users who haven't expressed a preference and the env allows native</td></tr>
<tr><td><strong>Wizard</strong></td><td>Guided step-by-step survey</td><td>When the user's preference is set to "wizard"</td></tr>
<tr><td><strong>Classic</strong></td><td>Legacy surveyor UI</td><td>When <code>FORCE_CLASSIC</code> env is set, or when the user prefers classic</td></tr>
</tbody>
</table>

<h2>How the Mode is Picked</h2>

<p>The page reads <code>resolveNativeMode()</code> from the env and the user's stored preference (<code>solarPreferredEntryMode</code> on the User record), then resolves to the right initial view:</p>

<ol>
<li><code>FORCE_CLASSIC</code> env → <strong>classic</strong> (toggle hidden, wizard blocked)</li>
<li><code>NATIVE_DEFAULT</code> env + pref "wizard" → wizard</li>
<li><code>NATIVE_DEFAULT</code> env + pref "classic" → classic</li>
<li><code>NATIVE_DEFAULT</code> env + pref "browser" or unset → native</li>
<li>Env unset + pref "wizard" → wizard</li>
<li>Env unset + pref "classic" or unset → classic</li>
<li>Env unset + pref "browser" → native</li>
</ol>

<h2>Setting Your Preference</h2>

<p>The mode toggle (top of the surveyor) saves your selection to your User record. Once set, every future visit lands you in the same mode.</p>

<div class="warn">If <code>FORCE_CLASSIC</code> is on (admin-controlled env var), the mode toggle is hidden and only Classic loads — even if your preference is something else. This is the kill switch we use during native-mode incidents.</div>

<h2>Working on a Project</h2>

<p>Once inside, the surveyor:</p>
<ul>
<li>Loads aerial imagery via EagleView (when configured)</li>
<li>Lets you place modules, draw setbacks, mark obstructions</li>
<li>Saves revisions to <code>SolarProjectRevision</code> rows in the database</li>
<li>Can be shared via <code>SolarProjectShare</code> for read-only review</li>
</ul>

<p>Closing the surveyor with unsaved state stores it in <code>SolarPendingState</code> so you can resume on next visit.</p>
`;

const MASTER_SCHEDULE = `
<h1>Master Schedule</h1>

<p>The big drag-and-drop scheduling calendar — the main scheduling surface for ops. Combines crew assignments, projects, and forecast ghosts into one view.</p>

<ul>
<li>URL: <code>/dashboards/scheduler</code></li>
<li>Visible to: ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS (Operations Suite)</li>
</ul>

<h2>What's Different From the Per-Function Schedulers</h2>

<p>The four schedulers in the <a href="/sop?tab=scheduling">Scheduling tab</a> (Site Survey, Construction, Inspection, Service) are each tuned to one job type. The <strong>Master Schedule</strong> shows everything at once — useful when you're rebalancing across crews, looking for capacity, or checking what's happening on a single day across all work types.</p>

<h2>Layout</h2>

<ul>
<li>Sidebar (collapsible) with the project list</li>
<li>Calendar grid with day, week, and month views (and a "day view" pop-out)</li>
<li>Per-event tooltip showing job name, crew, dollar amount, status (failed inspection ✗ / completed ✓ / overdue ⚠ / forecasted only)</li>
</ul>

<h2>Drag-and-Drop</h2>

<ul>
<li>Drag a project from the sidebar onto a day to schedule</li>
<li>Drag an existing event to a different day to reschedule</li>
<li>Hovering shows the full deal info before commit</li>
</ul>

<h2>Forecast Ghosts</h2>

<p>Pre-construction projects without real scheduled dates appear as ghost events on their forecast date. Tooltip says <em>"Forecasted install — not yet scheduled."</em> Once you drag a ghost to a real date, it becomes a confirmed event.</p>

<h2>Export</h2>

<ul>
<li><strong>Export CSV</strong> — daily/weekly schedule as a spreadsheet</li>
<li><strong>Export iCal</strong> — calendar file for importing into other tools</li>
<li><strong>Copy schedule to clipboard</strong> — formatted text for pasting into a Google Doc, email, or Slack thread</li>
</ul>

<h2>Quick Links Per Project</h2>

<ul>
<li>Open internal deal page</li>
<li>Open in Zuper</li>
<li>Open in HubSpot</li>
</ul>

<p>Hover any event to access these.</p>
`;

const OPTIMIZER = `
<h1>Pipeline Optimizer</h1>

<p>AI-powered scheduling optimization and bottleneck detection. The Optimizer suggests scheduling moves that improve throughput across the pipeline.</p>

<ul>
<li>URL: <code>/dashboards/optimizer</code></li>
<li>Visible from: Intelligence Suite, Operations Suite</li>
</ul>

<h2>What It Does</h2>

<p>The Optimizer runs heuristics over the pipeline to:</p>
<ul>
<li>Identify <strong>bottlenecks</strong> — stages where projects are accumulating beyond capacity</li>
<li>Suggest <strong>scheduling moves</strong> — projects that could ship sooner if scheduled differently</li>
<li>Flag <strong>capacity opportunities</strong> — open crew-days that could absorb work</li>
</ul>

<h2>How to Use It</h2>

<p>Open the page; the analysis runs automatically. Each suggestion includes:</p>
<ul>
<li>The project (with link to HubSpot)</li>
<li>The recommended action (reschedule earlier, reassign crew, escalate)</li>
<li>The expected impact</li>
</ul>

<p>Suggestions are ranked by impact. Acting on a suggestion just opens the relevant dashboard (scheduler, deal page, etc.) — the Optimizer doesn't apply changes automatically.</p>

<div class="info">This is a <em>recommendation</em> tool, not an automation tool. Review suggestions, decide which to apply, then make the change in the appropriate scheduler or deal page.</div>
`;

const JOBS_MAP = `
<h1>Jobs Map</h1>

<p>Geographic view of every job — scheduled, unscheduled, and in the backlog. Useful for spotting clustering opportunities, optimizing crew routes, and prepping morning briefings.</p>

<ul>
<li>URL: <code>/dashboards/map</code></li>
<li>Filtered to service: <code>/dashboards/map?types=service</code> (linked from Service Suite)</li>
<li>Visible from: Operations, Service, Executive suites</li>
</ul>

<h2>Three Views (mode picker)</h2>

<table>
<thead><tr><th>Mode</th><th>What it shows</th></tr></thead>
<tbody>
<tr><td><strong>Week</strong></td><td>Work scheduled in the next 7 days. Empty state: <em>"No work in the next 7 days matches your filters."</em></td></tr>
<tr><td><strong>Backlog</strong></td><td>Pre-construction work not yet on the schedule. Empty state: <em>"No pre-construction work in the backlog matches your filters."</em></td></tr>
<tr><td><strong>All</strong></td><td>Everything — scheduled + unscheduled + completed in window</td></tr>
</tbody>
</table>

<h2>Filters</h2>

<ul>
<li><strong>Office Picker</strong> — shows jobs for one or more PB locations. User-specific preference saved (so you don't have to re-pick every visit).</li>
<li><strong>Filter Bar</strong> — additional filters by job type, status, and assignee. Applied client-side, no refetch needed.</li>
</ul>

<h2>Map Canvas</h2>

<ul>
<li>Each job appears as a marker, color-coded by stage / status / type (see the legend top-right)</li>
<li>Click a marker → detail panel slides in with the project address, customer, deal info, and links</li>
<li>Crew positions overlay when crew tracking is on</li>
</ul>

<h2>Marker Table</h2>

<p>Below the map, every visible marker is listed in a sortable table. Click a row to focus the map on that job.</p>

<h2>Morning Briefing</h2>

<p>The map page also exposes a <strong>Morning Briefing</strong> view — a printable daily summary of every scheduled job for the day, grouped by crew, with addresses, customer names, and key project notes. Useful for crew-day prep.</p>

<h2>Export</h2>

<p>Export markers as CSV via the <code>exportMarkers</code> helper — useful for emailing route plans or pasting into a separate routing tool.</p>
`;

const SECTIONS = [
  { id: "tools-pricing-calculator", group: "Sales & Pricing", title: "Pricing Calculator", color: "amber", order: 10, content: PRICING_CALCULATOR },
  { id: "tools-permit-hub", group: "Permitting & Interconnection", title: "Permit Hub", color: "blue", order: 20, content: PERMIT_HUB },
  { id: "tools-ic-hub", group: "Permitting & Interconnection", title: "IC Hub", color: "cyan", order: 21, content: IC_HUB },
  { id: "tools-solar-surveyor", group: "Engineering", title: "Solar Surveyor", color: "emerald", order: 30, content: SOLAR_SURVEYOR },
  { id: "tools-master-schedule", group: "Operations", title: "Master Schedule", color: "orange", order: 40, content: MASTER_SCHEDULE },
  { id: "tools-optimizer", group: "Operations", title: "Pipeline Optimizer", color: "red", order: 41, content: OPTIMIZER },
  { id: "tools-jobs-map", group: "Operations", title: "Jobs Map", color: "purple", order: 42, content: JOBS_MAP },
];

async function main() {
  const tab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!tab) {
    console.error(`ERROR: Tab "${TAB_ID}" doesn't exist. Run scripts/seed-sop-tools.ts first.`);
    process.exit(1);
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
