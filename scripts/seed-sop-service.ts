/**
 * Seed the Service SOP tab and its initial sections.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-service.ts
 *
 * Idempotent: skips existing sections. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "service";
const TAB_LABEL = "Service";
const TAB_SORT = 9;

// ─── Sections ─────────────────────────────────────────────────────

const PRIORITY_QUEUE = `
<h1>Service Priority Queue</h1>

<p>The priority queue ranks open service deals and tickets so you know what to work on first. Every item gets a score from 0 to 100 and lands in one of four tiers based on warranty risk, contact recency, time stuck in stage, and dollar value.</p>

<h2>Tiers</h2>

<table>
<thead><tr><th>Tier</th><th>Score</th><th>What it means</th></tr></thead>
<tbody>
<tr><td><strong>Critical</strong></td><td>75–100</td><td>Drop everything else — warranty about to expire, customer hasn't been contacted in over a week, or stuck in a stage well past expected duration</td></tr>
<tr><td><strong>High</strong></td><td>50–74</td><td>Work today — multiple risk factors compounding</td></tr>
<tr><td><strong>Medium</strong></td><td>25–49</td><td>This week — at least one factor flagged but not urgent</td></tr>
<tr><td><strong>Low</strong></td><td>0–24</td><td>On track — no flags, regular cadence</td></tr>
</tbody>
</table>

<hr>

<h2>What Drives the Score</h2>

<p>Five factors combine into the final score (capped at 100):</p>

<h3>1. Warranty Expiry — up to 40 points</h3>
<table>
<thead><tr><th>Condition</th><th>Points</th><th>Reason shown</th></tr></thead>
<tbody>
<tr><td>Warranty already expired</td><td>+30</td><td>"Warranty expired"</td></tr>
<tr><td>Expires within 7 days</td><td>+40</td><td>"Warranty expires in N days"</td></tr>
<tr><td>Expires within 30 days</td><td>+15</td><td>"Warranty expires in N days"</td></tr>
</tbody>
</table>

<h3>2. Last Contact Recency — up to 35 points</h3>
<table>
<thead><tr><th>Condition</th><th>Points</th><th>Reason shown</th></tr></thead>
<tbody>
<tr><td>No contact in 7+ days</td><td>+35</td><td>"No contact in N days"</td></tr>
<tr><td>Last contact 3–6 days ago</td><td>+25</td><td>"Last contact N days ago"</td></tr>
<tr><td>Last contact 1–2 days ago</td><td>+5</td><td>(no visible reason)</td></tr>
</tbody>
</table>

<h3>3. Stage Duration (Stuck) — up to 20 points</h3>
<table>
<thead><tr><th>Condition</th><th>Points</th><th>Reason shown</th></tr></thead>
<tbody>
<tr><td>In current stage 7+ days</td><td>+20</td><td>"Stuck in 'Stage' for N days"</td></tr>
<tr><td>In current stage 3–6 days</td><td>+10</td><td>"In 'Stage' for N days"</td></tr>
</tbody>
</table>

<h3>4. Deal Value — up to 10 points</h3>
<table>
<thead><tr><th>Condition</th><th>Points</th></tr></thead>
<tbody>
<tr><td>Amount &gt; $10,000</td><td>+10 ("High-value service")</td></tr>
<tr><td>Amount &gt; $5,000</td><td>+5</td></tr>
</tbody>
</table>

<h3>5. Stage-Specific Urgency — up to 15 points</h3>
<ul>
<li><strong>Inspection</strong> or <strong>Invoicing</strong> stage: +5 (these stages should not be lingering)</li>
<li><strong>Site Visit Scheduling</strong> or <strong>Work In Progress</strong> stage AND modified 5+ days ago: +10 (active stages going stale)</li>
</ul>

<div class="info">Reasons shown on each card explain <em>why</em> something landed in its tier — useful when deciding which Critical to grab first.</div>

<hr>

<h2>Manual Overrides</h2>

<p>Sometimes the algorithm misses context — a known VIP customer, a verbal commitment to call by EOD, or a deal you want pinned. Use a manual override to lock a tier.</p>

<ul>
<li>Override priorities translate to fixed scores: <code>critical → 90</code>, <code>high → 65</code>, <code>medium → 35</code>, <code>low → 10</code></li>
<li>Overridden items show a "Manually set to <em>tier</em>" reason at the top of their reason list</li>
<li>Overrides persist in the <code>ServicePriorityOverride</code> table — they survive page refreshes and queue rebuilds</li>
</ul>

<hr>

<h2>Refresh Behavior</h2>

<p>The queue listens for upstream changes via Server-Sent Events:</p>
<ul>
<li>Cache key: <code>service:priority-queue</code></li>
<li>Cascades from upstream: <code>deals:service*</code> and <code>service-tickets*</code> invalidations</li>
<li>500 ms debounce prevents thundering herd when multiple upstreams fire</li>
</ul>

<p>You shouldn't need to manually refresh — when a deal or ticket changes upstream, the queue rebuilds within a second.</p>

<hr>

<h2>Common Workflow</h2>

<ol>
<li>Start your day on the priority queue — work top-to-bottom through Critical, then High</li>
<li>Open the deal or ticket in HubSpot via the link on the card</li>
<li>Take the action the reason calls out (call the customer, advance the stage, finish inspection, etc.)</li>
<li>If a card looks wrong (wrong tier given context only you know), apply a manual override with a brief note</li>
<li>If a stage is genuinely stuck for a structural reason (waiting on AHJ, parts ordered), use the manual override to push it down so it stops dominating the top of the queue</li>
</ol>
`;

const TICKET_BOARD = `
<h1>Ticket Board (Kanban)</h1>

<p>Kanban view of every open HubSpot service ticket grouped by stage. Filter, reassign, change status, or add notes from one place — no need to bounce in and out of HubSpot.</p>

<ul>
<li>URL: <code>/dashboards/service-tickets</code></li>
<li>Visible to: Service team and Operations roles (per Service Suite gating)</li>
</ul>

<h2>Layout</h2>

<p>Columns are HubSpot service-pipeline stages, displayed in stage order. Each card shows the ticket title, customer, location, age (e.g., "3 days ago"), and a priority badge.</p>

<h3>Priority Badges</h3>

<table>
<thead><tr><th>Badge</th><th>Color</th></tr></thead>
<tbody>
<tr><td>High</td><td>Red</td></tr>
<tr><td>Medium</td><td>Yellow</td></tr>
<tr><td>Low</td><td>Green</td></tr>
<tr><td>None</td><td>Gray</td></tr>
</tbody>
</table>

<p>The priority comes directly from the HubSpot ticket's priority field — same dropdown values you'd see on the ticket in HubSpot.</p>

<h2>Filters</h2>

<p>Multi-select dropdowns for:</p>
<ul>
<li>Location</li>
<li>Stage (limits which columns show)</li>
<li>Priority</li>
<li>Owner (includes "Unassigned")</li>
</ul>

<p>Plus a search bar that filters by ticket subject. Filters are client-side — no roundtrip on every change.</p>

<h2>Real-time Updates</h2>

<p>The board listens for SSE events with cache key filter <code>service-tickets</code> — when an upstream change fires (someone updates the ticket in HubSpot, or another user takes action here), the board refetches automatically.</p>

<h2>Click a Card → Detail Drawer</h2>

<p>Opens <code>/api/service/tickets/[id]</code> and shows:</p>
<ul>
<li>Subject + content (the original ticket body)</li>
<li>Priority, stage, pipeline</li>
<li>Create date, last modified, last contact date</li>
<li>Owner</li>
<li><strong>Associations</strong> — linked contacts, deals (with amount + service type), companies</li>
<li><strong>Timeline</strong> — notes, emails, calls, meetings, tasks (chronological from HubSpot)</li>
</ul>

<h2>Actions From the Detail Drawer</h2>

<table>
<thead><tr><th>Action</th><th>What it does</th><th>Endpoint</th></tr></thead>
<tbody>
<tr><td><strong>Change Stage</strong></td><td>Move the ticket to a different stage in the service pipeline</td><td><code>PATCH /api/service/tickets/[id]</code> with <code>{stageId}</code></td></tr>
<tr><td><strong>Add Note</strong></td><td>Append a HubSpot note to the ticket</td><td><code>PATCH .../tickets/[id]</code> with <code>{note}</code></td></tr>
<tr><td><strong>Assign</strong></td><td>Set the HubSpot owner</td><td><code>PATCH .../tickets/[id]</code> with <code>{ownerId}</code></td></tr>
</tbody>
</table>

<p>Each action writes through to HubSpot directly. The board refetches and reopens the detail after the action completes.</p>

<div class="info">There is no "close ticket" button — closing happens by moving the ticket to the Closed stage. This matches the HubSpot service pipeline convention.</div>
`;

const CUSTOMER_HISTORY = `
<h1>Customer History (Customer 360)</h1>

<p>Search across all of HubSpot for a customer and see <strong>everything</strong> we have: deals, tickets, and Zuper field service jobs in one view. Use this when a customer calls and you need to figure out what's been done for them.</p>

<ul>
<li>URL: <code>/dashboards/service-customers</code></li>
<li>Visible to: Service team and Operations roles</li>
</ul>

<h2>Searching</h2>

<p>One search box accepts any of:</p>
<ul>
<li><strong>Name</strong> (first, last, or full)</li>
<li><strong>Email</strong></li>
<li><strong>Phone</strong></li>
<li><strong>Address</strong> (street or city)</li>
</ul>

<p>The search hits HubSpot contacts and companies. Results are deduplicated and capped at <strong>25</strong>. If you have more than 25 matches, the response includes a <code>truncated: true</code> flag and you should narrow your search.</p>

<h2>Result Card</h2>

<p>Each match shows:</p>
<ul>
<li>Customer name + primary email/phone</li>
<li>Address (linked to the Property drawer when the property views feature flag is on)</li>
<li>Counts: # deals, # open tickets, # Zuper jobs</li>
</ul>

<p>Click into a match to load the full detail panel.</p>

<h2>Detail Panel</h2>

<p>Three sections, each showing only items associated with this customer:</p>

<h3>Deals</h3>
<ul>
<li>Project name, stage, amount</li>
<li>Service type (when present)</li>
<li>Days in stage</li>
<li>Last contact date</li>
<li>Line items (name, qty, category, unit price)</li>
<li>Direct link to the HubSpot deal</li>
</ul>

<h3>Tickets</h3>
<ul>
<li>Subject, stage, priority</li>
<li>Service type</li>
<li>Days in stage</li>
<li>Direct link to HubSpot ticket</li>
</ul>

<h3>Jobs (Zuper)</h3>
<ul>
<li>Job name, category, current job status</li>
<li>Assigned users</li>
<li>Scheduled and completed dates</li>
<li>Direct link to the Zuper job</li>
</ul>

<h2>How Zuper Jobs Get Resolved</h2>

<p>Zuper doesn't share contact IDs with HubSpot, so the resolver tries two strategies:</p>

<ol>
<li><strong>Deal-linked cache</strong> — if any of the customer's HubSpot deals has a Zuper job linked via the <code>ZuperJobCache</code> table, those jobs surface immediately.</li>
<li><strong>Name + address heuristic</strong> — for jobs not linked to a deal, the resolver matches Zuper customer name and address against the HubSpot contact's name and address. Looser matches (typos, missing apartment number, etc.) may fail.</li>
</ol>

<div class="info">If a known Zuper job isn't showing up, it's almost always because the deal-linked cache hasn't been populated yet. An admin can trigger a re-link via the deal detail panel.</div>

<h2>Property Drawer Integration</h2>

<p>When the <code>NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED</code> flag is on, addresses in the customer detail are clickable — they open the Property drawer with equipment summary, owners, deals, tickets, and a unified property record.</p>

<h2>Common Use Cases</h2>

<ul>
<li><strong>Customer calls about a problem</strong> — search by phone or name, find their open ticket, see the timeline of what we've done</li>
<li><strong>Repeat-customer lookup</strong> — see if a customer had previous service work, what equipment was installed, who the assigned crew was</li>
<li><strong>Address dispute</strong> — verify what address we have on file vs what the customer is claiming</li>
<li><strong>Pre-call prep</strong> — before calling a customer, pull up their full history so you walk in knowing the full picture</li>
</ul>
`;

const SECTIONS = [
  {
    id: "service-priority-queue",
    sidebarGroup: "Service Triage",
    title: "Priority Queue",
    dotColor: "red",
    sortOrder: 0,
    content: PRIORITY_QUEUE.trim(),
  },
  {
    id: "service-ticket-board",
    sidebarGroup: "Service Triage",
    title: "Ticket Board",
    dotColor: "purple",
    sortOrder: 1,
    content: TICKET_BOARD.trim(),
  },
  {
    id: "service-customer-history",
    sidebarGroup: "Service Triage",
    title: "Customer History",
    dotColor: "cyan",
    sortOrder: 2,
    content: CUSTOMER_HISTORY.trim(),
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
