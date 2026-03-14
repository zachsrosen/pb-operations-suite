/**
 * Seed SOP Reference tab: "What Does This Status Mean?"
 *
 * Adds a Reference tab with a comprehensive status glossary covering
 * all HubSpot status fields, Zuper job statuses, user roles, etc.
 *
 * All status labels are the DISPLAY labels from HubSpot (not internal values),
 * kept in HubSpot dropdown order.
 *
 * Usage:
 *   npx tsx scripts/seed-sop-reference.ts
 *   npx tsx scripts/seed-sop-reference.ts --force                       # Overwrite (dev only)
 *   npx tsx scripts/seed-sop-reference.ts --force --confirm-production  # Overwrite in prod
 *
 * Safety:
 *   - Default mode only INSERTs missing tabs/sections (never overwrites edits)
 *   - --force overwrites content but REFUSES in production unless --confirm-production
 *   - Idempotent: safe to rerun
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Run: source .env && npx tsx scripts/seed-sop-reference.ts");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const CONFIRM_PROD = args.includes("--confirm-production");

if (FORCE && process.env.NODE_ENV === "production" && !CONFIRM_PROD) {
  console.error("ERROR: --force in production requires --confirm-production flag");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tab + section definitions
// ---------------------------------------------------------------------------

const TAB = {
  id: "ref",
  label: "Reference",
  sortOrder: 10,
};

interface SectionDef {
  id: string;
  sidebarGroup: string;
  title: string;
  dotColor: string;
  sortOrder: number;
  content: string;
}

// ---------------------------------------------------------------------------
// HTML content builders
// ---------------------------------------------------------------------------

function statusTable(rows: [string, string][], headers = ["Status", "Description"]): string {
  return `<table class="sop-table">
<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>
${rows.map(([a, b]) => `<tr><td><strong>${a}</strong></td><td>${b}</td></tr>`).join("\n")}
</tbody></table>`;
}

function statusList(items: [string, string][]): string {
  return `<ul>${items.map(([name, desc]) => `<li><strong>${name}</strong> — ${desc}</li>`).join("\n")}</ul>`;
}

function colorDot(hex: string, label: string): string {
  return `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;margin-bottom:4px;"><span style="width:12px;height:12px;border-radius:50%;background:${hex};display:inline-block;"></span><span>${label}</span></span>`;
}

// ---------------------------------------------------------------------------
// Section content — all labels are HubSpot DISPLAY labels, in dropdown order
// ---------------------------------------------------------------------------

const sections: SectionDef[] = [

  // ── 1. Site Survey Status ──
  {
    id: "ref-site-survey-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Site Survey Status",
    dotColor: "blue",
    sortOrder: 100,
    content: `
<h2>Site Survey Status</h2>
<p>HubSpot field: <code>site_survey_status</code> — Tracks the site survey from scheduling through completion.</p>

${statusTable([
  ["Ready to Schedule", "Survey needed but not yet scheduled with the customer."],
  ["Awaiting Reply", "We've reached out to the customer to schedule — waiting for them to respond."],
  ["Scheduled", "Survey date and time confirmed with the customer."],
  ["On Our Way", "Surveyor has been dispatched and is heading to the site."],
  ["Started", "Surveyor is on site and has begun the assessment."],
  ["In Progress", "Survey work is actively underway (roof measurements, electrical panel photos, shading analysis)."],
  ["Needs Revisit", "Survey was done but something was missed or needs a second look — another visit required."],
  ["Completed", "Survey fully complete, data uploaded, ready for design."],
  ["Scheduling On-Hold", "Survey is paused — customer requested delay, weather, or other hold reason."],
  ["No Site Survey Needed", "Survey not required (e.g., existing customer with prior survey data on file)."],
  ["Pending Loan Approval", "Can't schedule until the customer's financing/loan is approved."],
  ["Waiting on Change Order", "Customer requested changes to the deal — survey paused until the change order is finalized."],
])}
`,
  },

  // ── 2. Design Status ──
  {
    id: "ref-design-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Design Status",
    dotColor: "indigo",
    sortOrder: 101,
    content: `
<h2>Design Status</h2>
<p>HubSpot field: <code>design_status</code> — Tracks the engineering design from initial assignment through completion and revisions.</p>

<h3>Standard Flow</h3>
${statusTable([
  ["Ready for Design", "Survey complete, project is in the design queue waiting to be picked up."],
  ["In Progress", "Designer is actively working on the system layout and engineering plans."],
  ["Initial Design Review", "First draft done — design lead is reviewing for errors before stamping."],
  ["Final Review/Stamping", "Design passed initial review, PE is doing final review and stamping."],
  ["Draft Complete - Waiting on Approvals", "Planset drafted, waiting on DA (design approval) from customer."],
  ["Final Design Review", "DA approved by customer — final engineering review before marking complete."],
  ["Submitted To Engineering", "Design sent to external engineering firm for review/stamping."],
  ["Design Complete", "Design is fully done, stamped, and ready for permitting."],
])}

<h3>DA (Design Approval) Revisions</h3>
${statusTable([
  ["Revision Needed - DA Rejected", "Customer rejected the design approval — changes required."],
  ["DA Revision In Progress", "Designer is making changes based on DA rejection feedback."],
  ["DA Revision Completed", "DA revision done, ready to resend for customer approval."],
])}

<h3>Permit Revisions (AHJ Rejected)</h3>
${statusTable([
  ["Revision Needed - Rejected by AHJ", "AHJ (Authority Having Jurisdiction) rejected the permit — design changes needed."],
  ["Permit Revision In Progress", "Designer is revising plans to address AHJ rejection comments."],
  ["Permit Revision Completed", "Permit revision done, ready to resubmit to AHJ."],
])}

<h3>Utility Revisions (IC Rejected)</h3>
${statusTable([
  ["Revision Needed - Rejected by Utility", "Utility rejected the interconnection application — design changes needed."],
  ["Utility Revision In Progress", "Designer is making changes to address utility rejection."],
  ["Utility Revision Completed", "Utility revision done, ready to resubmit to utility."],
])}

<h3>As-Built Revisions</h3>
${statusTable([
  ["Revision Needed - As-Built", "Post-install as-built drawings need updating to match what was actually built."],
  ["As-Built Revision In Progress", "Designer is updating as-built drawings."],
  ["As-Built Revision Completed", "As-built revision done."],
])}

<h3>Clarification / Hold</h3>
${statusTable([
  ["Needs Clarification", "Design is blocked — needs info from someone (unspecified)."],
  ["Needs Clarification from Customer", "Waiting on the customer for information (roof access, tree removal plans, etc.)."],
  ["Needs Clarification from Sales", "Waiting on sales for deal details (system size, adders, financing, etc.)."],
  ["Needs Clarification from Operations", "Waiting on ops for field info (electrical panel capacity, roof condition, etc.)."],
  ["Pending Resurvey", "Original survey data is insufficient — needs a new site visit before design can continue."],
  ["On Hold", "Design paused for any reason."],
  ["No Design Needed", "No design required (e.g., service job, battery-only with existing plans)."],
])}

<h3>New Construction</h3>
${statusTable([
  ["New Construction - Design Needed", "New-build home — design hasn't started yet."],
  ["New Construction - In Progress", "Designer working on new construction plans."],
  ["New Construction - Ready for Review", "New construction design ready for review."],
  ["New Construction - Design Completed", "New construction design done."],
])}

<h3>Xcel-Specific</h3>
${statusTable([
  ["Xcel - Design Needed", "Xcel Energy requires specific site plan &amp; SLD — not yet started."],
  ["Xcel - In Progress", "Working on Xcel-required documents."],
  ["Xcel - Site Plan &amp; SLD Completed", "Xcel site plan and single-line diagram complete."],
])}

<h3>Archived (Legacy)</h3>
<p>These statuses are from the old workflow and should not be used on new projects:</p>
${statusTable([
  ["(Archived) Revision In Progress", "Legacy — use the specific revision type instead."],
  ["(Archived) Revision Complete", "Legacy — use the specific revision type instead."],
  ["(Archived) Revision Initial Review", "Legacy."],
  ["(Archived) Revision Final Review/Stamping", "Legacy."],
  ["(Archived) Revision In Engineering", "Legacy."],
])}
`,
  },

  // ── 3. Design Approval Status ──
  {
    id: "ref-design-approval-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Design Approval Status",
    dotColor: "purple",
    sortOrder: 102,
    content: `
<h2>Design Approval Status</h2>
<p>HubSpot field: <code>layout_status</code> — Tracks the customer-facing design approval (DA) process. This is about the customer approving the layout, not engineering review.</p>

${statusTable([
  ["Review In Progress", "DA package is being prepared internally before sending to customer."],
  ["Draft Complete", "DA draft is ready but hasn't been sent yet."],
  ["Sent For Approval", "DA sent to the customer for review and signature."],
  ["Needs Clarification", "Customer had questions or something is unclear — needs follow-up."],
  ["Design Approved", "Customer approved the design — green light to proceed."],
  ["Design Rejected", "Customer rejected the design — changes required."],
  ["In Revision", "Designer is making changes based on customer rejection."],
  ["DA Revision Ready To Send", "Revision complete, ready to resend to customer for approval."],
  ["Resent For Approval", "Revised DA sent back to customer for re-approval."],
  ["Pending Sales Changes", "DA blocked — sales needs to update deal info first."],
  ["Pending Ops Changes", "DA blocked — ops needs to provide field info first."],
  ["Pending Design Changes", "DA blocked — design team needs to make changes first."],
  ["Pending Resurvey", "Can't finalize DA until a new site survey is completed."],
  ["Pending Review", "DA is in queue waiting for internal review before sending to customer."],
])}
`,
  },

  // ── 4. Permitting Status ──
  {
    id: "ref-permitting-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Permitting Status",
    dotColor: "green",
    sortOrder: 103,
    content: `
<h2>Permitting Status</h2>
<p>HubSpot field: <code>permitting_status</code> — Tracks the building permit application through the AHJ (Authority Having Jurisdiction — city/county building department).</p>

${statusTable([
  ["Awaiting Utility Approval", "Can't submit permit until the utility approves the interconnection application first."],
  ["Ready For Permitting", "Design complete, permit package ready — needs to be submitted to the AHJ."],
  ["Submitted To Customer", "Permit docs sent to customer for signature before filing."],
  ["Customer Signature Acquired", "Customer signed — ready to submit to the AHJ."],
  ["Waiting On Information", "AHJ requested additional information or documents."],
  ["Submitted to AHJ", "Permit application filed with the building department."],
  ["Non-Design Related Rejection", "Permit rejected for a non-engineering reason (missing fees, wrong forms, HOA letter, etc.)."],
  ["Permit Rejected - Needs Revision", "AHJ rejected the plans — engineering revisions required."],
  ["Design Revision In Progress", "Plans sent back to the design team for corrections."],
  ["Revision Ready To Resubmit", "Design revision complete — ready to resubmit to AHJ."],
  ["Resubmitted to AHJ", "Revised permit resubmitted to the building department."],
  ["Permit Issued", "Permit approved and issued — ready to build."],
  ["Permit Issued; Pending Documents", "Permit issued but additional documents or payment still needed."],
  ["Ready to Submit for SolarApp", "Using SolarApp automated permitting — package ready to submit."],
  ["Not Needed", "No building permit required for this project."],
  ["Submit SolarApp to AHJ", "SolarApp package prepared, needs to be submitted to AHJ."],
  ["As-Built Revision Needed", "Post-install as-built revision required by AHJ."],
  ["As-Built Revision In Progress", "As-built drawings being updated."],
  ["As-Built Ready To Resubmit", "As-built revision complete, ready to resubmit."],
  ["As-Built Revision Resubmitted", "Updated as-built submitted to AHJ."],
])}
`,
  },

  // ── 5. Interconnection Status ──
  {
    id: "ref-interconnection-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Interconnection Status",
    dotColor: "teal",
    sortOrder: 104,
    content: `
<h2>Interconnection Status</h2>
<p>HubSpot field: <code>interconnection_status</code> — Tracks the utility interconnection application. Required before the system can export power to the grid.</p>

${statusTable([
  ["Ready for Interconnection", "IC application ready to be prepared and submitted."],
  ["Submitted To Customer", "IC docs sent to customer for signature."],
  ["Ready To Submit - Pending Design", "IC application prepped but waiting on final design before submitting."],
  ["Ready To Submit", "Customer signed IC docs — ready to file with the utility."],
  ["Submitted To Utility", "IC application filed with the utility company."],
  ["Waiting On Information", "Utility needs additional information from us."],
  ["Waiting on Utility Bill", "Need a recent utility bill from the customer to proceed."],
  ["Waiting on New Construction", "New construction — utility service not yet available at the address."],
  ["In Review", "Utility is actively reviewing the application."],
  ["Non-Design Related Rejection", "Rejected for non-engineering reason (wrong account info, missing docs, etc.)."],
  ["Rejected", "Initial rejection received — need to review details."],
  ["Rejected - Revisions Needed", "Utility rejected the IC — engineering design revisions required."],
  ["Design Revision In Progress", "Plans sent back to design team for utility-required changes."],
  ["Revision Ready To Resubmit", "Design revision done — ready to resubmit to utility."],
  ["Resubmitted To Utility", "Revised IC application resubmitted."],
  ["Application Approved", "Utility approved the interconnection — system can proceed to PTO after inspection."],
  ["Application Approved - Pending Signatures", "Utility approved but final signature documents still outstanding."],
  ["Transformer Upgrade", "Utility requires a transformer upgrade before approval — this can take months."],
  ["Supplemental Review", "Utility flagged for additional engineering review (larger systems, grid capacity concerns)."],
  ["RBC On Hold", "On hold due to RBC (Revenue-Based Capacity) — utility grid capacity issue."],
  ["Not Needed", "No interconnection required (off-grid, battery-only, etc.)."],
  ["Xcel Site Plan &amp; SLD Needed", "Xcel Energy requires a site plan and single-line diagram before IC review."],
  ["Pending Rebate Approval", "Waiting on rebate/incentive approval before IC can proceed."],
  ["Conditional Application Approval", "Approved with conditions — certain requirements must be met post-install."],
  ["As-Built Ready to Resubmit", "Post-install as-built IC revision ready to resubmit."],
  ["As-Built Resubmitted", "As-built IC revision resubmitted to utility."],
])}
`,
  },

  // ── 6. Construction Status ──
  {
    id: "ref-construction-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Construction Status",
    dotColor: "amber",
    sortOrder: 105,
    content: `
<h2>Construction Status</h2>
<p>HubSpot field: <code>install_status</code> — Tracks the physical installation from scheduling through completion.</p>

${statusTable([
  ["Rejected", "Install was rejected or cancelled before it started."],
  ["Blocked", "Install can't proceed — waiting on permits, materials, customer issue, etc."],
  ["Ready to Build", "All permits and approvals in hand — ready to schedule a crew."],
  ["Scheduled", "Install date confirmed, crew assigned."],
  ["On Our Way", "Crew dispatched, heading to the job site."],
  ["Started", "Crew arrived and work has begun."],
  ["In Progress", "Installation actively underway."],
  ["Loose Ends Remaining", "Main install done but minor items remain (labeling, conduit covers, cleanup, etc.)."],
  ["Construction Complete", "Installation fully finished — ready for inspection."],
  ["Revisions Needed", "Post-install changes needed (failed inspection, design change, etc.)."],
  ["In Design For Revisions", "Revision sent to design team for updated plans."],
  ["Revisions Complete", "Revision work done — back on track."],
  ["Pending New Construction Design Review", "New construction project — waiting on design review before install can continue."],
])}
`,
  },

  // ── 7. Final Inspection Status ──
  {
    id: "ref-inspection-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "Final Inspection Status",
    dotColor: "red",
    sortOrder: 106,
    content: `
<h2>Final Inspection Status</h2>
<p>HubSpot field: <code>final_inspection_status</code> — Tracks the municipal/utility inspection after installation.</p>

${statusTable([
  ["Ready For Inspection", "Install complete — inspection needs to be scheduled with the AHJ."],
  ["Scheduled", "Inspection date set with the building department."],
  ["On Our Way", "Inspector or our team heading to site for the inspection."],
  ["Started", "Inspection underway."],
  ["In Progress", "Inspection actively happening on site."],
  ["Failed", "Inspection failed — corrections required before re-inspection."],
  ["Rejected", "Inspection rejected outright — significant issues found."],
  ["Waiting on Permit Revisions", "Can't re-inspect until permit revisions are approved."],
  ["Revisions Complete", "Corrections made, ready to reschedule inspection."],
  ["Passed", "Inspection passed — system approved, proceed to PTO."],
  ["Partial Pass", "Passed with minor items — may need a follow-up but can proceed toward PTO."],
  ["Not Needed", "No inspection required for this project."],
  ["Pending New Construction Sign Off", "New construction — waiting on general contractor or builder sign-off."],
  ["Pending Fire Inspection", "Separate fire department inspection required (some jurisdictions)."],
  ["Pending BUS Install", "Waiting on BUS (Backup Utility Switch) installation before inspection."],
  ["Pending New Construction", "New build — inspection can't happen until the house is further along."],
])}
`,
  },

  // ── 8. PTO Status ──
  {
    id: "ref-pto-status",
    sidebarGroup: "HubSpot Status Fields",
    title: "PTO Status",
    dotColor: "green",
    sortOrder: 107,
    content: `
<h2>PTO Status</h2>
<p>HubSpot field: <code>pto_status</code> — Permission To Operate. The final utility approval that lets the customer turn on their system and receive net metering credit.</p>

${statusTable([
  ["PTO Waiting on Interconnection Approval", "Can't submit PTO until IC is approved."],
  ["Inspection Passed - Ready for PTO Submission", "Inspection passed, PTO package ready to submit to utility."],
  ["Inspection Submitted to Utility", "PTO application filed with the utility."],
  ["Inspection Rejected By Utility", "Utility rejected the PTO submission — review and fix."],
  ["Ops Related PTO Rejection", "PTO rejected due to an ops issue (wrong meter photo, missing label, etc.)."],
  ["Waiting On Information", "Utility needs additional info for PTO processing."],
  ["Waiting on New Construction", "New construction — utility service not yet active."],
  ["PTO Revision Resubmitted", "Revised PTO docs resubmitted to utility."],
  ["PTO Granted", "Utility approved — customer can turn on the system! Project nearly done."],
  ["Not Needed", "PTO not required (off-grid, battery-only, etc.)."],
  ["Xcel Photos Ready to Submit", "Xcel requires photo docs — photos taken and ready to upload."],
  ["Xcel Photos Submitted", "Photos sent to Xcel for review."],
  ["XCEL Photos Rejected", "Photos didn't meet Xcel's requirements — need to retake."],
  ["Xcel Photos Ready to Resubmit", "New photos ready to send."],
  ["Xcel Photos Resubmitted", "Updated photos sent to Xcel."],
  ["Xcel Photos Approved", "Xcel accepted the photos — PTO process continues."],
  ["Conditional PTO - Pending Transformer Upgrade", "PTO conditionally approved but transformer upgrade must happen first."],
  ["Pending Truck Roll", "Utility needs a field visit to the meter/service before granting PTO."],
])}
`,
  },

  // ── 9. Project Pipeline Stages ──
  {
    id: "ref-project-stages",
    sidebarGroup: "Pipeline Stages",
    title: "Project Pipeline",
    dotColor: "blue",
    sortOrder: 200,
    content: `
<h2>Project Pipeline Stages</h2>
<p>The main HubSpot pipeline that every solar project moves through. Listed from earliest to latest.</p>

${statusTable([
  ["Site Survey", "Initial site assessment scheduled or in progress."],
  ["Design &amp; Engineering", "System design underway — panel layout, electrical plans."],
  ["Permitting &amp; Interconnection", "Permit and utility interconnection applications submitted."],
  ["RTB - Blocked", "Ready to build but blocked (permit, payment, materials, etc.)."],
  ["Ready To Build", "All permits/approvals in hand, ready for install scheduling."],
  ["Construction", "Installation crew on site or scheduled."],
  ["Inspection", "Municipal/utility inspection scheduled or pending."],
  ["Permission To Operate", "Inspection passed, awaiting utility PTO letter."],
  ["Close Out", "PTO received, project wrapping up — final billing, monitoring setup."],
  ["Project Complete", "Fully completed and closed."],
  ["On Hold", "Paused for any reason."],
  ["Project Rejected - Needs Review", "Deal fell through or needs re-evaluation."],
], ["Stage", "Description"])}

<h3>Stage Colors</h3>
<div style="display:flex;flex-wrap:wrap;gap:4px 0;margin-top:8px;">
${colorDot("#3B82F6", "Site Survey")}
${colorDot("#6366F1", "Design & Engineering")}
${colorDot("#A855F7", "Permitting & IC")}
${colorDot("#EF4444", "RTB - Blocked")}
${colorDot("#EAB308", "Ready To Build")}
${colorDot("#F97316", "Construction")}
${colorDot("#F59E0B", "Inspection")}
${colorDot("#84CC16", "Permission To Operate")}
${colorDot("#22C55E", "Close Out")}
${colorDot("#10B981", "Project Complete")}
</div>
`,
  },

  // ── 10. Other Pipelines ──
  {
    id: "ref-other-pipelines",
    sidebarGroup: "Pipeline Stages",
    title: "Sales / D&R / Service / Roofing",
    dotColor: "amber",
    sortOrder: 201,
    content: `
<h2>Sales Pipeline</h2>
${statusTable([
  ["Qualified to buy", "Lead is qualified — budget, authority, need confirmed."],
  ["Proposal Submitted", "Proposal sent to customer."],
  ["Proposal Accepted", "Customer accepted the proposal."],
  ["Finalizing Deal", "Contract sent, working out final details."],
  ["Sales Follow Up", "Needs additional follow-up."],
  ["Nurture", "Long-term lead — not ready yet."],
  ["Closed won", "Deal signed — convert to project."],
  ["Closed lost", "Deal did not close."],
], ["Stage", "Description"])}

<h2>D&amp;R (Detach &amp; Reset) Pipeline</h2>
${statusTable([
  ["Kickoff", "D&amp;R project initiated."],
  ["Site Survey", "Assessing existing system before detach."],
  ["Design", "Planning the reset layout."],
  ["Permit", "Permit application for the reset."],
  ["Ready for Detach", "Scheduling detach crew."],
  ["Detach", "Panels being removed from roof."],
  ["Detach Complete - Roofing In Progress", "Panels off, roofer is working."],
  ["Reset Blocked - Waiting on Payment", "Can't reset until payment received."],
  ["Ready for Reset", "Roof done, ready to reinstall."],
  ["Reset", "Panels being reinstalled."],
  ["Inspection", "Post-reset inspection."],
  ["Closeout", "Final paperwork and billing."],
  ["Complete", "D&amp;R finished."],
  ["On-hold", "Paused."],
  ["Cancelled", "Cancelled."],
], ["Stage", "Description"])}

<h2>Service Pipeline</h2>
${statusTable([
  ["Project Preparation", "Service ticket created, gathering info."],
  ["Site Visit Scheduling", "Scheduling the service visit."],
  ["Work In Progress", "Technician on site or work underway."],
  ["Inspection", "Post-service inspection (if required)."],
  ["Invoicing", "Work complete, sending invoice."],
  ["Completed", "Service job done and paid."],
  ["Cancelled", "Service request cancelled."],
], ["Stage", "Description"])}

<h2>Roofing Pipeline</h2>
${statusTable([
  ["On Hold", "Project paused."],
  ["Color Selection", "Customer choosing shingle/material colors."],
  ["Material &amp; Labor Order", "Ordering materials and booking crew."],
  ["Confirm Dates", "Confirming install dates."],
  ["Staged", "Materials delivered, ready for production."],
  ["Production", "Roof being installed."],
  ["Post Production", "Cleanup and final checks."],
  ["Invoice/Collections", "Sending final invoice."],
  ["Job Close Out Paperwork", "Filing warranties, lien waivers, etc."],
  ["Job Completed", "Roofing project done."],
], ["Stage", "Description"])}
`,
  },

  // ── 11. Zuper Job Categories & Statuses ──
  {
    id: "ref-zuper",
    sidebarGroup: "Zuper",
    title: "Job Categories & Statuses",
    dotColor: "red",
    sortOrder: 300,
    content: `
<h2>Zuper Job Categories</h2>
<p>Every Zuper job belongs to one of these categories, which determines its status workflow.</p>

${statusList([
  ["Site Survey", "Initial property assessment — roof measurements, electrical panel, shading analysis."],
  ["Construction", "Solar panel installation (the main install day)."],
  ["Inspection", "Municipal building inspection after installation."],
  ["Service Visit", "Warranty or maintenance call on an existing system."],
  ["Service Revisit", "Follow-up visit for a previous service call."],
  ["Additional Visit", "Extra visit beyond the standard scope."],
  ["Detach", "Removing panels from roof (D&amp;R projects)."],
  ["Reset", "Reinstalling panels after roof work (D&amp;R projects)."],
  ["D&amp;R Inspection", "Inspection specific to detach &amp; reset work."],
  ["Walk Roof", "Roofing-specific roof walkthrough assessment."],
  ["Mid Roof Install", "Roofing installation in progress (mid-project check)."],
  ["Roof Final", "Final roofing inspection / completion."],
])}

<h2>Common Zuper Job Statuses</h2>

<h3>Not Started</h3>
${statusTable([
  ["New", "Job just created, not yet assigned or scheduled."],
  ["Unassigned", "Job exists but no crew assigned."],
  ["Ready to Schedule", "Job is ready but no date set."],
  ["Scheduled", "Date set, crew assigned, waiting for job day."],
  ["Ready to Build", "All prerequisites met, waiting for install day."],
  ["Ready for Inspection", "Install done, inspection not yet scheduled."],
])}

<h3>In Progress</h3>
${statusTable([
  ["On Our Way", "Crew dispatched, heading to site."],
  ["Started", "Work has begun on site."],
  ["In Progress", "Active work underway."],
])}

<h3>Completed</h3>
${statusTable([
  ["Completed", "Job finished successfully."],
  ["Construction Complete", "Install finished (construction jobs)."],
  ["Passed", "Inspection passed."],
  ["Partial Pass", "Inspection partially passed — minor items remain."],
  ["Failed", "Inspection failed — corrections needed."],
])}

<p><strong>Compliance note:</strong> Jobs in "On Our Way", "Started", or "In Progress" for more than 24 hours are flagged as <strong>stuck</strong> — usually means the crew forgot to update the status.</p>
`,
  },

  // ── 12. User Roles ──
  {
    id: "ref-user-roles",
    sidebarGroup: "System",
    title: "User Roles",
    dotColor: "blue",
    sortOrder: 400,
    content: `
<h2>User Roles &amp; Permissions</h2>
<p>Each user has one role that determines which dashboards and features they can access.</p>

${statusTable([
  ["ADMIN", "Full access to everything, including user management and admin tools."],
  ["OWNER", "Same as Admin but <strong>cannot</strong> manage users (for Matt &amp; David)."],
  ["PROJECT_MANAGER", "Project tracking, scheduling, reporting across all job types."],
  ["OPERATIONS", "Construction flow management — can schedule installs &amp; inspections."],
  ["OPERATIONS_MANAGER", "Crew oversight, scheduling, availability management."],
  ["TECH_OPS", "Field technicians — view schedules, manage own availability."],
  ["DESIGNER", "Design &amp; engineering dashboard access (normalized to TECH_OPS)."],
  ["PERMITTING", "Permitting dashboard access (normalized to TECH_OPS)."],
  ["SALES", "Sales team — only survey scheduler access."],
  ["VIEWER", "Read-only access to all dashboards."],
], ["Role", "Description"])}

<h3>Permission Flags</h3>
<p>Individual users can have boolean overrides that <strong>grant</strong> additional abilities on top of their role defaults. These only add access — they never remove abilities the role already grants.</p>
${statusList([
  ["canScheduleSurveys", "Can create and manage site survey appointments."],
  ["canScheduleInstalls", "Can schedule installation jobs."],
  ["canSyncToZuper", "Can trigger Zuper data syncs."],
  ["canManageUsers", "Can create/edit/delete user accounts."],
  ["canManageAvailability", "Can edit crew availability calendars."],
])}
<p><strong>allowedLocations</strong> — Array of office locations the user can access. Empty means all locations (default).</p>
`,
  },

  // ── 13. Locations & Thresholds ──
  {
    id: "ref-system",
    sidebarGroup: "System",
    title: "Locations & Thresholds",
    dotColor: "teal",
    sortOrder: 401,
    content: `
<h2>Office Locations</h2>
<table class="sop-table">
<thead><tr><th>Location</th><th>Timezone</th><th>Color</th></tr></thead>
<tbody>
<tr><td>Westminster</td><td>America/Denver (MT)</td><td>${colorDot("#3B82F6", "Blue")}</td></tr>
<tr><td>Centennial</td><td>America/Denver (MT)</td><td>${colorDot("#10B981", "Emerald")}</td></tr>
<tr><td>Colorado Springs</td><td>America/Denver (MT)</td><td>${colorDot("#F59E0B", "Amber")}</td></tr>
<tr><td>San Luis Obispo</td><td>America/Los_Angeles (PT)</td><td>${colorDot("#8B5CF6", "Violet")}</td></tr>
<tr><td>Camarillo</td><td>America/Los_Angeles (PT)</td><td>${colorDot("#EC4899", "Pink")}</td></tr>
</tbody>
</table>

<h2>Key Thresholds</h2>
<table class="sop-table">
<thead><tr><th>Threshold</th><th>Value</th><th>Used For</th></tr></thead>
<tbody>
<tr><td>Stale P&amp;I threshold</td><td><strong>14 days</strong></td><td>Permits/IC items with no status change are flagged.</td></tr>
<tr><td>Stuck job grace period</td><td><strong>24 hours</strong></td><td>Zuper jobs in progress too long are flagged.</td></tr>
</tbody>
</table>

<h3>Milestone Forecasting</h3>
<p>Forecast dates (install, inspection, PTO, etc.) are computed by the <strong>QC-data-driven forecasting engine</strong>, not fixed offsets. The engine calculates median milestone-to-milestone durations from historical project data, segmented by location, AHJ, and utility. Fallback hierarchy: full segment (min 5 samples) → location only → global baseline.</p>
`,
  },
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

async function seed() {
  console.log(`\nSeeding SOP Reference tab ${FORCE ? "(FORCE — overwriting)" : "(init-only)"}...\n`);

  // 1. Upsert tab
  if (FORCE) {
    await prisma.sopTab.upsert({
      where: { id: TAB.id },
      create: { id: TAB.id, label: TAB.label, sortOrder: TAB.sortOrder },
      update: { label: TAB.label, sortOrder: TAB.sortOrder },
    });
    console.log(`  ~ Tab: ${TAB.id} (upserted)`);
  } else {
    const existing = await prisma.sopTab.findUnique({ where: { id: TAB.id } });
    if (!existing) {
      await prisma.sopTab.create({
        data: { id: TAB.id, label: TAB.label, sortOrder: TAB.sortOrder },
      });
      console.log(`  + Tab: ${TAB.id} (created)`);
    } else {
      console.log(`  = Tab: ${TAB.id} (exists, skipping)`);
    }
  }

  // 2. Delete old sections that no longer exist in the new definition
  const newIds = new Set(sections.map(s => s.id));
  const existingSections = await prisma.sopSection.findMany({
    where: { tabId: TAB.id },
    select: { id: true },
  });
  const toDelete = existingSections.filter(s => !newIds.has(s.id)).map(s => s.id);
  if (toDelete.length > 0 && FORCE) {
    // Delete revisions and suggestions first (foreign keys)
    await prisma.sopRevision.deleteMany({ where: { sectionId: { in: toDelete } } });
    await prisma.sopSuggestion.deleteMany({ where: { sectionId: { in: toDelete } } });
    await prisma.sopSection.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`  - Deleted ${toDelete.length} old sections: ${toDelete.join(", ")}`);
  }

  // 3. Upsert sections
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const sec of sections) {
    const data = {
      id: sec.id,
      tabId: TAB.id,
      sidebarGroup: sec.sidebarGroup,
      title: sec.title,
      dotColor: sec.dotColor,
      sortOrder: sec.sortOrder,
      content: sec.content.trim(),
      version: 1,
    };

    if (FORCE) {
      await prisma.sopSection.upsert({
        where: { id: sec.id },
        create: data,
        update: {
          tabId: data.tabId,
          sidebarGroup: data.sidebarGroup,
          title: data.title,
          dotColor: data.dotColor,
          sortOrder: data.sortOrder,
          content: data.content,
        },
      });
      updated++;
      console.log(`  ~ Section: ${sec.id} (${sec.title})`);
    } else {
      const existing = await prisma.sopSection.findUnique({ where: { id: sec.id } });
      if (!existing) {
        await prisma.sopSection.create({ data });
        created++;
        console.log(`  + Section: ${sec.id} (${sec.title})`);
      } else {
        skipped++;
        console.log(`  = Section: ${sec.id} (exists, skipping)`);
      }
    }
  }

  if (FORCE) {
    console.log(`\n  Updated ${updated} sections`);
  } else {
    console.log(`\n  Created: ${created}, Skipped: ${skipped}`);
  }

  const tabCount = await prisma.sopTab.count();
  const sectionCount = await prisma.sopSection.count();
  console.log(`\nDatabase totals: ${tabCount} tabs, ${sectionCount} sections`);
}

seed()
  .then(() => {
    console.log("\nReference seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
