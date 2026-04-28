/**
 * Seed the "Drafts" SOP tab — admin-only working drafts of new content.
 *
 * Why this exists:
 *   - Lets us write substantial new SOP content (PM Guide rewrite, Pipeline
 *     Overview, etc.) and put it in front of admins for review BEFORE
 *     promoting it over the live content.
 *   - Compare side-by-side: leave the original tab unchanged, look at the
 *     draft tab next to it, decide what gets promoted.
 *
 * Access:
 *   The "drafts" tab id is intentionally NOT in PUBLIC_TABS or
 *   TAB_ROLE_GATES in src/lib/sop-access.ts. Unknown tabs default to
 *   admin/owner/executive only — see canAccessTab() line ~213.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-drafts.ts
 *   source .env && npx tsx scripts/seed-sop-drafts.ts --force   # overwrite content
 *
 * Idempotent.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "drafts";
const TAB_LABEL = "Drafts";
const TAB_SORT = 99;

// =============================================================================
// README / landing
// =============================================================================

const README = `
<h1>Drafts — Working Content for Review</h1>

<div class="info">
This tab is <strong>admin/owner/executive only</strong>. It holds new SOP content that hasn't been promoted to the live guide yet — drop drafts here, compare them to the originals, then promote the ones we want.
</div>

<h2>What's in here right now</h2>

<table>
<thead><tr><th>Draft</th><th>Replaces / Adds</th><th>Status</th></tr></thead>
<tbody>
<tr><td><a href="#" data-sop-link="draft-pipeline-overview">Pipeline Overview (Plain English)</a></td><td>NEW — adds a top-level walkthrough to the Project Pipeline tab</td><td>For review</td></tr>
<tr><td><a href="#" data-sop-link="draft-pm-overview">PM Guide (Rewrite)</a> — 7 sections</td><td>Replaces the year-old PM Guide tab</td><td>For review</td></tr>
</tbody>
</table>

<h2>How to compare</h2>

<ol>
<li>Open the live tab in one browser tab (e.g. <code>/sop?tab=pm</code>)</li>
<li>Open the matching Drafts entry here in another (e.g. <code>/sop?tab=drafts</code>)</li>
<li>Flip between them, leave suggestions/edits using the Edit button on either side</li>
</ol>

<h2>Promotion process</h2>

<p>Once a draft is approved, the engineering side runs a one-line promotion:</p>

<ul>
<li><strong>PM Guide rewrite</strong> → drafts get copied into the existing <code>/sop?tab=pm</code> sections, replacing the year-old content. Old sections (e.g. "Schedule Site Survey", "Submit Permit") are deleted.</li>
<li><strong>Pipeline Overview</strong> → draft is moved to the top of the Project Pipeline tab as a new section.</li>
<li><strong>This Drafts tab</strong> stays around as a workspace — empty until the next batch of new content lands.</li>
</ul>

<div class="tip">If a draft needs changes, click <strong>Edit</strong> in the top right of the section. The change saves directly to the draft (you're an admin) and doesn't affect the live SOPs at all.</div>
`;

// =============================================================================
// Pipeline Overview — plain English, all 13 stages, sourced from Sheet 1
// =============================================================================

const PIPELINE_OVERVIEW = `
<h1>Project Pipeline — Plain English Walkthrough</h1>
<p class="subtitle">How a deal moves from sale to PTO at PB. One pass, no jargon, ~10 minute read.</p>

<div class="summary">
<strong>Who this is for:</strong> Anyone at PB — sales, operations, design, permitting, accounting, leadership — who wants to understand how a project actually flows from contract signature through final utility approval. Each stage tells you <em>what happens, who owns it, and what triggers the handoff to the next stage</em>. Deeper procedure docs are linked where relevant.
</div>

<h2>The 13 Stages at a Glance</h2>

<div class="card">
<table>
<thead><tr><th>#</th><th>Stage</th><th>Owner</th><th>Triggers next stage</th></tr></thead>
<tbody>
<tr><td>1</td><td>Sale &amp; Signatures</td><td>Sales Rep (Deal Owner)</td><td>Contract signed → deal moves to Closed Won → flips into Project pipeline</td></tr>
<tr><td>2</td><td>Site Survey Scheduling</td><td>Sales (Deal Owner / Sales coordinator)</td><td>Survey time slot booked in <code>/dashboards/site-survey-scheduler</code></td></tr>
<tr><td>3</td><td>Site Survey</td><td>Survey Tech (assigned by scheduler, by office)</td><td>Survey marked complete in Zuper → deal advances to Design &amp; Engineering</td></tr>
<tr><td>4</td><td>Design Review</td><td>Ops + Design (joint meeting)</td><td>Notes captured, change orders triggered if needed, design proceeds</td></tr>
<tr><td>5</td><td>Design &amp; Engineering</td><td>Design Lead + Designer</td><td>Construction planset drafted, reviewed, ready for DA</td></tr>
<tr><td>6</td><td>Design Approval (DA)</td><td>Design Lead → Sales Rep → Customer</td><td>Customer signs PandaDoc → deal advances to Permitting &amp; Interconnection</td></tr>
<tr><td>7</td><td>Permitting</td><td>Permit Lead — <strong>Peter</strong> (CO) / <strong>Kristofer</strong> (CA)</td><td>Permit Issued → contributes to RTB gate</td></tr>
<tr><td>8</td><td>Interconnection</td><td>IC Lead — <strong>Peter</strong> (CO) / varies (CA)</td><td>Application Approved → contributes to RTB gate</td></tr>
<tr><td>9</td><td>Ready to Build (RTB)</td><td>System (automation gate)</td><td>Permit Issued + IC Approved + DA Invoice Paid → deal advances to Construction</td></tr>
<tr><td>10</td><td>Construction</td><td>PM (scheduler) → Install Crew</td><td>Zuper construction-complete checklist submitted → deal advances to Inspection</td></tr>
<tr><td>11</td><td>Plan Revisions (Site)</td><td>Ops Director (Drew, Joe, or Ro)</td><td>If install changes are needed, ops marks via Zuper checklist → revision routes back through design/permit</td></tr>
<tr><td>12</td><td>Inspection</td><td>Inspections Tech + QC (Dan or Chad)</td><td>Final inspection pass → deal advances to PTO</td></tr>
<tr><td>13</td><td>PTO + Closeout</td><td>PM</td><td>Utility grants Permission to Operate → PM closes deal + sends customer closeout packet</td></tr>
</tbody>
</table>
</div>

<h2>1. Sale &amp; Signatures</h2>

<p>The Sales Rep (called the <strong>Deal Owner</strong> in HubSpot) closes the deal. When the proposal is signed in PandaDoc and the contract follows, both documents auto-upload to the Sales folder in Google Drive and the deal moves to <strong>Closed Won</strong>.</p>

<p>The Deal Owner completes the <strong>presale checklist</strong> — most fields auto-fill from OpenSolar and a correctly-created HubSpot deal, so this is usually a fast verify-and-confirm step rather than data entry.</p>

<div class="info"><strong>Handoff to ops:</strong> Once the deal is Closed Won, it flips from the Sales pipeline into the Project pipeline at the Site Survey stage. From this point, the Deal Owner stays involved as the customer-facing point of contact through Construction, but operational ownership shifts.</div>

<h2>2. Site Survey Scheduling</h2>

<p>Sales schedules the survey using <code>/dashboards/site-survey-scheduler</code>. Slots are <strong>per PB office</strong>, not per surveyor — the scheduler tool assigns whichever tech is available from that office's pool. Each office is capped at <strong>3 surveys per day</strong> to keep utilization realistic.</p>

<p>The deal stays in the <strong>Site Survey</strong> stage until the survey is actually performed. If the survey gets pushed (customer reschedules, weather, etc.), the slot is released and a new one is booked.</p>

<div class="tip">PMs <em>do not</em> schedule surveys. If you're a PM and the survey isn't on the calendar, ping the Deal Owner — that's their lane.</div>

<h2>3. Site Survey</h2>

<p>There are no fixed surveyors-per-region. The scheduler assigns whichever Survey Tech is available out of the pool serving that office. The assigned tech goes on-site, captures the system specs (roof, electrical, shade, etc.), and submits the <strong>Site Survey Complete</strong> checklist in Zuper.</p>

<p>The Zuper checklist completion automatically:</p>
<ul>
<li>Syncs Site Survey Status to "Completed" in HubSpot</li>
<li>Calculates "Time from Sale to Survey Completion"</li>
<li>Advances the deal stage to <strong>Design &amp; Engineering</strong></li>
</ul>

<p>If the surveyor flags a sales change (e.g. system size needs to drop, the customer wants a different module, panel placement no longer fits) they tag <em>"sales change needed"</em> in Zuper. That kicks the work back to the Deal Owner before design can proceed.</p>

<h2>4. Design Review (Ops + Design Meeting)</h2>

<p>Before designers start drawing, Ops and Design meet to review the deal: what was sold, what the survey found, and what the planset should reflect. This is where most change orders surface — discrepancies between what Sales sold and what Survey found get caught here.</p>

<p>The notes from this meeting are what the PM team uses for <strong>downstream scheduling</strong>: difficulty rating, crew count, special equipment needs, etc.</p>

<h2>5. Design &amp; Engineering</h2>

<p>The drafting partner (Vishtik) generates the construction planset. Internally:</p>
<ul>
<li>Vishtik tasks 1–2 retrieve project details and upload the initial design</li>
<li>The Design Lead reviews and either passes it through or kicks it back</li>
<li>When it's clean, Design Status flips to <strong>"Draft Complete — Waiting on Approvals"</strong></li>
</ul>

<p>If the design needs <strong>engineering stamps</strong>, Vishtik tasks 5–6 handle that and produce the stamped planset. If not, the deal proceeds straight to Permitting once the DA is approved.</p>

<h2>6. Design Approval (DA)</h2>

<p>The Design Lead sends the customer-facing DA via PandaDoc. The customer either signs (deal advances) or rejects (deal kicks back to Design with revisions noted).</p>

<p>The Sales Rep is responsible for chasing the DA signature — they're the customer-facing person up through Construction. PMs and Designers don't touch the customer at this stage.</p>

<div class="info"><strong>What about DA revisions?</strong> If the customer rejects, the Designer makes the revision and the Sales Rep re-sends. Sales Reps get a HubSpot task whenever a DA needs their attention.</div>

<h2>7. Permitting</h2>

<p>Once the planset is stamped (or DA-only-approved for stamp-not-required AHJs), the <strong>Permit Lead</strong> submits to the AHJ:</p>

<ul>
<li>Colorado: <strong>Peter</strong></li>
<li>California: <strong>Kristofer</strong></li>
</ul>

<p>The Permit Lead handles the entire AHJ submission and follow-up. PMs and the Sales Rep <em>do not</em> submit permits. When the permit is issued, the Permit Lead manually marks <code>Permitting Status = Permit Issued</code> in HubSpot — that flips the automation:</p>

<ul>
<li>Permit Issue Date is set</li>
<li>Time-to-Permit is calculated</li>
<li>Customer gets a Permit Status Update SMS + email automatically</li>
</ul>

<h2>8. Interconnection</h2>

<p>The <strong>IC Lead</strong> handles the utility interconnection application — same person handles permits in CO (Peter), but the IC owner can vary in California depending on the utility.</p>

<p>For Xcel Energy in Colorado, the IC application is submitted at the start of the project, so by the time we get to this stage it's usually already approved. For other utilities, the IC application is submitted now.</p>

<p>When the utility approves the application, the IC Lead manually marks <code>Interconnection Status = Application Approved</code>.</p>

<h2>9. Ready to Build (RTB)</h2>

<p>RTB is an automated gate, not a stage anyone has to "do." When all three of these are true, the deal moves to <strong>Ready to Build</strong>:</p>

<ol>
<li>Permitting Status = Permit Issued</li>
<li>Interconnection Status = Application Approved</li>
<li>DA Invoice = Paid</li>
</ol>

<p>If any one is missing, the deal goes to <strong>RTB — Blocked</strong> and shows up on the action queues. Whoever owns the missing piece is responsible for unblocking.</p>

<h2>10. Construction</h2>

<p>The PM schedules construction in <code>/dashboards/scheduler</code> (or the construction-specific view at <code>/dashboards/construction-scheduler</code>). Once scheduled:</p>

<ul>
<li>The Zuper job is created automatically with the right crew</li>
<li>A Google Calendar event is created on the install calendar for that office</li>
<li>The crew lead and Operations Manager get email notifications</li>
</ul>

<p>The crew installs the system. When complete, the lead submits the <strong>Construction Complete checklist</strong> in Zuper. That advances the deal to Inspection automatically.</p>

<h2>11. Plan Revisions (Site Changes during Install)</h2>

<p>Sometimes the field finds something the design didn't anticipate — a different roof condition, a panel that won't fit, an electrical issue. The Ops Director (<strong>Drew, Joe, or Ro</strong> depending on the install) marks the change in the Zuper construction-complete checklist.</p>

<p>That triggers a revision workflow: Design updates the planset, Permit Lead files an as-built revision with the AHJ if needed, and the deal continues to inspection once everything's reconciled.</p>

<h2>12. Inspection</h2>

<p>The Inspections Tech runs the final inspection. <strong>Dan or Chad</strong> creates the QC tasks ahead of the inspection date.</p>

<ul>
<li><strong>If it passes:</strong> deal automatically advances to PTO</li>
<li><strong>If it fails:</strong> the inspections lead marks the failure reason in the Zuper inspection-fail checklist, which triggers the corrective workflow</li>
</ul>

<div class="warn">Failed inspections are a project-aging risk — they often involve a rework site visit, a re-inspection fee, and a customer who's already waited weeks. Watch the inspection action queues for stalls.</div>

<h2>13. PTO + Closeout</h2>

<p>The PM owns this final stretch:</p>

<ol>
<li><strong>Permission to Operate (PTO)</strong> — the utility grants the system permission to actually generate. The PM confirms PTO and updates HubSpot.</li>
<li><strong>Close the deal</strong> in HubSpot — final stage, all milestones done.</li>
<li><strong>Send the closeout packet</strong> to the customer — system manuals, warranty info, monitoring login, "what to do if your panels stop generating," etc.</li>
<li><strong>Hand to Service</strong> — if the system is under any active service plan or has known follow-up items, the PM hands those to the Service team.</li>
</ol>

<h2>Cross-Pipeline Notes</h2>

<h3>The Sales Rep's involvement after Closed Won</h3>
<p>The Sales Rep (Deal Owner) <strong>stays involved as the customer-facing contact</strong> from sale through Construction. They:</p>
<ul>
<li>Handle DA signature chasing</li>
<li>Handle change-order conversations with the customer</li>
<li>Get tasks whenever a DA revision needs customer attention</li>
</ul>
<p>The PM only takes over customer comms at Construction scheduling and PTO/Closeout.</p>

<h3>D&amp;R (Detach &amp; Reset) and Roofing</h3>
<p>Projects that need a roof replacement before solar install run through the <strong>D&amp;R pipeline</strong> in parallel. Standalone roofing-only jobs run through the Roofing pipeline. Both are out of scope for this overview — see the dedicated D&amp;R + Roofing suite for those flows.</p>

<h3>Service tickets</h3>
<p>After PTO + Closeout, any future customer issue (warranty claim, monitoring problem, equipment failure) becomes a <strong>service ticket</strong> in the Service pipeline. That's a different lifecycle entirely.</p>
`;

// =============================================================================
// PM Guide (Rewrite) — 7 sections, anchored in what PMs actually do today
// =============================================================================

const DRAFT_PM_OVERVIEW = `
<h1>PM Guide — What PMs Actually Do</h1>
<p class="subtitle">Rewritten 2026-04-27. The previous PM Guide was a year old and described work PMs no longer own.</p>

<div class="summary">
<strong>The PM job in one sentence:</strong> intake the deal cleanly from Sales, schedule construction, monitor everything in between, and close the project out with the customer when PTO lands.
</div>

<h2>What PMs Do</h2>

<table>
<thead><tr><th>#</th><th>Activity</th><th>Where</th></tr></thead>
<tbody>
<tr><td>1</td><td><strong>Deal Intake &amp; Review</strong> — verify the handoff from Sales is clean before the project starts moving</td><td>HubSpot deal record</td></tr>
<tr><td>2</td><td><strong>Schedule Construction</strong> — the heart of the role. Pick the date, crew, and equipment.</td><td><code>/dashboards/scheduler</code> · <code>/dashboards/construction-scheduler</code></td></tr>
<tr><td>3</td><td><strong>PTO Confirmation</strong> — work with the utility-side info, mark PTO in HubSpot when granted</td><td>HubSpot</td></tr>
<tr><td>4</td><td><strong>Closeout</strong> — close the deal, send the customer their closeout packet</td><td>HubSpot · email</td></tr>
<tr><td>5</td><td><strong>Monitor everything else</strong> — watch the deal as it moves through Survey → Design → DA → Permitting → IC → Construction → Inspection. Escalate stalls to whoever owns that stage.</td><td>Action queues, HubSpot, this guide</td></tr>
</tbody>
</table>

<h2>What PMs Don't Do (Anymore)</h2>

<div class="warn">
The previous version of this guide had PMs scheduling surveys, submitting permits, and submitting interconnection applications. <strong>None of that is the PM's job today.</strong> Each piece is owned by someone else now:
</div>

<table>
<thead><tr><th>Used to be PM</th><th>Now owned by</th></tr></thead>
<tbody>
<tr><td>Schedule the site survey</td><td><strong>Sales</strong> (Deal Owner / Sales coordinator) using <code>/dashboards/site-survey-scheduler</code></td></tr>
<tr><td>Submit the building permit to the AHJ</td><td><strong>Permit Lead</strong> — Peter (CO) / Kristofer (CA)</td></tr>
<tr><td>Submit the utility interconnection application</td><td><strong>IC Lead</strong> — Peter (CO) / varies (CA)</td></tr>
<tr><td>Send the Design Approval PandaDoc to the customer</td><td><strong>Design Lead → Sales Rep</strong></td></tr>
<tr><td>Handle install plan revisions during construction</td><td><strong>Ops Director</strong> — Drew, Joe, or Ro</td></tr>
<tr><td>Run final inspections / create QC tasks</td><td><strong>Inspections Tech</strong> + QC (Dan or Chad)</td></tr>
</tbody>
</table>

<h2>How to use this guide</h2>

<p>Use the sidebar to jump to the stage that matters. Each section says: <em>what to verify, what to watch, and who to escalate to.</em> Keep this open in a tab while you're working through the day's action queue.</p>

<p>For the full project lifecycle (including the work other teams do), see <a href="#" data-sop-link="draft-pipeline-overview">the Pipeline Overview</a>.</p>
`;

const DRAFT_PM_INTAKE = `
<h1>1. Deal Intake &amp; Review</h1>
<p class="subtitle">Verify the handoff from Sales is clean before the project starts moving.</p>

<div class="summary">
<strong>Goal:</strong> by the end of intake, you should be able to answer "does this deal have everything Operations needs to execute?" If yes, let it flow. If no, kick it back to the Deal Owner with specifics.
</div>

<h2>Trigger</h2>
<p>Deal hits Closed Won and flips into the Project pipeline at the Site Survey stage. Sales has scheduled (or is scheduling) the survey. You'll see the new project in the standard PM intake queue.</p>

<h2>Intake Checklist</h2>

<p>Most of these auto-populate from OpenSolar and a correctly-created HubSpot deal — your job is to verify, not data-enter.</p>

<h3>Deal record basics</h3>
<ul class="pm-checklist">
<li>Deal name follows the standard format: <code>PROJ-XXXX | Last, First | Address</code></li>
<li>Deal Owner = the actual selling rep</li>
<li>Pipeline = Project; current stage = Site Survey</li>
<li>Install Location set (one of: Westy, DTC/Centennial, COSP, Camarillo/SLO)</li>
<li>System specs populated: kW DC, module model + count, inverter model, battery model (if applicable)</li>
</ul>

<h3>Customer / contacts</h3>
<ul class="pm-checklist">
<li>Homeowner's contact record exists and is associated to the deal</li>
<li>Person responsible for payment is labeled <strong>Payor</strong></li>
<li>If the system is loan-financed: the person on the loan is labeled <strong>Payor</strong> + <strong>Loan Applicant</strong>; the loan provider is associated as a contact and labeled <strong>Payor</strong></li>
</ul>

<h3>Documents in Google Drive</h3>
<ul class="pm-checklist">
<li>Signed proposal and signed contract are in the deal's Sales folder (auto-uploads from PandaDoc — verify they're actually there)</li>
<li>Any addenda or change-order documents are in the same folder</li>
</ul>

<h3>Payment type</h3>
<ul class="pm-checklist">
<li>Open the proposal "Quotation" page (typically page 11). Confirm cash vs loan.</li>
<li>The Accounting section in HubSpot matches that payment type</li>
<li>If loan: financing approval is uploaded to Drive</li>
</ul>

<h2>If something is missing</h2>

<div class="warn">
Don't fix Sales's work for them. Tag the Deal Owner in HubSpot with a note explaining what's missing and what needs to happen. Track stuck intake in the standard PM action queue.
</div>

<p>Common kickbacks:</p>
<ul>
<li><strong>Missing Payor designation</strong> → Deal Owner needs to update HubSpot contact roles</li>
<li><strong>System specs blank or "TBD"</strong> → Sales needs to finalize before survey</li>
<li><strong>Loan provider not linked</strong> → Sales needs to associate the contact</li>
</ul>

<h2>Once intake is clean</h2>

<p>Step back. The next thing you'll need to act on is <a href="#" data-sop-link="draft-pm-construction">scheduling construction</a>, which won't happen for weeks. In the meantime, you're in <a href="#" data-sop-link="draft-pm-monitor-sales-design">monitoring mode</a>.</p>
`;

const DRAFT_PM_MONITOR_SALES_DESIGN = `
<h1>2. Monitoring Sales &amp; Design</h1>
<p class="subtitle">Survey, Design Meeting, Design &amp; Engineering, Design Approval — you're not driving these, but you are watching.</p>

<div class="summary">
<strong>Your role here:</strong> nothing day-to-day except making sure things are progressing. If a deal sits in any of these stages too long, escalate to whoever owns it.
</div>

<h2>Stages you're monitoring</h2>

<table>
<thead><tr><th>Stage</th><th>Who's driving</th><th>Watch for</th></tr></thead>
<tbody>
<tr><td>Site Survey</td><td>Survey Tech</td><td>Survey scheduled? Survey performed on the booked date? Sales-change-needed flags from the surveyor</td></tr>
<tr><td>Design Review meeting</td><td>Ops + Design</td><td>Did the meeting happen? Were change orders flagged?</td></tr>
<tr><td>Design &amp; Engineering</td><td>Design Lead + Designer (Vishtik)</td><td>Planset drafted within 3–5 business days? Stuck on engineering stamps?</td></tr>
<tr><td>Design Approval (DA)</td><td>Design Lead → Sales Rep → Customer</td><td>DA sent to customer? Customer signed? Revisions in flight?</td></tr>
</tbody>
</table>

<h2>What "stalled" looks like</h2>

<p>Use the action queues to surface stalls — don't try to track this by clicking through individual deals. Reasonable thresholds:</p>

<ul>
<li><strong>Site Survey</strong> — booked but not performed within 2 days of the slot date</li>
<li><strong>Design</strong> — &gt; 5 business days in "Retrieve Project Details" without movement</li>
<li><strong>DA</strong> — sent &gt; 5 business days without customer action</li>
</ul>

<h2>Who to escalate to</h2>

<table>
<thead><tr><th>If stalled at…</th><th>Escalate to</th></tr></thead>
<tbody>
<tr><td>Survey not scheduled</td><td><strong>Deal Owner</strong> (Sales)</td></tr>
<tr><td>Survey scheduled but not performed</td><td><strong>Operations Manager for that office</strong> (techs are assigned out of a pool, not by name — go to the manager who runs the pool)</td></tr>
<tr><td>Design Meeting didn't happen</td><td><strong>Design Lead</strong> + Ops Director</td></tr>
<tr><td>Designer stuck</td><td><strong>Design Lead</strong></td></tr>
<tr><td>DA not signed by customer</td><td><strong>Sales Rep / Deal Owner</strong> — they own the customer relationship</td></tr>
<tr><td>DA revision stalled</td><td><strong>Designer</strong> — they make the revision; <strong>Sales Rep</strong> re-sends</td></tr>
</tbody>
</table>

<h2>What you should NOT do</h2>

<div class="warn">
You don't schedule the survey. You don't write the design. You don't email the customer about the DA. The previous PM Guide had PMs in all of these — they're not your job anymore. If someone asks why you "aren't fixing it," explain who owns it and help connect them.
</div>

<h2>Tools</h2>
<ul>
<li><code>/dashboards/de-overview</code> — Design &amp; Engineering pipeline state</li>
<li><code>/dashboards/design-revisions</code> — DA revision queue</li>
<li><code>/dashboards/at-risk</code> — at-risk projects across all stages</li>
</ul>
`;

const DRAFT_PM_MONITOR_PI = `
<h1>3. Monitoring Permitting &amp; Interconnection</h1>
<p class="subtitle">Permit Lead and IC Lead drive these. You watch dates and escalate stalls.</p>

<div class="summary">
<strong>Your role here:</strong> same as Design — make sure things are progressing. The Permit Lead and IC Lead handle submissions, AHJ correspondence, and utility follow-up. You're a backstop.
</div>

<h2>Who owns what</h2>

<table>
<thead><tr><th>Stage</th><th>Owner — CO</th><th>Owner — CA</th></tr></thead>
<tbody>
<tr><td>Permit submission to AHJ</td><td><strong>Peter</strong></td><td><strong>Kristofer</strong></td></tr>
<tr><td>AHJ correspondence (RFIs, revisions)</td><td><strong>Peter</strong></td><td><strong>Kristofer</strong></td></tr>
<tr><td>Marking <code>Permitting Status = Permit Issued</code></td><td><strong>Peter</strong></td><td><strong>Kristofer</strong></td></tr>
<tr><td>Interconnection submission</td><td><strong>Peter</strong></td><td>Varies by utility</td></tr>
<tr><td>Marking <code>Interconnection Status = Application Approved</code></td><td><strong>Peter</strong></td><td>IC owner per utility</td></tr>
</tbody>
</table>

<h2>What to watch</h2>

<ul>
<li><strong>Time in Permitting</strong> — if the AHJ is slow, that's the AHJ; if we haven't submitted yet, that's a real stall</li>
<li><strong>RFIs from the AHJ</strong> — Permit Lead handles, but you should know the deal is paused until resolved</li>
<li><strong>Interconnection — Xcel deals</strong> — IC apps for Xcel are submitted at the start of the project, so by this stage they should already be approved. If not, escalate to Peter.</li>
<li><strong>Interconnection — non-Xcel</strong> — varies wildly by utility. Some utilities take 30+ days. The IC action queue surfaces aging.</li>
</ul>

<h2>The RTB Gate</h2>

<p>Once permits and IC both clear, the system automatically advances the deal to <strong>Ready to Build</strong> — but only if all three of these are true:</p>

<ol>
<li>Permitting Status = Permit Issued</li>
<li>Interconnection Status = Application Approved</li>
<li>DA Invoice = Paid</li>
</ol>

<p>If any one is missing, the deal sits in <strong>RTB — Blocked</strong>. Whoever owns the missing piece needs to clear it. If the DA invoice is the blocker, that's an Accounting follow-up — surface it in the next standup.</p>

<h2>Tools</h2>
<ul>
<li><code>/dashboards/permitting</code> — permitting pipeline state</li>
<li><code>/dashboards/interconnection</code> — IC pipeline state</li>
<li><code>/dashboards/pi-action-queue</code> — combined permitting + IC action queue</li>
<li><code>/dashboards/at-risk</code> — anything aging across the pipeline</li>
</ul>
`;

const DRAFT_PM_CONSTRUCTION = `
<h1>4. Schedule Construction</h1>
<p class="subtitle">The heart of the PM job. Pick the date, the crew, and confirm the equipment is in place.</p>

<div class="summary">
<strong>Trigger:</strong> deal advances to Ready to Build (RTB). RTB-Blocked deals shouldn't be scheduled — get them unblocked first.
</div>

<h2>Tool</h2>
<p>Use <code>/dashboards/scheduler</code> for the unified scheduling view, or <code>/dashboards/construction-scheduler</code> for the construction-only view with crew availability and capacity heatmaps.</p>

<h2>Pre-schedule checks</h2>

<ul class="pm-checklist">
<li>Permit issued (you're past RTB if you got here, but double-check)</li>
<li>IC application approved (same)</li>
<li>DA invoice paid (same)</li>
<li>Materials in inventory or PO confirmed for the install date — check the BOM line items in HubSpot</li>
<li>Crew availability for the install location and install size</li>
<li>Customer is reachable and has confirmed the date</li>
</ul>

<h2>Scheduling</h2>

<ol>
<li>Open the scheduler. Filter by install location.</li>
<li>Pick a date with crew availability. The capacity heatmap shows green / yellow / red for each office.</li>
<li>Assign the crew based on the install size and any special equipment needs (battery installs, EV chargers, complex roofs).</li>
<li>Save the schedule. The system auto-creates:
  <ul>
    <li>A Zuper job with the correct crew and Job Category</li>
    <li>A Google Calendar event on the install calendar for that office</li>
    <li>Email notifications to the crew lead and the Operations Manager</li>
  </ul>
</li>
<li>Send the customer a scheduling confirmation (email template handled by the system; verify it sent).</li>
</ol>

<div class="tip">
The Zuper API <strong>only allows setting the assigned crew at job creation time</strong>. If you need to change the crew after the job is created, you have to delete and recreate the Zuper job. Avoid by getting the crew assignment right the first time.
</div>

<h2>Office-specific notes</h2>

<table>
<thead><tr><th>Office</th><th>Calendar bucket</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Westminster</td><td>Westy install calendar</td><td>—</td></tr>
<tr><td>DTC / Centennial</td><td>DTC install calendar</td><td>—</td></tr>
<tr><td>Colorado Springs</td><td>COSP install calendar</td><td>—</td></tr>
<tr><td>Camarillo / SLO</td><td>California install calendar (shared)</td><td>SLO and Camarillo intentionally share one calendar — do not split</td></tr>
</tbody>
</table>

<h2>If you need to reschedule</h2>

<p>Customer reschedules happen. The scheduler supports rescheduling; the Zuper job and calendar event move with it. If the new date pushes the crew assignment past their availability, swap the crew before saving.</p>

<p>If a reschedule pushes the install &gt; 30 days from the original date, the deal may need to re-verify pre-schedule conditions (e.g. permit hasn't expired, DA invoice still applicable). Check before saving.</p>
`;

const DRAFT_PM_MONITOR_BUILD = `
<h1>5. Monitoring Construction → Inspections</h1>
<p class="subtitle">The crew installs. Ops handles plan revisions. Inspections Tech handles the final inspection. You watch.</p>

<div class="summary">
<strong>Your role here:</strong> after you've scheduled construction, the build itself isn't your job. You watch progress and escalate if something stalls.
</div>

<h2>During construction</h2>

<p>The crew lead runs the install. When the install is complete, they submit the <strong>Construction Complete checklist</strong> in Zuper. That automatically advances the deal to Inspection.</p>

<h2>If something changes during install</h2>

<div class="info">
The Ops Director (<strong>Drew, Joe, or Ro</strong> depending on the install) handles plan revisions during construction. If the field finds something the planset didn't anticipate, the Ops Director marks it via the Zuper construction-complete checklist, which triggers a revision workflow.
</div>

<p>You don't need to do anything — the workflow handles it. Just be aware: a deal that goes into a plan revision will pause at Construction until Design + Permitting (and sometimes the AHJ) reconcile the change.</p>

<h2>Inspection</h2>

<p>The Inspections Tech runs the final inspection. Ahead of the inspection, <strong>Dan or Chad</strong> creates the QC tasks. You don't need to involve yourself unless something goes wrong.</p>

<h3>If inspection passes</h3>
<p>Deal automatically advances to PTO. <a href="#" data-sop-link="draft-pm-pto">See PTO →</a></p>

<h3>If inspection fails</h3>
<p>The Inspections Lead marks the failure reason in the Zuper inspection-fail checklist. That triggers the corrective workflow:</p>
<ul>
<li>If it's a workmanship issue → corrective install task assigned</li>
<li>If it's a planset issue → kicks back to Design / Permitting</li>
<li>If it's an AHJ-specific quirk → Permit Lead handles AHJ correspondence</li>
</ul>

<div class="warn">
Failed inspections are a project-aging risk. They typically involve a rework site visit, a re-inspection fee, and a customer who's been waiting weeks. Watch <code>/dashboards/inspections</code> for stalled-on-failure projects and surface them at standup.
</div>

<h2>Tools</h2>
<ul>
<li><code>/dashboards/construction</code> — construction in flight</li>
<li><code>/dashboards/inspections</code> — inspection state across all deals</li>
<li><code>/dashboards/at-risk</code> — at-risk projects regardless of stage</li>
</ul>
`;

const DRAFT_PM_PTO = `
<h1>6. PTO (Permission to Operate)</h1>
<p class="subtitle">Utility grants the system permission to actually generate. PM confirms and updates HubSpot.</p>

<div class="summary">
<strong>Trigger:</strong> inspection passed, system installed, paperwork submitted to the utility for PTO. The utility comes back with a PTO approval (sometimes by email, sometimes via portal, sometimes by mail — varies by utility).
</div>

<h2>What you do</h2>

<ol>
<li><strong>Verify PTO</strong> — confirm the utility approval is real (PTO email, portal screenshot, or letter). Save the document to the deal's Drive folder.</li>
<li><strong>Update HubSpot</strong>:
  <ul>
    <li>Set <code>PTO Status = Granted</code></li>
    <li>Set the PTO Date</li>
    <li>Verify the PTO invoice has been triggered (Accounting picks this up automatically when PTO Status flips)</li>
  </ul>
</li>
<li><strong>Notify the customer</strong> — the system sends a templated PTO email + SMS automatically when the status flips. Verify it sent.</li>
</ol>

<h2>By utility</h2>

<table>
<thead><tr><th>Utility</th><th>How PTO arrives</th><th>Typical lag from inspection pass</th></tr></thead>
<tbody>
<tr><td>Xcel Energy (CO)</td><td>Email from the dedicated Xcel solar inbox</td><td>1–3 business days</td></tr>
<tr><td>CSU (Colorado Springs Utilities)</td><td>Portal status update + email</td><td>2–5 business days</td></tr>
<tr><td>Mountain View / Estes Park / etc.</td><td>Varies — usually email or letter</td><td>5–10 business days</td></tr>
<tr><td>SCE / PG&amp;E (CA)</td><td>Portal — Permission to Operate notice</td><td>Highly variable; check daily</td></tr>
</tbody>
</table>

<h2>If PTO is taking too long</h2>

<p>If you're &gt; 5 business days past inspection pass and there's no PTO yet, escalate to the IC Lead — they have the utility relationships and the application records.</p>

<h2>Once PTO is granted</h2>

<p>Move directly to <a href="#" data-sop-link="draft-pm-closeout">closeout</a>. Don't let a PTO'd project sit — the customer is waiting on their packet, the closeout invoice triggers from this stage, and Service can't take ownership until the deal is closed.</p>
`;

const DRAFT_PM_CLOSEOUT = `
<h1>7. Closeout</h1>
<p class="subtitle">Close the deal in HubSpot. Send the customer their closeout packet. Hand to Service.</p>

<div class="summary">
<strong>Trigger:</strong> PTO has been granted and the customer's system is generating. Closeout is the final PM responsibility on the project.
</div>

<h2>1. Close the deal in HubSpot</h2>

<ul class="pm-checklist">
<li>Stage = <strong>Complete</strong> in the Project pipeline</li>
<li>All HubSpot date fields populated (Survey, Design Complete, Permit Issue, IC Approve, Construction Complete, Inspection Pass, PTO)</li>
<li>All deal milestones have an associated invoice and payment status</li>
<li>System generation start date set (= PTO Date in most cases)</li>
</ul>

<h2>2. Send the customer closeout packet</h2>

<p>The closeout packet is a templated customer email (or shared Drive link) containing:</p>

<ul>
<li><strong>System manuals</strong> — module, inverter, battery (if applicable), EV charger (if applicable)</li>
<li><strong>Warranty information</strong> — equipment warranties (manufacturer) + workmanship warranty (PB)</li>
<li><strong>Monitoring login</strong> — credentials for the inverter app, instructions to download</li>
<li><strong>"What to do if your system stops generating"</strong> — service contact info, what counts as a real problem vs. a normal weather-driven dip</li>
<li><strong>Tax / incentive paperwork</strong> — final ITC documentation, any state/utility rebate paperwork the customer needs for filing</li>
</ul>

<p>Use the standard closeout email template. Verify the customer received it by checking the HubSpot email log.</p>

<h2>3. Hand to Service</h2>

<p>If the system has any active service plan or known follow-up items (a touch-up needed, a customer-reported concern from inspection, a pending utility process), create the Service ticket and assign to the Service team. Otherwise the deal is fully done.</p>

<h2>4. Final HubSpot updates</h2>

<ul class="pm-checklist">
<li>Closeout email logged in deal timeline</li>
<li>Closeout packet attached to deal record</li>
<li>Any active service items linked to a Service ticket</li>
<li>Internal notes capturing anything notable for future reference (difficult AHJ, picky customer, equipment quirk, etc.)</li>
</ul>

<h2>That's the project</h2>

<div class="tip">After closeout, the deal stops appearing on PM action queues. If a customer comes back with a service issue 6 months later, that's the Service team's lane via a new Service pipeline ticket — not a reopening of this deal.</div>
`;

// =============================================================================
// Sections list
// =============================================================================

const SECTIONS = [
  // Drafts intro
  {
    id: "draft-readme",
    group: "About",
    title: "Drafts — Read Me First",
    color: "amber",
    order: 0,
    content: README,
  },
  // Pipeline Overview
  {
    id: "draft-pipeline-overview",
    group: "Pipeline Overview (Plain English)",
    title: "Project Pipeline Walkthrough",
    color: "blue",
    order: 10,
    content: PIPELINE_OVERVIEW,
  },
  // PM Guide rewrite
  {
    id: "draft-pm-overview",
    group: "PM Guide (Rewrite)",
    title: "What PMs Actually Do",
    color: "orange",
    order: 20,
    content: DRAFT_PM_OVERVIEW,
  },
  {
    id: "draft-pm-intake",
    group: "PM Guide (Rewrite)",
    title: "1. Deal Intake & Review",
    color: "green",
    order: 21,
    content: DRAFT_PM_INTAKE,
  },
  {
    id: "draft-pm-monitor-sales-design",
    group: "PM Guide (Rewrite)",
    title: "2. Monitoring Sales & Design",
    color: "blue",
    order: 22,
    content: DRAFT_PM_MONITOR_SALES_DESIGN,
  },
  {
    id: "draft-pm-monitor-pi",
    group: "PM Guide (Rewrite)",
    title: "3. Monitoring Permitting & IC",
    color: "blue",
    order: 23,
    content: DRAFT_PM_MONITOR_PI,
  },
  {
    id: "draft-pm-construction",
    group: "PM Guide (Rewrite)",
    title: "4. Schedule Construction",
    color: "purple",
    order: 24,
    content: DRAFT_PM_CONSTRUCTION,
  },
  {
    id: "draft-pm-monitor-build",
    group: "PM Guide (Rewrite)",
    title: "5. Monitor Construction → Inspections",
    color: "purple",
    order: 25,
    content: DRAFT_PM_MONITOR_BUILD,
  },
  {
    id: "draft-pm-pto",
    group: "PM Guide (Rewrite)",
    title: "6. PTO",
    color: "teal",
    order: 26,
    content: DRAFT_PM_PTO,
  },
  {
    id: "draft-pm-closeout",
    group: "PM Guide (Rewrite)",
    title: "7. Closeout",
    color: "teal",
    order: 27,
    content: DRAFT_PM_CLOSEOUT,
  },
];

// =============================================================================
// Seed
// =============================================================================

async function main() {
  const existingTab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!existingTab) {
    await prisma.sopTab.create({
      data: { id: TAB_ID, label: TAB_LABEL, sortOrder: TAB_SORT },
    });
    console.log(`Created tab: ${TAB_ID} (${TAB_LABEL})`);
  } else {
    console.log(`Tab "${TAB_ID}" already exists.`);
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
