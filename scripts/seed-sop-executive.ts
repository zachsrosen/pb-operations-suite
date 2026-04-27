/**
 * Seed the Executive SOP tab.
 *
 * Tab is admin-only by default — `executive-sop` is NOT added to PUBLIC_TABS
 * or TAB_ROLE_GATES, so only ADMIN/OWNER/EXECUTIVE see it (admin bypass).
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-executive.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "executive-sop";
const TAB_LABEL = "Executive";
const TAB_SORT = 16;

const REVENUE = `
<h1>Revenue</h1>

<p>Revenue dashboard — total deal value across all in-flight projects with stage and location breakdowns. Use this for board reporting, monthly P&amp;L, and topline pacing.</p>

<ul>
<li>URL: <code>/dashboards/revenue</code></li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li><strong>Hero stats</strong> (StatCards) — total active project value, RTB value, PE-tagged value, backlog value</li>
<li><strong>Backlog by stage</strong> — counts and revenue per pipeline stage</li>
<li><strong>By location</strong> — revenue distribution across the five PB offices (excludes "Unknown")</li>
<li><strong>Forecasted installations</strong> — project-by-project list with forecast install dates and overdue flags</li>
</ul>

<h2>How to read it</h2>

<p>The numbers are <em>active project value</em>, not booked revenue. A project counts toward the total from the moment a deal is signed until construction is complete. To see realized revenue (invoiced), use the Accounting tab's payment tracking views.</p>
`;

const COMMAND_CENTER = `
<h1>Command Center</h1>

<div class="info"><strong>Command Center has been split.</strong> The page at <code>/dashboards/command-center</code> now redirects directly to the Executive Suite hub at <code>/suites/executive</code>.</div>

<h2>Where the original Command Center content lives now</h2>

<p>The original "Command Center" was a single dashboard combining many leadership views. Each section now has its own dashboard:</p>

<table>
<thead><tr><th>Original section</th><th>Where it lives now</th></tr></thead>
<tbody>
<tr><td>Pipeline Overview</td><td><code>/dashboards/pipeline</code></td></tr>
<tr><td>Revenue</td><td><code>/dashboards/revenue</code></td></tr>
<tr><td>Capacity Planning</td><td><code>/dashboards/capacity</code></td></tr>
<tr><td>Participate Energy</td><td><code>/dashboards/pe</code></td></tr>
<tr><td>Alerts</td><td><code>/dashboards/alerts</code></td></tr>
<tr><td>Executive Summary</td><td><code>/dashboards/executive</code></td></tr>
<tr><td>Location Comparison</td><td><code>/dashboards/locations</code></td></tr>
</tbody>
</table>

<p>Visit the <a href="/suites/executive">Executive Suite</a> to navigate them with one click each.</p>
`;

const CAPACITY = `
<h1>Capacity Planning</h1>

<p>Crew capacity vs. forecasted installs by location and month. Use this to identify overload risk, justify hiring, and balance crew assignments across offices.</p>

<ul>
<li>URL: <code>/dashboards/capacity</code></li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li>Per-location capacity heatmap — month columns, location rows, color intensity by load</li>
<li>Forecasted install count vs. crew-day capacity, per month per location</li>
<li>Overload flags when forecast exceeds available capacity</li>
</ul>

<h2>Crew capacity inputs</h2>

<p>Capacity is computed from <code>CrewMember</code> active rosters, <code>CrewAvailability</code> default schedules, and <code>AvailabilityOverride</code> rows for PTO / sick / blocked days. New hires and terminations need <code>CrewMember</code> updates to reflect in this view.</p>
`;

const TERRITORY_MAP = `
<h1>Territory Map</h1>

<p>Colorado office territory boundaries, deal distribution, and proposed rebalancing — interactive map view.</p>

<ul>
<li>URL: <code>/dashboards/territory-map</code></li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE</li>
<li>Renders full-width (uses <code>fullWidth</code> prop on DashboardShell)</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li>Map of Colorado with current office territory boundaries drawn as polygons</li>
<li>Deal markers colored by office</li>
<li>Toggle to show <strong>proposed rebalancing</strong> — alternative boundary configurations and their projected impact</li>
</ul>

<h2>Use cases</h2>

<ul>
<li>New office siting — visualize underserved areas</li>
<li>Boundary disputes — see actual deal distribution vs. assumed coverage</li>
<li>Sales territory planning — set rep coverage based on map view</li>
</ul>
`;

const LOCATIONS = `
<h1>Location Comparison</h1>

<p>Side-by-side comparison of all five Photon Brothers locations: performance, capacity, and pipeline breakdown. Use this for executive review of which offices are over- and under-performing.</p>

<ul>
<li>URL: <code>/dashboards/locations</code></li>
<li>Subtitle: "Compare performance across all Photon Brothers locations"</li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li><strong>Per-location stat blocks</strong> — totals, averages, overdue counts</li>
<li><strong>Stage breakdown</strong> per location — counts at each pipeline stage</li>
<li><strong>Compare stages</strong> selector — pick stages to drill into</li>
<li><strong>Overdue projects</strong> per location with severity</li>
</ul>

<h2>Export</h2>

<p>CSV export available via the DashboardShell — filename <code>location-comparison</code>.</p>
`;

const PRECONST_METRICS = `
<h1>Preconstruction Metrics</h1>

<p>Site survey, design approval, permitting, and interconnection KPIs with 12-month trend lines. Use this to track operational health over time and spot deteriorating turnarounds before they become emergencies.</p>

<ul>
<li>URL: <code>/dashboards/preconstruction-metrics</code></li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE</li>
</ul>

<h2>Hero stats (12-month windows)</h2>

<ul>
<li><strong>Surveys (12 months)</strong></li>
<li><strong>Design Approvals (12 months)</strong></li>
<li><strong>Permits (12 months)</strong></li>
<li><strong>Interconnection (12 months)</strong></li>
</ul>

<h2>Filters</h2>

<p>Multi-select filters with state persisted via the <code>usePreconstMetricsFilters</code> Zustand store. Locations, stage, and project owner can all be narrowed.</p>

<h2>Trend Lines</h2>

<p>Each KPI has a 12-month trend showing whether the metric is improving or eroding. Look for sustained drops or sudden cliffs as triggers for ops investigation.</p>
`;

const SALES_PIPELINE_EXEC = `
<h1>Sales Pipeline (Executive View)</h1>

<p>Active deals, funnel visualization, and proposal tracking — leadership view.</p>

<ul>
<li>URL: <code>/dashboards/sales</code></li>
<li>Subtitle: "Active Deals"</li>
<li>Accent: green</li>
<li>Visible from: Sales &amp; Marketing Suite (sales reps), Executive Suite (leadership)</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li>Deal funnel visualization (stage-by-stage)</li>
<li>Active deal table with proposal status</li>
<li>Per-rep performance metrics</li>
</ul>

<div class="info">For the deeper sales-rep workflow on this page, see the <a href="/sop?tab=sales-marketing-sop">Sales &amp; Marketing tab</a>.</div>
`;

const FORECAST_ACCURACY_EXEC = `
<h1>Forecast Accuracy (Executive Reference)</h1>

<p>How well the forecasting model predicts reality across milestones and segments. The same data also lives in the <a href="/sop?tab=forecast">Forecast tab</a> for ops use; this section captures the <em>executive lens</em>: trust signals on the underlying pipeline projections.</p>

<ul>
<li>URL: <code>/dashboards/forecast-accuracy</code></li>
<li>Subtitle: "How well the forecasting model predicts reality"</li>
</ul>

<h2>Hero stats (with subtitles)</h2>

<ul>
<li>Median Error <em>(Install milestone — original forecast)</em></li>
<li>Mean Absolute Error <em>(Average deviation from actual)</em></li>
<li>Within 1 Week <em>(Forecasts within 7 days)</em></li>
<li>Within 2 Weeks <em>(Forecasts within 14 days)</em></li>
</ul>

<h2>Reading it as an executive</h2>

<p>If the median error trend line is widening or the "within 14 days" % is dropping below 60%, the model is degrading and forecasts shouldn't be trusted for board commitments. Push ops to update underlying milestone targets and re-run.</p>
`;

const ESTIMATOR_PREVIEW = `
<h1>Customer Estimator (Preview)</h1>

<p>Public-facing instant solar estimator. The Executive Suite surfaces the customer-facing tool so leadership can preview what prospects see before quoting.</p>

<ul>
<li>Marketing site: <code>/estimator</code> with tiles for new install, EV Charger, System Expansion, Battery, Detach &amp; Reset, Out of Area</li>
<li>Direct entry: <code>/estimator/new-install?step=address</code> — drops into the address-first flow</li>
</ul>

<h2>Estimator Flows</h2>

<table>
<thead><tr><th>Flow</th><th>Path</th></tr></thead>
<tbody>
<tr><td>New Install (solar)</td><td><code>/estimator/new-install</code></td></tr>
<tr><td>Battery</td><td><code>/estimator/battery</code></td></tr>
<tr><td>EV Charger</td><td><code>/estimator/ev-charger</code></td></tr>
<tr><td>System Expansion</td><td><code>/estimator/system-expansion</code></td></tr>
<tr><td>Detach &amp; Reset</td><td><code>/estimator/detach-reset</code></td></tr>
<tr><td>Out of Area (declined)</td><td><code>/estimator/out-of-area</code></td></tr>
</tbody>
</table>

<h2>What customers see</h2>

<p>Address-first flow: enter an address, the estimator returns an instant estimate using EagleView measurements, OpenSolar pricing, and our adder rules. Results page collects contact info and creates a HubSpot lead.</p>

<div class="info">For Sales-side use of the estimator (creating quotes mid-call), see the <a href="/sop?tab=sales-marketing-sop">Sales &amp; Marketing tab</a>.</div>
`;

const SECTIONS = [
  { id: "exec-revenue", group: "Executive", title: "Revenue", color: "green", order: 0, content: REVENUE },
  { id: "exec-command-center", group: "Executive", title: "Command Center", color: "red", order: 1, content: COMMAND_CENTER },
  { id: "exec-capacity", group: "Executive", title: "Capacity Planning", color: "orange", order: 2, content: CAPACITY },
  { id: "exec-territory-map", group: "Executive", title: "Territory Map", color: "blue", order: 3, content: TERRITORY_MAP },
  { id: "exec-locations", group: "Executive", title: "Location Comparison", color: "blue", order: 4, content: LOCATIONS },
  { id: "exec-preconst-metrics", group: "Executive", title: "Preconstruction Metrics", color: "blue", order: 5, content: PRECONST_METRICS },
  { id: "exec-sales-pipeline", group: "Executive", title: "Sales Pipeline", color: "green", order: 6, content: SALES_PIPELINE_EXEC },
  { id: "exec-forecast-accuracy", group: "Executive", title: "Forecast Accuracy", color: "purple", order: 7, content: FORECAST_ACCURACY_EXEC },
  { id: "exec-estimator-preview", group: "Customer-Facing", title: "Customer Estimator (Preview)", color: "amber", order: 10, content: ESTIMATOR_PREVIEW },
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
