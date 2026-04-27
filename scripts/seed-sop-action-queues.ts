/**
 * Seed the Action Queues SOP tab.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-action-queues.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "queues";
const TAB_LABEL = "Action Queues";
const TAB_SORT = 15;

// ─── Sections ─────────────────────────────────────────────────────

const OVERVIEW = `
<h1>Action Queues Overview</h1>

<p>Action queues are role-specific dashboards that show <em>what needs attention right now</em>. Each queue filters the project pipeline to items where someone needs to take an action, sorted by urgency.</p>

<h2>The Queues</h2>

<table>
<thead><tr><th>Queue</th><th>Owner</th><th>URL</th></tr></thead>
<tbody>
<tr><td><strong>Plan Review Queue</strong></td><td>Design / TechOps</td><td><code>/dashboards/plan-review</code></td></tr>
<tr><td><strong>Design Approval Queue</strong></td><td>Design / TechOps</td><td><code>/dashboards/pending-approval</code></td></tr>
<tr><td><strong>Design Revisions</strong></td><td>Design / TechOps</td><td><code>/dashboards/design-revisions</code></td></tr>
<tr><td><strong>Permit Action Queue</strong></td><td>Permit team</td><td><code>/dashboards/pi-permit-action-queue</code></td></tr>
<tr><td><strong>IC &amp; PTO Action Queue</strong></td><td>IC team</td><td><code>/dashboards/pi-ic-action-queue</code></td></tr>
<tr><td><strong>Permit Revisions</strong></td><td>Permit team</td><td><code>/dashboards/pi-permit-revisions</code></td></tr>
<tr><td><strong>IC Revisions</strong></td><td>IC team</td><td><code>/dashboards/pi-ic-revisions</code></td></tr>
</tbody>
</table>

<h2>Common Patterns</h2>

<p>Every action queue shares the same conventions:</p>
<ul>
<li><strong>Sortable columns</strong> — click a header to sort. Default sort is days-in-stage / days-in-status descending</li>
<li><strong>Search</strong> — case-insensitive substring match across project name, customer, location, lead, and stage</li>
<li><strong>Multi-select filters</strong> — Location, Lead, Stage. Filter state persists in a Zustand store across sessions</li>
<li><strong>CSV export</strong> — every queue exposes Export via the DashboardShell header</li>
<li><strong>Days-in-status color coding</strong> — yellow at 14d, red at 21d (where applicable)</li>
</ul>

<h2>Workflow Tips</h2>

<ol>
<li>Filter by your location and your name (Lead column)</li>
<li>Sort by days-in-status descending — oldest first</li>
<li>Work the top of the list, marking action taken in HubSpot directly</li>
<li>The queue refreshes via SSE within seconds of a HubSpot update</li>
</ol>
`;

const PLAN_REVIEW = `
<h1>Plan Review Queue</h1>

<p>Projects that are in <strong>initial design review</strong> or <strong>final design review</strong> with a designer or engineer. Use this to prioritize whose plans you tackle next.</p>

<ul>
<li>URL: <code>/dashboards/plan-review</code></li>
<li>Visible from: D&amp;E Suite</li>
</ul>

<h2>Statuses Included</h2>

<p>Three HubSpot status values qualify a project for this queue (status names are HubSpot internal names, not display labels):</p>

<ul>
<li><strong>Initial Review</strong> — display label "Ready For Review" — initial design review</li>
<li><strong>DA Approved</strong> — final design review</li>
<li><strong>Submitted To Engineering</strong> — currently with engineering</li>
</ul>

<h2>Columns</h2>

<table>
<thead><tr><th>Column</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Project name</td><td>Linked to HubSpot</td></tr>
<tr><td>Owner</td><td>Sortable</td></tr>
<tr><td>Review Type</td><td>Sortable; "Initial" / "Final" / "Engineering"</td></tr>
<tr><td>Days Waiting</td><td>Sortable; default sort descending</td></tr>
<tr><td>DC/AC Ratio</td><td>Sortable</td></tr>
<tr><td>AHJ</td><td>Sortable</td></tr>
<tr><td>Location</td><td>Sortable</td></tr>
<tr><td>Stage</td><td>Sortable</td></tr>
<tr><td>Design Draft Date</td><td>Sortable</td></tr>
<tr><td>DA Date</td><td>Sortable</td></tr>
<tr><td>Amount</td><td>Sortable</td></tr>
</tbody>
</table>

<h2>System Performance Review Toggle</h2>

<p>Every row has a toggle for "system performance review" — flipping it sends a PATCH to <code>/api/projects/[id]</code> updating the <code>system_performance_review</code> property in HubSpot. Useful when a designer flags a project for additional perf review during the plan check.</p>

<h2>Filters</h2>

<ul>
<li>Search bar (project name, customer, location, AHJ, owner)</li>
<li>Review Type multi-select</li>
<li>Filter state persisted via the <code>usePlanReviewFilters</code> Zustand store</li>
</ul>
`;

const DESIGN_APPROVAL = `
<h1>Design Approval Queue</h1>

<p>Three-section action queue for the Design Approval workflow: surveys done that need design started, designs ready that need to go to the customer, and DAs sent that are awaiting customer signature.</p>

<ul>
<li>URL: <code>/dashboards/pending-approval</code></li>
<li>Visible from: D&amp;E Suite</li>
<li>CSV export filename: <code>design-approval-queue.csv</code></li>
</ul>

<h2>Three Sections (top to bottom)</h2>

<ol>
<li><strong>Survey Done — Needs Design</strong> — site survey complete, designer needs to start the design</li>
<li><strong>Design Ready — Send to Customer</strong> — design finished, ready to package and send the DA</li>
<li><strong>DA Sent — Awaiting Customer</strong> — DA delivered, waiting for customer signature</li>
</ol>

<p>Each section is independently filterable and sortable. Stages excluded from the queue (e.g., "Closed Lost", "On Hold") are removed up-front via the <code>EXCLUDED_STAGES</code> filter.</p>

<h2>Filters</h2>
<ul>
<li>Search across project name, customer, location, owner</li>
<li>Multi-select: Locations, Stages</li>
<li>Persisted via <code>usePendingApprovalFilters</code></li>
</ul>

<h2>Workflow</h2>

<ol>
<li>Start with section 1 (Survey Done — Needs Design) — these are the oldest items in the funnel</li>
<li>Pull the project, do the design, advance to section 2</li>
<li>Section 2 — package the DA, send to customer</li>
<li>Section 3 — call/email customers who haven't signed (sort by days-in-stage descending)</li>
</ol>
`;

const DESIGN_REVISIONS = `
<h1>Design Revisions</h1>

<p>Projects currently in a revision cycle — rejected by AHJ, customer, or QC and back with a designer for fixes.</p>

<ul>
<li>URL: <code>/dashboards/design-revisions</code></li>
<li>Visible from: D&amp;E Suite</li>
<li>CSV export filename: <code>design-revisions.csv</code></li>
</ul>

<h2>Inclusion Rule</h2>

<p>The queue includes any project where <code>designStatus</code> matches a known revision status (handled by <code>isDesignRevisionStatus()</code>). Projects with no revision status set are excluded.</p>

<h2>Columns &amp; Sort</h2>

<ul>
<li>Default sort field: <strong>daysInRevision</strong>, descending — longest stuck at the top</li>
<li>All standard project columns sortable</li>
<li>Rejection reason and revision count surfaced when present</li>
</ul>

<h2>Filters</h2>

<ul>
<li>Search across project name, owner, location, stage</li>
<li>Multi-select: Locations, Stages</li>
<li>Persisted via <code>useDesignRevisionsFilters</code></li>
</ul>

<h2>Workflow</h2>

<ol>
<li>Sort by daysInRevision desc — focus on the longest-stuck</li>
<li>Open the project, read the rejection reason</li>
<li>Make the revision in OpenSolar / planset</li>
<li>Re-submit and update the design status in HubSpot — the project drops out of this queue</li>
</ol>
`;

const PERMIT_ACTION = `
<h1>Permit Action Queue</h1>

<p>Permit-only items needing action: ready-to-submit, ready-to-resubmit, and stale (no movement in 14+ days).</p>

<ul>
<li>URL: <code>/dashboards/pi-permit-action-queue</code></li>
<li>Visible from: P&amp;I Suite</li>
<li>CSV export filename: <code>pi-permit-action-queue.csv</code></li>
</ul>

<h2>Default Sort</h2>

<p>Sort field: <code>daysInStatus</code> descending — projects sitting longest in their current permit status appear first.</p>

<h2>Filters</h2>

<ul>
<li>Search bar — project name, address, AHJ, lead</li>
<li>Multi-select: Locations, Permit Lead, Stage</li>
<li>Persisted via <code>usePIPermitActionQueueFilters</code></li>
</ul>

<h2>Action</h2>

<p>For deeper per-project work, click into the project from this queue and take action via the <a href="/sop?tab=tools">Permit Hub</a> — the queue is the "what to work on" view; the Permit Hub is the "do the work" view.</p>
`;

const IC_ACTION = `
<h1>IC &amp; PTO Action Queue</h1>

<p>Interconnection and PTO action items in one place. Sort by status urgency, filter by action type.</p>

<ul>
<li>URL: <code>/dashboards/pi-ic-action-queue</code></li>
<li>Visible from: P&amp;I Suite</li>
<li>CSV export filename: <code>pi-ic-action-queue.csv</code></li>
</ul>

<h2>Action Type Filter</h2>

<p>This queue has an extra single-select <strong>action type</strong> filter beyond the standard multi-selects:</p>
<ul>
<li><code>all</code> — show everything</li>
<li>Specific action types (e.g., submit, resubmit, follow up) — narrow the view</li>
</ul>

<h2>Default Sort</h2>

<p>Sort field: <code>daysInStatus</code> descending.</p>

<h2>Filters</h2>

<ul>
<li>Search across project, customer, utility, lead</li>
<li>Multi-select: Locations, IC Lead, Stage</li>
<li>Persisted via <code>usePIICActionQueueFilters</code></li>
</ul>

<h2>Action</h2>

<p>Click into a project to take action via the <a href="/sop?tab=tools">IC Hub</a>.</p>
`;

const PERMIT_REVISIONS = `
<h1>Permit Revisions</h1>

<p>Permit revision queue — projects that have been rejected by an AHJ and are either ready to resubmit or already resubmitted and awaiting decision.</p>

<ul>
<li>URL: <code>/dashboards/pi-permit-revisions</code></li>
<li>Visible from: P&amp;I Suite</li>
<li>CSV export filename: <code>pi-permit-revisions.csv</code></li>
</ul>

<h2>Sort &amp; Filters</h2>

<ul>
<li>Default sort: <code>days</code> descending (days since rejection / days since resubmission)</li>
<li>Search across project name, customer, AHJ, lead</li>
<li>Multi-select: Locations, Permit Lead, Stage</li>
<li>Persisted via <code>usePIPermitRevisionsFilters</code></li>
</ul>

<h2>Workflow</h2>

<ol>
<li>Sort by days desc — longest-rejected at the top</li>
<li>Open the project; read the AHJ rejection reasoning in the Permit Hub's Correspondence tab</li>
<li>Make the planset revision and re-submit via the Permit Hub's "Resubmit to AHJ" form</li>
</ol>
`;

const IC_REVISIONS = `
<h1>IC Revisions</h1>

<p>Interconnection revision queue — projects rejected by a utility and either ready to resubmit or already resubmitted.</p>

<ul>
<li>URL: <code>/dashboards/pi-ic-revisions</code></li>
<li>Visible from: P&amp;I Suite</li>
<li>CSV export filename: <code>pi-ic-revisions.csv</code></li>
</ul>

<h2>Sort &amp; Filters</h2>

<ul>
<li>Default sort: <code>days</code> descending</li>
<li>Search across project name, customer, utility, lead</li>
<li>Multi-select: Locations, IC Lead, Stage</li>
<li>Persisted via <code>usePIICRevisionsFilters</code></li>
</ul>

<h2>Workflow</h2>

<p>Same pattern as Permit Revisions, but for utilities. Use the <a href="/sop?tab=tools">IC Hub</a>'s "Resubmit to Utility" or "Provide Information" forms to take action.</p>
`;

const SECTIONS = [
  { id: "queues-overview", group: "Action Queues", title: "Overview", color: "blue", order: 0, content: OVERVIEW },
  { id: "queues-plan-review", group: "Design & Engineering", title: "Plan Review", color: "cyan", order: 1, content: PLAN_REVIEW },
  { id: "queues-design-approval", group: "Design & Engineering", title: "Design Approval", color: "cyan", order: 2, content: DESIGN_APPROVAL },
  { id: "queues-design-revisions", group: "Design & Engineering", title: "Design Revisions", color: "cyan", order: 3, content: DESIGN_REVISIONS },
  { id: "queues-permit-action", group: "Permitting & Interconnection", title: "Permit Action Queue", color: "orange", order: 4, content: PERMIT_ACTION },
  { id: "queues-ic-action", group: "Permitting & Interconnection", title: "IC & PTO Action Queue", color: "purple", order: 5, content: IC_ACTION },
  { id: "queues-permit-revisions", group: "Permitting & Interconnection", title: "Permit Revisions", color: "amber", order: 6, content: PERMIT_REVISIONS },
  { id: "queues-ic-revisions", group: "Permitting & Interconnection", title: "IC Revisions", color: "amber", order: 7, content: IC_REVISIONS },
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
