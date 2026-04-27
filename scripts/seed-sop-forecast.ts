/**
 * Seed the Forecast SOP tab with sections for Timeline, Schedule, and Accuracy.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-forecast.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "forecast";
const TAB_LABEL = "Forecast";
const TAB_SORT = 11;

// ─── Sections ─────────────────────────────────────────────────────

const TIMELINE = `
<h1>Forecast Timeline</h1>

<p>Project-by-project view of forecasted PTO dates and milestone variance. Use this to spot projects at risk of slipping their PTO commitment.</p>

<ul>
<li>URL: <code>/dashboards/forecast-timeline</code></li>
<li>Visible to: all roles</li>
</ul>

<h2>What's on the Page</h2>

<p><strong>Hero stats (4 cards):</strong></p>
<ul>
<li>Active Projects (total)</li>
<li>On Track (variance ≤ 7 days)</li>
<li>At Risk (8–14 days)</li>
<li>Behind (&gt; 14 days)</li>
</ul>

<p><strong>Main table — six sortable columns:</strong></p>
<ol>
<li>Project name</li>
<li>Location</li>
<li>Stage</li>
<li>Next Milestone</li>
<li>Forecast PTO date</li>
<li>Variance (days)</li>
</ol>

<p>Variance color-codes: green (on track), amber (at risk), red (behind), gray (no forecast). Default sort: variance descending — biggest slips at the top.</p>

<h2>Expand a Row</h2>

<p>Click any row to reveal the milestone forecast detail:</p>
<ul>
<li>Milestone name</li>
<li><strong>Basis</strong> — segment / location / global / actual (the data the forecast was built on)</li>
<li>Original Forecast vs Live Forecast</li>
<li>Actual date (when reached)</li>
<li>Calculated variance</li>
</ul>

<div class="info">A <em>segment</em> basis means the forecast uses historical data from the same location + AHJ + utility combo. <em>Global</em> means the system fell back to portfolio-wide averages because there wasn't enough segment-specific history.</div>

<h2>Filters</h2>

<p>Multi-select dropdowns: Location, Stage, PTO Month, Variance status. The hero stats recalculate live as you filter.</p>

<h2>Export</h2>
<p>CSV export includes Project, Customer, Location, Stage, Next Milestone, and all date fields.</p>

<h2>Cache</h2>
<ul>
<li>Stale time: 5 minutes</li>
<li>Cache time: 15 minutes</li>
</ul>
`;

const SCHEDULE = `
<h1>Forecast Schedule</h1>

<p>Calendar grid showing pre-construction projects (survey, RTB, blocked, design, permitting) plotted against their <strong>forecasted</strong> install dates.</p>

<ul>
<li>URL: <code>/dashboards/forecast-schedule</code></li>
<li>Visible to: all roles</li>
</ul>

<h2>What's on the Page</h2>

<p><strong>Calendar grid:</strong> one month at a time. Navigation buttons for prev/next month and a "Today" jump button.</p>

<p><strong>Filter buttons (multi-select):</strong></p>
<ul>
<li><strong>Stage:</strong> survey, RTB, blocked, design, permitting</li>
<li><strong>Location:</strong> any combination of the five locations</li>
</ul>

<p><strong>Event pills</strong> on each day:</p>
<ul>
<li>Customer name</li>
<li>Dashed amber border = forecast date is in the past (overdue)</li>
<li>Solid blue = future date</li>
</ul>

<h2>Sidebar (visible on wide screens)</h2>

<ul>
<li><strong>Pipeline Breakdown:</strong> stage distribution counts and revenue</li>
<li><strong>Location Distribution:</strong> sorted by revenue</li>
<li><strong>Overdue Forecasts</strong> callout</li>
</ul>

<p>Revenue is shown in compact notation (e.g., 1.2M, 250K).</p>

<h2>Forecast Ghosts</h2>

<div class="info">Pre-construction projects without a real scheduled date appear as <em>"ghost" events</em> on their forecast date. Once a real installation date is set, the ghost disappears.</div>

<h2>Cache</h2>
<ul>
<li>Stale time: 5 minutes</li>
<li>Cache time: 15 minutes</li>
</ul>
`;

const ACCURACY = `
<h1>Forecast Accuracy</h1>

<p>Backward-looking review of how good our forecasts have been. Useful for spotting milestones where the model is consistently off so we can recalibrate.</p>

<ul>
<li>URL: <code>/dashboards/forecast-accuracy</code></li>
<li>Visible to: all roles</li>
</ul>

<h2>Hero Stats (2×2 grid)</h2>
<ul>
<li>Median Error (days)</li>
<li>Mean Absolute Error (days)</li>
<li>Within 1 Week (%)</li>
<li>Within 2 Weeks (%)</li>
</ul>

<h2>Per-Milestone Accuracy</h2>

<p>Sortable table showing every milestone with:</p>
<ul>
<li>Median error bar (color-coded by magnitude)</li>
<li>±7 day accuracy %</li>
<li>±14 day accuracy % with letter grade A–F</li>
<li>Sample count</li>
</ul>

<h3>Grade Scale</h3>
<table>
<thead><tr><th>Grade</th><th>Within 14 days</th></tr></thead>
<tbody>
<tr><td>A</td><td>≥ 80%</td></tr>
<tr><td>B</td><td>≥ 60%</td></tr>
<tr><td>C</td><td>≥ 40%</td></tr>
<tr><td>D</td><td>≥ 20%</td></tr>
<tr><td>F</td><td>&lt; 20%</td></tr>
</tbody>
</table>

<h2>Basis Distribution</h2>

<p>Stacked horizontal bars showing what percentage of forecasts used each basis: actual, segment, location, global, insufficient.</p>

<div class="info">A high "global" or "insufficient" share means we don't have enough history for that combo of location/AHJ/utility — forecasts in that bucket will be less reliable.</div>

<h2>Monthly Trend</h2>

<p>Bar chart of mean absolute error for the last 12 months, color-coded by accuracy threshold. Useful for seeing whether forecasts are getting better or worse over time.</p>

<h2>Cache</h2>
<ul>
<li>Stale time: 10 minutes</li>
<li>Cache time: 30 minutes</li>
</ul>

<p>Data scope: completed projects with actual dates in the last 12 months.</p>
`;

const SECTIONS = [
  {
    id: "fc-timeline",
    sidebarGroup: "Forecasting",
    title: "Timeline",
    dotColor: "blue",
    sortOrder: 0,
    content: TIMELINE.trim(),
  },
  {
    id: "fc-schedule",
    sidebarGroup: "Forecasting",
    title: "Schedule",
    dotColor: "purple",
    sortOrder: 1,
    content: SCHEDULE.trim(),
  },
  {
    id: "fc-accuracy",
    sidebarGroup: "Forecasting",
    title: "Accuracy",
    dotColor: "green",
    sortOrder: 2,
    content: ACCURACY.trim(),
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
