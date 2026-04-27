/**
 * Split the legacy "Tech Ops" SOP tab (role-de) into three role-aligned tabs:
 *   - role-de       → "Design"        (DESIGN role)
 *   - role-permit   → "Permitting"    (PERMIT role)         [new]
 *   - role-ic       → "Interconnection" (INTERCONNECT role) [new]
 *
 * Idempotent. Wraps writes in a transaction.
 *
 * Usage:
 *   set -a; source .env; set +a; npx tsx scripts/migrate-sop-design-split.ts [--dry-run]
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

const DRY = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Section content drafts (verbatim where unchanged; rewritten where flagged)
// ---------------------------------------------------------------------------

const DE_OVERVIEW = `<h1>Design — Role Overview</h1>
<p class="subtitle">Design &amp; Engineering</p>

<div class="info-box" style="border-left:4px solid var(--emerald-500);background:var(--emerald-50,#ecfdf5);padding:16px 20px;border-radius:8px;margin:20px 0;">
<strong>Your Mission:</strong> Take projects from Site Survey through Design &amp; Engineering — producing reviewed, customer-approved, engineering-stamped plans so the project is ready to hand to Permitting.
</div>

<h2>What You Have Access To</h2>
<table>
<thead><tr><th>Tool / Suite</th><th>What It's For</th></tr></thead>
<tbody>
<tr><td><strong>Design &amp; Engineering Suite</strong></td><td>Suite landing page</td></tr>
<tr><td><strong>D&amp;E Overview</strong></td><td>Current design workload and status</td></tr>
<tr><td><strong>Plan Review</strong></td><td>Review and approve design plans</td></tr>
<tr><td><strong>Pending Approval</strong></td><td>Plans awaiting customer DA signature</td></tr>
<tr><td><strong>Design Revisions</strong></td><td>Track revision requests and completion</td></tr>
<tr><td><strong>Design Pipeline Funnel</strong></td><td>Throughput and stage conversion view</td></tr>
<tr><td><strong>D&amp;E Metrics</strong></td><td>Turnaround times, throughput analytics</td></tr>
<tr><td><strong>Clipping Analytics</strong></td><td>DC/AC ratio and clipping analysis</td></tr>
<tr><td><strong>Production Issues</strong></td><td>Underperforming-system flags from monitoring</td></tr>
<tr><td><strong>AHJ Requirements</strong></td><td>Jurisdiction-specific design requirements (read-only reference)</td></tr>
<tr><td><strong>Utility Design Requirements</strong></td><td>Utility-specific system size and design rules (read-only reference)</td></tr>
<tr><td><strong>Solar Surveyor / Solar Designer</strong></td><td>Site survey and design tooling</td></tr>
<tr><td><strong>Product Catalog / Submit Product / Request Product</strong></td><td>Equipment specs and new-product submissions</td></tr>
<tr><td><strong>BOM (current + history)</strong></td><td>Bills of materials per project</td></tr>
<tr><td><strong>IDR Meeting</strong></td><td>Initial Design Review meeting board</td></tr>
<tr><td><strong>Adders / TSRF Calculator</strong></td><td>Pricing adders and shading calc</td></tr>
<tr><td><strong>Comms / My Tasks / My Tickets / On-Call</strong></td><td>Day-to-day team tools</td></tr>
</tbody>
</table>

<p><em>Note: Permitting, Interconnection, AHJ Tracker and Utility Tracker dashboards live under the Permitting and Interconnection roles. You can read AHJ and utility design requirements but you don't manage the trackers themselves.</em></p>

<h2>Your Capabilities</h2>
<table>
<thead><tr><th>Action</th><th>Design</th></tr></thead>
<tbody>
<tr><td>View Design &amp; Engineering Suite</td><td>✅</td></tr>
<tr><td>Edit Design</td><td>✅</td></tr>
<tr><td>View AHJ &amp; Utility Design Requirements (reference)</td><td>✅</td></tr>
<tr><td>Edit Permitting</td><td>—</td></tr>
<tr><td>Schedule Surveys / Installs / Inspections</td><td>—</td></tr>
<tr><td>Sync to Zuper</td><td>—</td></tr>
<tr><td>Manage Users / Availability / Adders</td><td>—</td></tr>
<tr><td>View All Locations</td><td>Own location only</td></tr>
</tbody>
</table>`;

const DE_DESIGN_WORKFLOW = `<h1>Design — Design Workflow</h1>
<p class="subtitle">From site survey data to stamped plans</p>

<h2>Design Lifecycle in HubSpot</h2>
<p>Design work happens during the <strong>Design &amp; Engineering</strong> pipeline stage. The deal record tracks every date in the process:</p>

<div class="pm-steps">
<div class="pm-step"><strong>Design Start Date</strong> — When design work begins on a project. Triggered when the deal enters D&amp;E stage.</div>
<div class="pm-step"><strong>Date Returned From Designers</strong> — When the first draft comes back from the design team.</div>
<div class="pm-step"><strong>Design Draft Completion Date</strong> — When the initial design is finished and ready for internal review.</div>
<div class="pm-step"><strong>Design Approval Sent Date</strong> — When the design is sent to the customer for approval via PandaDoc.</div>
<div class="pm-step"><strong>Design Completion Date</strong> — When the design is finalized (customer approved, ready for permitting).</div>
</div>

<h2>Key HubSpot Fields — Design &amp; Engineering Group</h2>
<table>
<thead><tr><th>Field</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td>Design Lead</td><td>Who is assigned to this design</td></tr>
<tr><td>Design Start Date</td><td>When design began</td></tr>
<tr><td>Date Returned From Designers</td><td>First draft received</td></tr>
<tr><td>Design Draft Completion Date</td><td>Draft finalized</td></tr>
<tr><td>Engineering Submission Date</td><td>Sent for engineering stamp</td></tr>
<tr><td>Engineering Stamped Date</td><td>PE stamp received</td></tr>
<tr><td>Design Completion Date</td><td>Final design complete</td></tr>
<tr><td>Design Rejection Date</td><td>If customer rejected the DA</td></tr>
<tr><td>Design Revision Date</td><td>Revision cycle dates</td></tr>
</tbody>
</table>

<h2>Revision Tracking</h2>
<p>The deal record tracks up to 4 types of revisions with separate counters:</p>
<table>
<thead><tr><th>Revision Type</th><th>Counter Field</th><th>Triggered By</th></tr></thead>
<tbody>
<tr><td>DA Revision</td><td>DA Revision Counter</td><td>Customer requests changes to design approval</td></tr>
<tr><td>Permit Revision</td><td>Permit Revision Counter</td><td>AHJ requests plan corrections</td></tr>
<tr><td>Interconnection Revision</td><td>Interconnection Revision Counter</td><td>Utility requests changes</td></tr>
<tr><td>As-Built Revision</td><td>As-Built Revision Counter</td><td>Field changes require updated plans</td></tr>
</tbody>
</table>
<p>The <strong>Design Revisions dashboard</strong> aggregates these across all active projects so you can see your revision workload at a glance.</p>`;

const DE_PLAN_REVIEW = `<h1>Design — Plan Review</h1>
<p class="subtitle">Internal design QC before customer approval</p>

<h2>Plan Review Dashboard</h2>
<p>The <strong>Plan Review</strong> dashboard shows all designs awaiting internal review. Before sending a design to the customer for approval, it should be reviewed for:</p>
<ul>
<li>✅ Correct module count and layout</li>
<li>✅ Inverter/battery sizing matches the proposal</li>
<li>✅ AHJ-specific requirements met (see AHJ Requirements dashboard)</li>
<li>✅ Utility design requirements met (system size rules, production meter, etc.)</li>
<li>✅ Structural calculations complete</li>
<li>✅ Electrical single-line diagram accurate</li>
</ul>

<h2>Design Approval (DA) Process</h2>
<div class="pm-steps">
<div class="pm-step"><strong>Internal review complete</strong> — design passes plan review checklist.</div>
<div class="pm-step"><strong>Send DA to customer</strong> via PandaDoc. The Design Approval Sent Date is recorded in HubSpot.</div>
<div class="pm-step"><strong>Customer reviews and signs</strong> — or rejects with notes. DA status tracked in PandaDoc card on the deal record.</div>
<div class="pm-step"><strong>If rejected:</strong> Review the "Design Approval Notes from Customer" and "DA Rejection Reason" fields. Create a revision. Increment the DA Revision Counter.</div>
<div class="pm-step"><strong>If approved:</strong> Design is locked. Submit for engineering stamp if required (PE Letter per AHJ).</div>
</div>

<h2>Pending Approval Dashboard</h2>
<p>The <strong>Pending Approval</strong> dashboard shows all designs sent to customers but not yet signed. Use this to follow up on stale approvals.</p>`;

const DE_TOOLS = `<h1>Design — Your Tools</h1>
<p class="subtitle">Quick reference for your daily toolkit</p>

<h2>Daily Workflow</h2>
<table>
<thead><tr><th>Time</th><th>Task</th><th>Tool</th></tr></thead>
<tbody>
<tr><td>Morning</td><td>Check your design queue — new projects and revisions</td><td>D&amp;E Overview</td></tr>
<tr><td>Midday</td><td>Work on designs — reference AHJ/Utility requirements</td><td>AHJ Requirements, Utility Design Requirements</td></tr>
<tr><td>Afternoon</td><td>Review completed designs</td><td>Plan Review</td></tr>
<tr><td>End of day</td><td>Update dates in HubSpot — design completion, submission, etc.</td><td>HubSpot deal records</td></tr>
</tbody>
</table>

<h2>D&amp;E Metrics</h2>
<p>The <strong>D&amp;E Metrics</strong> dashboard tracks your team's performance:</p>
<ul>
<li>Average design turnaround time (design start → design completion)</li>
<li>Revision rates — how often designs need revisions</li>
<li>Throughput — how many designs completed per week</li>
<li>Queue depth — how many projects are waiting for design</li>
</ul>

<h2>Solar Surveyor</h2>
<p>The <strong>Solar Surveyor</strong> tool is available to your role for creating and reviewing solar site survey projects. Use it for design reference, shade analysis, and site condition documentation.</p>

<h2>Deal Record Quick Reference</h2>
<p>The HubSpot deal record has 8 Google Drive folder links organized by project stage. For design, you'll primarily use:</p>
<ul>
<li><strong>Site Survey Documents</strong> — Site photos, measurements, existing conditions</li>
<li><strong>Design Documents</strong> — Plans, engineering calcs, approval docs</li>
</ul>`;

// Permit + IC: existing content with title-only changes
const DE_PERMITTING_NEW = `<h1>Permitting Workflow</h1>
<p class="subtitle">From plan submission to permit issued</p>

<h2>Permitting Lifecycle in HubSpot</h2>
<p>Permitting work happens during the <strong>Permitting &amp; Interconnection</strong> pipeline stage. Key fields:</p>

<table>
<thead><tr><th>Field</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td>Permit Lead</td><td>Who is managing this permit</td></tr>
<tr><td>Permit Submit Date</td><td>When the application was submitted</td></tr>
<tr><td>Permit Issued Date</td><td>When the permit was approved</td></tr>
<tr><td>Permit Rejection Date</td><td>If the AHJ rejected the submission</td></tr>
<tr><td>Permit Revision Complete Date</td><td>When corrections were resubmitted</td></tr>
<tr><td>Permit Revision Counter</td><td>How many revision cycles</td></tr>
<tr><td>Permit Turnaround Time</td><td>Days from submit to issued</td></tr>
</tbody>
</table>

<h2>Permit Action Queue</h2>
<p>The <strong>Permit Action Queue</strong> dashboard shows permits that need your attention:</p>
<ul>
<li><strong>Ready to Submit</strong> — Design is complete, permit application needs to be prepared and submitted</li>
<li><strong>Corrections Requested</strong> — AHJ sent back revisions, need to fix and resubmit</li>
<li><strong>Awaiting Review</strong> — Submitted and waiting for AHJ response (track with AHJ Tracker)</li>
</ul>

<h2>AHJ-Specific Requirements</h2>
<p>Every project is associated with an AHJ (Authority Having Jurisdiction) in HubSpot. The deal record's <strong>AHJ &amp; Utility tab</strong> shows:</p>
<ul>
<li><strong>Stamping Requirements</strong> — PE Letter required? Engineer stamp?</li>
<li><strong>NEC Code / IRC Code</strong> — Which code year applies</li>
<li><strong>Design Snow Load / Wind Speed</strong> — Structural requirements</li>
<li><strong>Submission Method</strong> — Portal, email, in-person, etc.</li>
<li><strong>Permits Required</strong> — PV, ESS, Electrical (varies by AHJ)</li>
<li><strong>Average Permit Turnaround</strong> — Historical processing time</li>
</ul>`;

const DE_AHJ_NEW = `<h1>AHJ Tracking</h1>
<p class="subtitle">Monitoring jurisdiction performance</p>

<h2>AHJ Tracker</h2>
<p>The <strong>AHJ Tracker</strong> dashboard scores authorities having jurisdiction on permit processing performance. Each AHJ gets a score based on:</p>
<ul>
<li>Average permit turnaround time</li>
<li>Overdue rate (% of permits that exceed expected timelines)</li>
<li>Deal volume in the last 365 days</li>
</ul>

<h2>How to Use It</h2>
<table>
<thead><tr><th>Scenario</th><th>Action</th></tr></thead>
<tbody>
<tr><td>Before submitting a permit</td><td>Check the AHJ's score — low scores mean expect delays, plan accordingly</td></tr>
<tr><td>Identifying problem jurisdictions</td><td>Focus on AHJs with scores &lt; 50 for escalation or process changes</td></tr>
<tr><td>Staffing decisions</td><td>High-volume slow AHJs may need dedicated resources</td></tr>
<tr><td>Setting customer expectations</td><td>Use average turnaround to give realistic timelines</td></tr>
</tbody>
</table>

<p><em>For utility-side performance tracking, see the Utility Tracker section under the Interconnection role.</em></p>`;

const DE_INTERCONNECTION_NEW = `<h1>Interconnection</h1>
<p class="subtitle">Utility interconnection applications and approvals</p>

<h2>Interconnection Lifecycle</h2>
<p>Interconnection is typically submitted in parallel with permitting. Key HubSpot fields:</p>

<table>
<thead><tr><th>Field</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td>Interconnections Lead</td><td>Who is managing this application</td></tr>
<tr><td>Interconnection Start Date</td><td>When IC work began</td></tr>
<tr><td>Interconnection Ready To Submit Date</td><td>Application prepared</td></tr>
<tr><td>Utility Application #</td><td>The application number from the utility</td></tr>
<tr><td>Interconnection Turnaround Time</td><td>Days from submit to approval</td></tr>
<tr><td>Interconnection Blocker</td><td>What's holding it up</td></tr>
<tr><td>Interconnection Revision Counter</td><td>Number of revision cycles</td></tr>
</tbody>
</table>

<h2>IC Action Queue</h2>
<p>The <strong>IC Action Queue</strong> dashboard shows interconnection applications needing action — similar to the Permit Action Queue but for utility applications.</p>

<h2>Utility-Specific Rules</h2>
<p>Each project is associated with a Utility record in HubSpot. The <strong>Utility Information card</strong> on the AHJ &amp; Utility tab shows critical rules:</p>
<ul>
<li><strong>System Size Rule</strong> — e.g., 200% (max AC output vs. service panel)</li>
<li><strong>AC Disconnect Required?</strong> — e.g., "Yes if over 10 kW"</li>
<li><strong>Backup Switch allowed?</strong> — Affects battery system design</li>
<li><strong>Is Production Meter Required?</strong> — Additional equipment needed?</li>
<li><strong>Util App Requires Customer Signature?</strong> — May need customer involvement</li>
<li><strong>Average Interconnection Turnaround</strong> — Historical timeline (can be 30–53+ days)</li>
</ul>`;

// New sections — overviews + Utility Tracker
const PERMIT_OVERVIEW = `<h1>Permitting — Role Overview</h1>
<p class="subtitle">Permitting</p>

<div class="info-box" style="border-left:4px solid var(--sky-500);background:var(--sky-50,#f0f9ff);padding:16px 20px;border-radius:8px;margin:20px 0;">
<strong>Your Mission:</strong> Take stamped plans through the AHJ permit process — submit applications, respond to corrections, and get permits issued so the project can move to Ready To Build.
</div>

<h2>What You Have Access To</h2>
<table>
<thead><tr><th>Tool / Suite</th><th>What It's For</th></tr></thead>
<tbody>
<tr><td><strong>Permitting &amp; Interconnection Suite</strong></td><td>Suite landing page</td></tr>
<tr><td><strong>Permitting Dashboard</strong></td><td>Permit pipeline overview</td></tr>
<tr><td><strong>Permit Hub</strong></td><td>Per-project permit detail and document hub</td></tr>
<tr><td><strong>P&amp;I Overview / P&amp;I Metrics</strong></td><td>Pipeline status and performance</td></tr>
<tr><td><strong>Permit Action Queue</strong></td><td>Permits needing action — submit, respond, revise</td></tr>
<tr><td><strong>Permit Revisions</strong></td><td>Active permit-revision cycles</td></tr>
<tr><td><strong>P&amp;I Action Queue / P&amp;I Revisions / P&amp;I Timeline</strong></td><td>Combined P&amp;I views</td></tr>
<tr><td><strong>AHJ Tracker</strong></td><td>Performance scores for authorities having jurisdiction</td></tr>
<tr><td><strong>AHJ Requirements</strong></td><td>Jurisdiction-specific submission rules</td></tr>
<tr><td><strong>IDR Meeting</strong></td><td>Initial Design Review meeting board</td></tr>
<tr><td><strong>Adders / Comms / My Tasks / My Tickets / On-Call</strong></td><td>Day-to-day team tools</td></tr>
</tbody>
</table>

<h2>Your Capabilities</h2>
<table>
<thead><tr><th>Action</th><th>Permitting</th></tr></thead>
<tbody>
<tr><td>View Permitting &amp; Interconnection Suite</td><td>✅</td></tr>
<tr><td>Edit Permitting</td><td>✅</td></tr>
<tr><td>Edit Design</td><td>—</td></tr>
<tr><td>Schedule Surveys / Installs / Inspections</td><td>—</td></tr>
<tr><td>Sync to Zuper</td><td>—</td></tr>
<tr><td>Manage Users / Availability / Adders</td><td>—</td></tr>
<tr><td>View All Locations</td><td>Own location only</td></tr>
</tbody>
</table>`;

const IC_OVERVIEW = `<h1>Interconnection — Role Overview</h1>
<p class="subtitle">Interconnection</p>

<div class="info-box" style="border-left:4px solid var(--violet-500);background:var(--violet-50,#f5f3ff);padding:16px 20px;border-radius:8px;margin:20px 0;">
<strong>Your Mission:</strong> Take stamped plans through the utility interconnection process — submit applications, respond to utility requests, and secure interconnection approval so the project can move to Ready To Build.
</div>

<h2>What You Have Access To</h2>
<table>
<thead><tr><th>Tool / Suite</th><th>What It's For</th></tr></thead>
<tbody>
<tr><td><strong>Permitting &amp; Interconnection Suite</strong></td><td>Suite landing page</td></tr>
<tr><td><strong>Interconnection Dashboard</strong></td><td>IC pipeline overview</td></tr>
<tr><td><strong>IC Hub</strong></td><td>Per-project interconnection detail and document hub</td></tr>
<tr><td><strong>P&amp;I Overview / P&amp;I Metrics</strong></td><td>Pipeline status and performance</td></tr>
<tr><td><strong>IC Action Queue</strong></td><td>Interconnection items needing action</td></tr>
<tr><td><strong>IC Revisions</strong></td><td>Active utility-revision cycles</td></tr>
<tr><td><strong>P&amp;I Action Queue / P&amp;I Revisions / P&amp;I Timeline</strong></td><td>Combined P&amp;I views</td></tr>
<tr><td><strong>Utility Tracker</strong></td><td>Performance scores for utility companies</td></tr>
<tr><td><strong>Utility Design Requirements</strong></td><td>Utility-specific system size and design rules</td></tr>
<tr><td><strong>IDR Meeting</strong></td><td>Initial Design Review meeting board</td></tr>
<tr><td><strong>Adders / Comms / My Tasks / My Tickets / On-Call</strong></td><td>Day-to-day team tools</td></tr>
</tbody>
</table>

<h2>Your Capabilities</h2>
<table>
<thead><tr><th>Action</th><th>Interconnection</th></tr></thead>
<tbody>
<tr><td>View Permitting &amp; Interconnection Suite</td><td>✅</td></tr>
<tr><td>Edit Permitting</td><td>—</td></tr>
<tr><td>Edit Design</td><td>—</td></tr>
<tr><td>Schedule Surveys / Installs / Inspections</td><td>—</td></tr>
<tr><td>Sync to Zuper</td><td>—</td></tr>
<tr><td>Manage Users / Availability / Adders</td><td>—</td></tr>
<tr><td>View All Locations</td><td>Own location only</td></tr>
</tbody>
</table>`;

const IC_UTILITY_TRACKER = `<h1>Utility Tracker</h1>
<p class="subtitle">Monitoring utility interconnection performance</p>

<h2>Utility Tracker</h2>
<p>The <strong>Utility Tracker</strong> dashboard scores utility companies on interconnection processing performance. It tracks interconnection turnaround times and identifies slow utilities. The tracker shows both overall averages and last-90-day trends so you can spot improving or worsening utilities.</p>

<h2>How to Use It</h2>
<table>
<thead><tr><th>Scenario</th><th>Action</th></tr></thead>
<tbody>
<tr><td>Before submitting an interconnection application</td><td>Check the utility's average turnaround — set realistic customer expectations</td></tr>
<tr><td>Identifying problem utilities</td><td>Focus on utilities trending worse over the last 90 days for escalation</td></tr>
<tr><td>Setting customer expectations</td><td>Use average turnaround to give realistic timelines (some utilities run 30–53+ days)</td></tr>
</tbody>
</table>

<p><em>For AHJ-side performance tracking, see the AHJ Tracker section under the Permitting role.</em></p>`;

// ---------------------------------------------------------------------------
// Migration plan
// ---------------------------------------------------------------------------

interface TabPlan {
  id: string;
  label: string;
  sortOrder: number;
}

interface SectionPlan {
  id: string;
  tabId: string;
  sidebarGroup: string;
  title: string;
  dotColor: string;
  sortOrder: number;
  content: string;
}

const TABS: TabPlan[] = [
  { id: "role-de", label: "Design", sortOrder: 5 },
  { id: "role-permit", label: "Permitting", sortOrder: 6 },
  { id: "role-ic", label: "Interconnection", sortOrder: 7 },
];

// All sections (existing IDs preserved + new ones added)
const SECTIONS: SectionPlan[] = [
  // role-de (Design)
  { id: "de-overview",        tabId: "role-de",     sidebarGroup: "Design",         title: "Role Overview",   dotColor: "emerald", sortOrder: 0, content: DE_OVERVIEW },
  { id: "de-design-workflow", tabId: "role-de",     sidebarGroup: "Design",         title: "Design Workflow", dotColor: "emerald", sortOrder: 1, content: DE_DESIGN_WORKFLOW },
  { id: "de-plan-review",     tabId: "role-de",     sidebarGroup: "Design",         title: "Plan Review",     dotColor: "emerald", sortOrder: 2, content: DE_PLAN_REVIEW },
  { id: "de-tools",           tabId: "role-de",     sidebarGroup: "Design",         title: "Your Tools",      dotColor: "emerald", sortOrder: 3, content: DE_TOOLS },
  // role-permit
  { id: "permit-overview",    tabId: "role-permit", sidebarGroup: "Permitting",     title: "Role Overview",       dotColor: "sky",    sortOrder: 0, content: PERMIT_OVERVIEW },
  { id: "de-permitting",      tabId: "role-permit", sidebarGroup: "Permitting",     title: "Permitting Workflow", dotColor: "sky",    sortOrder: 1, content: DE_PERMITTING_NEW },
  { id: "de-ahj",             tabId: "role-permit", sidebarGroup: "Permitting",     title: "AHJ Tracking",        dotColor: "sky",    sortOrder: 2, content: DE_AHJ_NEW },
  // role-ic
  { id: "ic-overview",        tabId: "role-ic",     sidebarGroup: "Interconnection", title: "Role Overview",     dotColor: "violet", sortOrder: 0, content: IC_OVERVIEW },
  { id: "de-interconnection", tabId: "role-ic",     sidebarGroup: "Interconnection", title: "Interconnection",   dotColor: "violet", sortOrder: 1, content: IC_OVERVIEW /* placeholder, overwritten below */ },
  { id: "ic-utility-tracker", tabId: "role-ic",     sidebarGroup: "Interconnection", title: "Utility Tracker",   dotColor: "violet", sortOrder: 2, content: IC_UTILITY_TRACKER },
];
// Fix the placeholder
SECTIONS.find((s) => s.id === "de-interconnection")!.content = DE_INTERCONNECTION_NEW;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

