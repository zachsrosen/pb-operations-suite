/**
 * Seed the Trackers SOP tab with sections for AHJ Tracker and Utility Tracker.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-trackers.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "trackers";
const TAB_LABEL = "AHJ & Utility";
const TAB_SORT = 12;

const AHJ = `
<h1>AHJ Tracker</h1>

<p>Per-AHJ (Authority Having Jurisdiction) view of permit volume, rejection rates, and turnaround. Use this to identify slow AHJs, recurring rejection patterns, and where to push permitting effort.</p>

<ul>
<li>URL: <code>/dashboards/ahj-tracker</code></li>
<li>Visible to: all roles</li>
</ul>

<h2>Hero Stats</h2>
<ul>
<li>AHJs with Deals (count)</li>
<li>Active Permits (total)</li>
<li>Overall Rejection Rate (%)</li>
<li>Avg Permit Turnaround (days)</li>
</ul>

<h2>Main Table</h2>

<table>
<thead><tr><th>Column</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>AHJ</td><td>Name + city/state</td></tr>
<tr><td>Deals</td><td>Sortable; default sort descending</td></tr>
<tr><td>Active Permits</td><td>Open permits in this AHJ</td></tr>
<tr><td>In Revision</td><td>Permits currently being revised</td></tr>
<tr><td>Rejection Rate %</td><td>Red &gt; 30%, yellow &gt; 15%</td></tr>
<tr><td>Avg Turnaround (days)</td><td>Red &gt; 45d, yellow &gt; 30d</td></tr>
<tr><td>Revenue</td><td>Sortable; total project value in this AHJ</td></tr>
</tbody>
</table>

<p><strong>Rejection rate formula:</strong> <code>permit_rejections / (permit_issued + permit_rejections) × 100</code></p>

<h2>Drill-Down</h2>

<p>Click any AHJ row to expand and see its individual projects:</p>
<ul>
<li>Project name (linked to HubSpot)</li>
<li>Stage</li>
<li>Permit Status</li>
<li>Permit Lead</li>
<li>Days in Stage (red &gt; 21d, yellow &gt; 14d)</li>
<li>Amount</li>
</ul>

<p>Drill-down rows are independently sortable.</p>

<h2>Filters &amp; Search</h2>
<ul>
<li>Multi-select filters: Location, Permit Lead, Stage</li>
<li>Search bar matches project name, AHJ name, stage, location, or permit lead (case-insensitive)</li>
<li>Filter state persists in a Zustand store across sessions</li>
</ul>

<h2>Export</h2>
<p>CSV export includes rejection/approval counts and revenue for audit trail.</p>

<h2>Data Source</h2>
<p>Merges HubSpot project data (stage, lead, deal amount) with the custom AHJ HubSpot object (location, rejection rate, turnaround time). Projects are matched to the AHJ object by case-insensitive name comparison on the <code>projects.ahj</code> field.</p>

<div class="info">Turnaround is stored in milliseconds in the database and converted to days for display (rounded).</div>
`;

const UTILITY = `
<h1>Utility Tracker</h1>

<p>Per-utility view of interconnection (IC) application throughput and PTO timing. Identify bottleneck utilities and prioritize follow-up.</p>

<ul>
<li>URL: <code>/dashboards/utility-tracker</code></li>
<li>Visible to: all roles</li>
</ul>

<h2>Hero Stats</h2>
<ul>
<li>Utilities with Deals (count)</li>
<li>Active IC Apps</li>
<li>PTO Pipeline (count)</li>
<li>Avg IC Turnaround (days)</li>
</ul>

<h2>Main Table</h2>

<table>
<thead><tr><th>Column</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Utility</td><td>Name + state · service area</td></tr>
<tr><td>Deals</td><td>Sortable; default sort descending</td></tr>
<tr><td>Active IC</td><td>Sortable</td></tr>
<tr><td>PTO Pipeline</td><td>Sortable</td></tr>
<tr><td>IC Turnaround (days)</td><td>Red &gt; 60d, yellow &gt; 45d</td></tr>
<tr><td>Rejections</td><td>Red if &gt; 5</td></tr>
<tr><td>Revenue</td><td>Sortable</td></tr>
</tbody>
</table>

<h2>Bottleneck Detection</h2>

<div class="warn">Utilities with above-average IC turnaround display a red <strong>"Slow"</strong> badge and a tinted row. The threshold is dynamic — it's the dashboard average, not a fixed number. So a utility flagged as slow today might not be flagged tomorrow if the overall average shifts.</div>

<h2>Drill-Down</h2>

<p>Click any utility row to expand and see its projects:</p>
<ul>
<li>Project name (linked to HubSpot)</li>
<li>Stage</li>
<li>IC Status</li>
<li>PTO Status</li>
<li>IC Lead</li>
<li>Days in Stage (red &gt; 21d, yellow &gt; 14d)</li>
<li>Amount</li>
</ul>

<h2>Filters &amp; Search</h2>
<ul>
<li>Multi-select filters: Location, IC Lead, Stage</li>
<li>Search bar matches utility name, project name, stage, location, or IC lead (case-insensitive)</li>
<li>Filter state persists in a Zustand store</li>
</ul>

<h2>Data Source</h2>

<p>Merges HubSpot project data with the custom Utility HubSpot object. Projects match utility by case-insensitive name comparison against either <code>record_name</code> or <code>utility_company_name</code>.</p>

<div class="info">Like AHJ turnaround, IC turnaround is stored in ms and displayed in days.</div>
`;

const SECTIONS = [
  {
    id: "trk-ahj",
    sidebarGroup: "Trackers",
    title: "AHJ Tracker",
    dotColor: "amber",
    sortOrder: 0,
    content: AHJ.trim(),
  },
  {
    id: "trk-utility",
    sidebarGroup: "Trackers",
    title: "Utility Tracker",
    dotColor: "cyan",
    sortOrder: 1,
    content: UTILITY.trim(),
  },
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
          sidebarGroup: section.sidebarGroup,
          title: section.title,
          dotColor: section.dotColor,
          sortOrder: section.sortOrder,
          content: section.content,
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
        sidebarGroup: section.sidebarGroup,
        title: section.title,
        dotColor: section.dotColor,
        sortOrder: section.sortOrder,
        content: section.content,
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
