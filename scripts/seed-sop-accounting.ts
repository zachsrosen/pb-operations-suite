/**
 * Seed the Accounting SOP tab.
 *
 * Tab is gated to ACCOUNTING (plus admin/owner/executive bypass) via
 * TAB_ROLE_GATES in src/lib/sop-access.ts. This matches the runtime gate
 * on the actual /dashboards/payment-action-queue and similar pages, which
 * check `["ADMIN", "EXECUTIVE", "OWNER", "ACCOUNTING"]`.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-accounting.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "accounting-sop";
const TAB_LABEL = "Accounting";
const TAB_SORT = 17;

const PAYMENT_ACTION_QUEUE = `
<h1>Payment Action Queue</h1>

<p>The accounting team's daily workspace. Surfaces rejected invoices, overdue payments, and ready-to-invoice work milestones in one prioritized view.</p>

<ul>
<li>URL: <code>/dashboards/payment-action-queue</code></li>
<li>Page-level role gate: <code>["ADMIN", "EXECUTIVE", "ACCOUNTING"]</code> — non-matching roles are redirected to the home page</li>
</ul>

<h2>What's on the page</h2>

<ul>
<li><strong>Rejected invoices</strong> — sent but bounced back; need re-issue or correction</li>
<li><strong>Overdue payments</strong> — invoices past due date with aging</li>
<li><strong>Ready-to-invoice milestones</strong> — work milestones hit without an invoice yet (pulls from <code>/dashboards/ready-to-invoice</code> source)</li>
</ul>

<h2>Workflow</h2>

<ol>
<li>Start with rejected invoices — diagnose why each was rejected (wrong product line item, wrong customer, etc.) and re-issue</li>
<li>Move to overdue — call/email customer, log contact in HubSpot, escalate via PE Action Queue if PE-tagged</li>
<li>Finish with ready-to-invoice — generate invoices for milestones that have hit but haven't been billed</li>
</ol>
`;

const PAYMENT_TRACKING = `
<h1>Payment Tracking</h1>

<p>Per-project payment status: not yet paid, partially paid, fully paid. Use this to answer "where are we with this project's payments?"</p>

<ul>
<li>URL: <code>/dashboards/payment-tracking</code></li>
<li>Page-level role gate: <code>["ADMIN", "EXECUTIVE", "ACCOUNTING"]</code></li>
</ul>

<h2>Status Buckets</h2>

<table>
<thead><tr><th>Status</th><th>Meaning</th></tr></thead>
<tbody>
<tr><td>Not yet paid</td><td>No payments received against any invoice for this project</td></tr>
<tr><td>Partially paid</td><td>Some invoices paid, others outstanding</td></tr>
<tr><td>Fully paid</td><td>All invoiced amounts received</td></tr>
</tbody>
</table>

<div class="info">"Fully paid" is per <em>invoiced</em> amount. If a milestone hasn't been invoiced yet, the project can show "Fully paid" while still having work-to-bill outstanding. Cross-check with the Ready to Invoice view.</div>
`;

const READY_TO_INVOICE = `
<h1>Ready to Invoice</h1>

<p>Work milestones that have been hit but not yet invoiced. Grouped by milestone type so you can batch invoice generation.</p>

<ul>
<li>URL: <code>/dashboards/ready-to-invoice</code></li>
<li>Page-level role gate: <code>["ADMIN", "EXECUTIVE", "OWNER", "ACCOUNTING"]</code></li>
</ul>

<h2>Milestone Buckets</h2>

<p>Standard PB invoice milestones (each bucket lists projects waiting on its specific invoice):</p>

<ul>
<li><strong>Design Approval (DA)</strong> — invoice issued at customer DA signature</li>
<li><strong>Construction Complete (CC)</strong> — invoice issued at construction handoff</li>
<li><strong>Permission to Operate (PTO)</strong> — final invoice at utility approval</li>
<li><strong>PE Milestone 1 (M1)</strong> — Participate Energy first installment</li>
<li><strong>PE Milestone 2 (M2)</strong> — PE second installment</li>
</ul>

<h2>Workflow</h2>

<ol>
<li>Filter by milestone</li>
<li>Verify each project actually hit the milestone in HubSpot (don't trust the queue blindly — work milestones can lag actual events)</li>
<li>Generate invoices in Zoho Books for each verified row</li>
<li>Once invoiced, the project drops out of this queue and moves to AR if unpaid, or Payment Tracking if paid</li>
</ol>

<div class="info">For the canonical trigger points of each milestone (when the invoice should fire), see the Reference tab's payment-milestone notes.</div>
`;

const ACCOUNTS_RECEIVABLE = `
<h1>Accounts Receivable</h1>

<p>Invoices sent but unpaid, grouped by aging bucket. Drives the collections workflow.</p>

<ul>
<li>URL: <code>/dashboards/accounts-receivable</code></li>
<li>Page-level role gate: <code>["ADMIN", "EXECUTIVE", "OWNER", "ACCOUNTING"]</code></li>
</ul>

<h2>Aging Buckets</h2>

<table>
<thead><tr><th>Bucket</th><th>Action</th></tr></thead>
<tbody>
<tr><td><strong>0–30 days</strong></td><td>Within terms — monitor only</td></tr>
<tr><td><strong>31–60 days</strong></td><td>First reminder — friendly follow-up email</td></tr>
<tr><td><strong>61–90 days</strong></td><td>Second reminder + phone call — log contact in HubSpot</td></tr>
<tr><td><strong>90+ days</strong></td><td>Escalation — collections review, possible mechanic's lien filing</td></tr>
</tbody>
</table>

<h2>Per-invoice columns</h2>

<ul>
<li>Invoice #, customer, project</li>
<li>Amount, days outstanding</li>
<li>Last contact date</li>
<li>Direct link to invoice in Zoho Books</li>
</ul>
`;

const PE_DEALS = `
<h1>PE Deals &amp; Payments</h1>

<p>All Participate Energy-tagged deals with auto-calculated EPC, lease factor, and payment splits.</p>

<ul>
<li>URL: <code>/dashboards/pe-deals</code></li>
<li>Subtitle: shows expected PE receivable + customer + PE combined</li>
<li>Visible to: ADMIN, OWNER, EXECUTIVE, ACCOUNTING</li>
</ul>

<h2>Hero Stats</h2>

<ul>
<li>Of expected PE receivable (total)</li>
<li>Customer + PE combined value</li>
<li>Status counts: <strong>Paid</strong>, <strong>Partially Paid</strong></li>
</ul>

<h2>EPC + Lease Factor</h2>

<p>For each PE deal, the dashboard auto-calculates:</p>
<ul>
<li><strong>EPC</strong> (Engineering, Procurement, Construction) — what PB charges PE</li>
<li><strong>Lease factor</strong> — PE's lease pricing input</li>
<li><strong>Customer split</strong> — what the homeowner pays</li>
<li><strong>PE split</strong> — what PE pays</li>
</ul>

<h2>Edge Cases</h2>

<div class="warn">An ⚠️ icon means the EC (energy community) lookup failed for that deal. Check the deal address against the EC eligibility map and update the deal property manually.</div>
`;

const PE_DASHBOARD = `
<h1>Participate Energy (PE Dashboard)</h1>

<p>Project milestone tracker for Participate Energy deals. Different from the PE Deals dashboard (which is financial-only) — this one is operational, tracking the install / inspection / PTO progression for compliance.</p>

<ul>
<li>URL: <code>/dashboards/pe</code></li>
<li>Subtitle: "Project Milestone Tracker"</li>
<li>Accent: green</li>
</ul>

<h2>Hero stats</h2>

<ul>
<li><strong>Forecasted Installation</strong></li>
<li><strong>Forecasted Inspection</strong></li>
<li><strong>Forecasted PTO</strong></li>
</ul>

<h2>Workflow</h2>

<p>This dashboard is read-only — it's a leadership view of where PE-tagged projects are in the pipeline. For active intervention on stuck PE deals, use the Payment Action Queue (PE M1/M2) and the regular Pipeline action queues.</p>

<div class="warn"><strong>Compliance note:</strong> PE deals have specific milestone deadlines tied to the PE contract. A slipping forecast can trigger contract penalties — pull this dashboard at least weekly during PE-heavy periods.</div>
`;

const SECTIONS = [
  { id: "acct-payment-action-queue", group: "Daily Workflow", title: "Payment Action Queue", color: "red", order: 0, content: PAYMENT_ACTION_QUEUE },
  { id: "acct-payment-tracking", group: "Daily Workflow", title: "Payment Tracking", color: "blue", order: 1, content: PAYMENT_TRACKING },
  { id: "acct-ready-to-invoice", group: "Daily Workflow", title: "Ready to Invoice", color: "amber", order: 2, content: READY_TO_INVOICE },
  { id: "acct-accounts-receivable", group: "Daily Workflow", title: "Accounts Receivable", color: "purple", order: 3, content: ACCOUNTS_RECEIVABLE },
  { id: "acct-pe-deals", group: "Participate Energy", title: "PE Deals & Payments", color: "orange", order: 10, content: PE_DEALS },
  { id: "acct-pe-dashboard", group: "Participate Energy", title: "PE Dashboard", color: "green", order: 11, content: PE_DASHBOARD },
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
