/**
 * Seed the Sales & Marketing SOP tab.
 *
 * Tab is gated to SALES / SALES_MANAGER / MARKETING (plus admin bypass) via
 * TAB_ROLE_GATES in src/lib/sop-access.ts.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-sales-marketing.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "sales-marketing-sop";
const TAB_LABEL = "Sales & Marketing";
const TAB_SORT = 18;

const SALES_PIPELINE = `
<h1>Sales Pipeline</h1>

<p>Active deals, funnel visualization, and proposal tracking — the sales rep's daily workspace.</p>

<ul>
<li>URL: <code>/dashboards/sales</code></li>
<li>Subtitle: "Active Deals"</li>
<li>Accent: green</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li><strong>Funnel visualization</strong> — stage-by-stage volume and conversion rates</li>
<li><strong>Active deal table</strong> — every open deal with stage, amount, age, owner, contact</li>
<li><strong>Proposal status</strong> — sent / viewed / signed indicators per deal</li>
<li><strong>Per-rep performance</strong> — your numbers vs. team average</li>
</ul>

<h2>Daily Workflow</h2>

<ol>
<li>Open the page first thing — review your active deals</li>
<li>Sort by oldest stage activity to find stalled deals</li>
<li>Take action on each: call, email, send proposal, advance stage in HubSpot</li>
<li>End of day — confirm any deals you advanced are reflected in your numbers</li>
</ol>

<div class="info">For the leadership view of this same data, see the <a href="/sop?tab=executive-sop">Executive tab</a>'s Sales Pipeline section.</div>
`;

const PRICING_CALCULATOR = `
<h1>Pricing Calculator (Deep Dive)</h1>

<p>Price a solar + battery system end-to-end with full COGS visibility, lease factor, and adders. This is the sales rep's authoritative tool for generating an accurate quote — not a guess.</p>

<ul>
<li>URL: <code>/dashboards/pricing-calculator</code></li>
<li>Accent: orange</li>
</ul>

<h2>Equipment Selection (top of page)</h2>

<p>Pick from active catalog options:</p>

<table>
<thead><tr><th>Section</th><th>What you select</th></tr></thead>
<tbody>
<tr><td><strong>Modules</strong></td><td>Brand + model + count. Wattage drives system size in kW DC.</td></tr>
<tr><td><strong>Inverters</strong></td><td>String / hybrid / micro — match to module count and system architecture</td></tr>
<tr><td><strong>Batteries</strong></td><td>Battery + expansion if applicable</td></tr>
<tr><td><strong>Other</strong></td><td>Racking, BOS, monitoring, EV charger — anything not in the first three buckets</td></tr>
</tbody>
</table>

<h2>Cost Sections (bottom of page)</h2>

<p>The calculator builds the full COGS bill on the page:</p>

<ol>
<li><strong>COGS</strong> — hardware unit costs from the catalog (auto-populated from your selections)</li>
<li><strong>Labour</strong> — crew labour hours × rate</li>
<li><strong>Acquisition Costs</strong> — sales commission + marketing attribution</li>
<li><strong>Fulfillment Costs</strong> — permitting, IC, PTO, inspection, third-party services</li>
<li><strong>Extra Costs (Roof/Site)</strong> — adders for difficult roofs, trenching, MPU, sub-panels</li>
</ol>

<h2>PE Lease Value</h2>

<p>For PE-tagged deals, the calculator surfaces the lease factor and EPC value automatically — same numbers used in the Accounting Suite's PE Deals dashboard. The customer/PE split renders below.</p>

<h2>Replace Calculator Data</h2>

<p>Switching customers? Click <strong>Replace Calculator Data</strong>. A confirmation dialog warns you before clearing. Always confirm — there's no undo.</p>

<h2>Common Mistakes</h2>

<div class="warn"><strong>Don't free-type module/inverter/battery names.</strong> Pick from the catalog dropdown so the COGS pulls correctly. If the equipment isn't in the dropdown, submit it via the catalog wizard FIRST (see <a href="/sop?tab=catalog">Catalog tab</a>) and come back when it's added.</div>

<div class="warn"><strong>Don't skip the Extra Costs section</strong> on roofs that need work. Steep, brittle, or shaded roofs all need adders or the project hemorrhages margin.</div>
`;

const ESTIMATOR = `
<h1>Customer Estimator</h1>

<p>The customer-facing estimator — your tool for delivering an accurate quote in real time during a sales call. Same tool customers see when they self-serve from the marketing site.</p>

<ul>
<li>Hub: <code>/estimator</code></li>
<li>Direct flows below</li>
</ul>

<h2>Six Estimator Flows</h2>

<table>
<thead><tr><th>Flow</th><th>Path</th><th>When to use</th></tr></thead>
<tbody>
<tr><td>New Install (solar)</td><td><code>/estimator/new-install</code></td><td>Brand new solar PV system</td></tr>
<tr><td>Battery</td><td><code>/estimator/battery</code></td><td>Battery for an existing solar customer</td></tr>
<tr><td>EV Charger</td><td><code>/estimator/ev-charger</code></td><td>Standalone EV charger install</td></tr>
<tr><td>System Expansion</td><td><code>/estimator/system-expansion</code></td><td>Adding modules to existing system</td></tr>
<tr><td>Detach &amp; Reset</td><td><code>/estimator/detach-reset</code></td><td>Customer needs panels removed for re-roof</td></tr>
<tr><td>Out of Area</td><td><code>/estimator/out-of-area</code></td><td>Outside our service area — declines politely</td></tr>
</tbody>
</table>

<h2>Address-First Flow</h2>

<p>The default flow for new install: customer (or you, if on a call) enters an address. Behind the scenes:</p>
<ol>
<li>Address is geocoded</li>
<li>EagleView is queried for roof measurements</li>
<li>OpenSolar pricing is applied</li>
<li>Adder rules run against the property</li>
<li>Instant estimate is returned</li>
</ol>

<h2>Lead Capture</h2>

<p>The results page collects contact info and creates a HubSpot lead automatically. Make sure the customer email/phone is correct before they hit Submit — the lead routes to whoever's on rotation.</p>
`;

const ADDERS_CATALOG = `
<h1>Adder Catalog 🚧</h1>

<div class="warn"><strong>In progress — not yet ready for reps.</strong> Preview only while we complete Phase 0 inventory and OpenSolar sync.</div>

<ul>
<li>URL: <code>/dashboards/adders</code></li>
<li>Title in app: "Adder Catalog"</li>
<li>Accent: green</li>
</ul>

<h2>What this will be</h2>

<p>A governed list of system adders (MPU, trenching, steep roof, ground mount, sub-panel, etc.) with prices, shop overrides, and point-of-sale triage questions. Replaces the current ad-hoc adder estimation that lives in spreadsheets.</p>

<h2>What you can do today</h2>

<p>Browse the in-progress catalog. <strong>Don't quote off these prices yet</strong> — they're not finalized. Continue to use the Pricing Calculator with manual adder entries until this ships.</p>

<h2>Status</h2>

<p>Phase 0: inventory adders that exist today across all five locations. Phase 1: align prices and define shop overrides. Phase 2: sync to OpenSolar so adders flow into customer-facing quotes automatically.</p>
`;

const ADDER_TRIAGE = `
<h1>Adder Triage 🚧</h1>

<div class="warn"><strong>In progress — not yet ready for reps.</strong> Preview only.</div>

<ul>
<li>URL: <code>/triage</code></li>
<li>Mobile-first questionnaire</li>
</ul>

<h2>What this will be</h2>

<p>A mobile questionnaire that captures system conditions at point of sale — roof pitch, MPU need, panel obstructions, trenching distance, etc. The answers feed into the Adder Catalog so the right adders land on the quote before contract.</p>

<h2>Components</h2>

<ul>
<li><strong>Deal lookup</strong> — link the triage session to a HubSpot deal</li>
<li><strong>Photo capture</strong> — upload site photos (panel, roof, electrical)</li>
<li><strong>Stepper</strong> — guided question flow</li>
<li><strong>Review</strong> — final summary before submit</li>
<li><strong>Offline draft</strong> — saves to localStorage so you can fill it out without signal and sync later</li>
</ul>

<h2>Status</h2>

<p>Built but not enabled for reps. Ships with the Adder Catalog (Phase 1).</p>
`;

const SITE_SURVEY_SCHEDULE = `
<h1>Site Survey Schedule</h1>

<p>Schedule the customer's site survey once they sign. Sales reps use this to lock in a survey date during the close call.</p>

<ul>
<li>URL: <code>/dashboards/site-survey-scheduler</code></li>
<li>Visible to SALES users via the Sales &amp; Marketing Suite</li>
</ul>

<h2>The 2-Day Lead-Time Rule</h2>

<div class="warn"><strong>SALES users cannot schedule a site survey for today or tomorrow.</strong> The earliest available date is 2 days out. Exact error message: <em>"Sales users cannot schedule site surveys for today or tomorrow. Please choose a date at least 2 days out."</em></div>

<p>Default timezone: America/Denver. The rule is enforced server-side, not bypassable by changing your local clock.</p>

<h2>Office Daily Caps</h2>

<table>
<thead><tr><th>Office</th><th>Max surveys / day</th></tr></thead>
<tbody>
<tr><td>DTC</td><td>3</td></tr>
<tr><td>Westminster</td><td>3</td></tr>
</tbody>
</table>

<p>When a day hits the cap, available slots clear and the day is flagged. Other offices have no hardcoded daily cap.</p>

<h2>Pre-sale Mode</h2>

<p>For deals not yet promoted to projects, switch to <strong>Pre-sale mode</strong> at the top of the scheduler. It searches HubSpot deals directly via <code>/api/deals/search</code>.</p>

<div class="info">For the full scheduler walkthrough (calendars, surveyor routing, post-scheduling actions), see the <a href="/sop?tab=scheduling">Scheduling tab</a>'s Site Survey section.</div>
`;

const REQUEST_PRODUCT = `
<h1>Request a Product</h1>

<p>Submit a request for a SKU not yet in the catalog. The request goes into a review queue for TechOps to assess and add.</p>

<ul>
<li>URL: <code>/dashboards/request-product</code></li>
<li>Title in app: "Request a Product"</li>
<li>Accent: cyan</li>
</ul>

<h2>When to use this</h2>

<ul>
<li>A customer asks for a brand we don't carry</li>
<li>A new module / inverter wattage variant comes out you want to quote</li>
<li>A vendor offered something interesting at a recent trade show</li>
</ul>

<h2>What you provide</h2>

<ul>
<li>Brand + model</li>
<li>Category (module / inverter / battery / EV / racking / BOS / monitoring)</li>
<li>Datasheet link or PDF</li>
<li>Reason / customer name (optional but helpful)</li>
</ul>

<h2>What happens next</h2>

<p>Submitted requests land on the Product Request Queue (admin/techops view). TechOps either approves and creates the catalog entry, or declines with a reason. You'll be notified either way.</p>

<div class="info">For products you can submit yourself (e.g., a new wattage variant of a brand we already carry), use the <a href="/sop?tab=catalog">Submit New Product wizard</a> — faster than going through Request a Product.</div>
`;

const SECTIONS = [
  { id: "smkt-sales-pipeline", group: "Sales", title: "Sales Pipeline", color: "green", order: 0, content: SALES_PIPELINE },
  { id: "smkt-pricing-calculator", group: "Sales", title: "Pricing Calculator (Deep Dive)", color: "amber", order: 1, content: PRICING_CALCULATOR },
  { id: "smkt-estimator", group: "Sales", title: "Customer Estimator", color: "blue", order: 2, content: ESTIMATOR },
  { id: "smkt-adders-catalog", group: "Adders (in progress)", title: "Adder Catalog", color: "purple", order: 10, content: ADDERS_CATALOG },
  { id: "smkt-adder-triage", group: "Adders (in progress)", title: "Adder Triage", color: "purple", order: 11, content: ADDER_TRIAGE },
  { id: "smkt-site-survey", group: "Customer Handoff", title: "Site Survey Schedule", color: "cyan", order: 20, content: SITE_SURVEY_SCHEDULE },
  { id: "smkt-request-product", group: "Customer Handoff", title: "Request a Product", color: "cyan", order: 21, content: REQUEST_PRODUCT },
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