(async () => {
  console.log(`[migrate-sop-design-split] dry=${DRY}`);

  await prisma.$transaction(async (tx) => {
    // 1. Upsert tabs (rename role-de label, create role-permit + role-ic)
    for (const t of TABS) {
      const existing = await tx.sopTab.findUnique({ where: { id: t.id } });
      if (existing) {
        if (existing.label !== t.label || existing.sortOrder !== t.sortOrder) {
          console.log(`  [tab] update ${t.id}: "${existing.label}" → "${t.label}", sortOrder ${existing.sortOrder}→${t.sortOrder}`);
          if (!DRY) await tx.sopTab.update({ where: { id: t.id }, data: { label: t.label, sortOrder: t.sortOrder } });
        } else {
          console.log(`  [tab] keep   ${t.id} (already correct)`);
        }
      } else {
        console.log(`  [tab] create ${t.id} | ${t.label}`);
        if (!DRY) await tx.sopTab.create({ data: t });
      }
    }

    // 2. Upsert sections
    for (const s of SECTIONS) {
      const existing = await tx.sopSection.findUnique({ where: { id: s.id } });
      if (existing) {
        const tabChanged = existing.tabId !== s.tabId;
        const contentChanged = existing.content !== s.content;
        const titleChanged = existing.title !== s.title;
        const groupChanged = existing.sidebarGroup !== s.sidebarGroup;
        if (tabChanged || contentChanged || titleChanged || groupChanged) {
          const changes: string[] = [];
          if (tabChanged) changes.push(`tab ${existing.tabId}→${s.tabId}`);
          if (titleChanged) changes.push(`title "${existing.title}"→"${s.title}"`);
          if (groupChanged) changes.push(`group "${existing.sidebarGroup}"→"${s.sidebarGroup}"`);
          if (contentChanged) changes.push(`content (${existing.content.length}→${s.content.length} chars)`);
          console.log(`  [section] update ${s.id}: ${changes.join(", ")}`);
          if (!DRY) {
            // Save revision before overwriting (preserves history)
            if (contentChanged) {
              await tx.sopRevision.create({
                data: {
                  sectionId: s.id,
                  content: existing.content,
                  editedBy: "system@photonbrothers.com",
                  editSummary: "tech-ops → design/permit/IC split (migrate-sop-design-split.ts)",
                },
              });
            }
            await tx.sopSection.update({
              where: { id: s.id },
              data: {
                tabId: s.tabId,
                sidebarGroup: s.sidebarGroup,
                title: s.title,
                dotColor: s.dotColor,
                sortOrder: s.sortOrder,
                content: s.content,
                version: { increment: 1 },
                updatedBy: "system@photonbrothers.com",
              },
            });
          }
        } else {
          console.log(`  [section] keep   ${s.id} (already correct)`);
        }
      } else {
        console.log(`  [section] create ${s.id} on ${s.tabId} | ${s.title}`);
        if (!DRY) {
          await tx.sopSection.create({
            data: {
              ...s,
              updatedBy: "system@photonbrothers.com",
            },
          });
        }
      }
    }

    // 3. Verify final state
    const finalTabs = await tx.sopTab.findMany({
      where: { id: { in: ["role-de", "role-permit", "role-ic"] } },
      orderBy: { sortOrder: "asc" },
    });
    const finalSections = await tx.sopSection.findMany({
      where: { tabId: { in: ["role-de", "role-permit", "role-ic"] } },
      orderBy: [{ tabId: "asc" }, { sortOrder: "asc" }],
      select: { id: true, tabId: true, title: true },
    });
    console.log("\n[verify] tabs:");
    for (const t of finalTabs) console.log(`  - ${t.id} | ${t.label}`);
    console.log("[verify] sections:");
    let cur = "";
    for (const s of finalSections) {
      if (s.tabId !== cur) {
        console.log(`  [${s.tabId}]`);
        cur = s.tabId;
      }
      console.log(`    - ${s.id} | ${s.title}`);
    }
  });

  console.log(`\n[done] ${DRY ? "(dry run — nothing committed)" : "committed"}`);
  await prisma.$disconnect();
})();
