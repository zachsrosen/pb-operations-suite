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

const SECTIONS = [
  {
    id: "service-priority-queue",
    sidebarGroup: "Service Triage",
    title: "Priority Queue",
    dotColor: "red",
    sortOrder: 0,
    content: PRIORITY_QUEUE.trim(),
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
