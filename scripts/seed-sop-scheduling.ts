/**
 * Seed the Scheduling SOP tab with sections for each scheduler dashboard.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-scheduling.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "scheduling";
const TAB_LABEL = "Scheduling";
const TAB_SORT = 10;

// ─── Sections ─────────────────────────────────────────────────────

const OVERVIEW = `
<h1>Scheduler Overview</h1>

<p>The Tech Ops Suite has four scheduling dashboards, each tied to a specific stage of the project lifecycle and a different Google Calendar set.</p>

<table>
<thead><tr><th>Scheduler</th><th>URL</th><th>Stage</th><th>Calendar</th></tr></thead>
<tbody>
<tr><td><strong>Site Survey</strong></td><td><code>/dashboards/site-survey-scheduler</code></td><td>Site Survey</td><td>Survey calendars (Denver / Nick / shared)</td></tr>
<tr><td><strong>Construction</strong></td><td><code>/dashboards/construction-scheduler</code></td><td>Ready To Build, Construction</td><td>Install calendars per location</td></tr>
<tr><td><strong>Inspection</strong></td><td><code>/dashboards/inspection-scheduler</code></td><td>Inspection</td><td>Install calendars per location</td></tr>
<tr><td><strong>Service</strong></td><td><code>/dashboards/service-scheduler</code></td><td>Service Visit, Service Revisit</td><td>Install calendars per location</td></tr>
</tbody>
</table>

<h2>Locations</h2>

<p>All schedulers cover five locations: <strong>Denver Tech Center (DTC), Westminster, Colorado Springs, San Luis Obispo, Camarillo</strong>. DTC and Centennial are aliased — same calendar, same crew. Camarillo and SLO share the same install calendar (the "California" bucket) intentionally.</p>

<h2>Common Behavior</h2>
<ul>
<li>Calendar events are written via a Google service account with domain-wide delegation</li>
<li>Event IDs are deterministic SHA1 hashes prefixed with <code>pb</code>, so re-scheduling the same project updates the existing event instead of creating a duplicate</li>
<li>Tentative assignments persist via <code>ScheduleRecord</code> rows with <code>status="tentative"</code> until confirmed</li>
<li>React Query refetch interval is 5 minutes</li>
<li>Crew/inspector/surveyor assignments persist in browser localStorage, keyed by project ID</li>
</ul>

<div class="info">If <code>GOOGLE_CALENDAR_SYNC_ENABLED</code> is off, scheduling actions still write the <code>ScheduleRecord</code> row but skip the calendar API call. Useful for staging environments.</div>
`;

const SITE_SURVEY = `
<h1>Site Survey Scheduler</h1>

<p>Schedule site surveys for projects in the <strong>Site Survey</strong> stage, plus pre-sale deal surveys.</p>

<h2>Where</h2>
<ul>
<li>URL: <code>/dashboards/site-survey-scheduler</code></li>
<li>Visible to: ADMIN, OWNER, MANAGER, OPERATIONS_MANAGER, SALES</li>
</ul>

<h2>Layout</h2>
<ul>
<li>Default month calendar view, with a list view alternate</li>
<li>Two modes: <strong>Operations view</strong> (existing projects) and <strong>Pre-sale mode</strong> (search HubSpot deals not yet promoted to projects)</li>
</ul>

<h2>Click Flow</h2>
<ol>
<li>Pick a project (or search a deal in pre-sale mode)</li>
<li>Click a date on the calendar</li>
<li>Surveyor assignment dialog opens</li>
<li>Confirm → calendar event created, ScheduleRecord written, customer notified</li>
</ol>

<h2>Sales Lead-Time Rule</h2>

<div class="warn">If <strong>any</strong> of your roles is SALES, you cannot schedule a site survey for today or tomorrow. The earliest available date is <strong>2 days out</strong>.</div>

<p>Error message shown: <em>"Sales users cannot schedule site surveys for today or tomorrow. Please choose a date at least 2 days out."</em> Default timezone: America/Denver.</p>

<h2>Office Daily Caps</h2>

<p>Site surveys per day are capped per office:</p>
<table>
<thead><tr><th>Office</th><th>Max surveys / day</th></tr></thead>
<tbody>
<tr><td>DTC</td><td>3</td></tr>
<tr><td>Westminster</td><td>3</td></tr>
</tbody>
</table>

<p>When a day hits the cap, available slots clear and the day is flagged. Other offices have no hardcoded daily cap.</p>

<h2>Calendars</h2>
<ul>
<li>Default Denver-area calendar: <code>GOOGLE_DENVER_SITE_SURVEY_CALENDAR_ID</code> (or <code>GOOGLE_SITE_SURVEY_CALENDAR_ID</code> as fallback)</li>
<li><strong>Nick Scarpellino</strong> surveys route to <code>GOOGLE_NICK_SITE_SURVEY_CALENDAR_ID</code> — Nick has his own bucket so his availability doesn't conflict with the Denver calendar</li>
</ul>

<div class="info">Survey scheduling is location-locked: Camarillo and SLO do <strong>not</strong> share a survey calendar (unlike installs).</div>
`;

const CONSTRUCTION = `
<h1>Construction Scheduler</h1>

<p>Schedule installation jobs for projects in <strong>Ready To Build</strong> or <strong>Construction</strong> stages.</p>

<h2>Where</h2>
<ul>
<li>URL: <code>/dashboards/construction-scheduler</code></li>
<li>Visible to: ADMIN, OWNER, MANAGER, OPERATIONS_MANAGER, SALES</li>
</ul>

<h2>Layout</h2>
<p>Four view modes: <strong>Month</strong> (default), Week, Gantt, List. Five-location calendar across Westminster, Centennial/DTC, Colorado Springs, SLO, Camarillo.</p>

<h2>Click Flow</h2>
<ol>
<li>Select a project from the queue</li>
<li>Click a date on the calendar</li>
<li>Crew assignment dialog opens — pick the team</li>
<li>Confirm → Google Calendar event + ScheduleRecord (confirmed status)</li>
</ol>

<h2>Construction Directors (per location)</h2>

<table>
<thead><tr><th>Location</th><th>Director</th></tr></thead>
<tbody>
<tr><td>Westminster</td><td>Joe Lynch</td></tr>
<tr><td>Centennial / DTC</td><td>Drew Perry</td></tr>
<tr><td>SLO + Camarillo</td><td>Nick Scarpellino (shared)</td></tr>
</tbody>
</table>

<h2>Calendars</h2>

<table>
<thead><tr><th>Location</th><th>Env var</th></tr></thead>
<tbody>
<tr><td>DTC / Centennial</td><td><code>GOOGLE_INSTALL_CALENDAR_DTC_ID</code></td></tr>
<tr><td>Westminster</td><td><code>GOOGLE_INSTALL_CALENDAR_WESTY_ID</code></td></tr>
<tr><td>Colorado Springs</td><td><code>GOOGLE_INSTALL_CALENDAR_COSP_ID</code> (fallback <code>GOOGLE_INSTALL_CALENDAR_PUEBLO_ID</code>)</td></tr>
<tr><td>SLO + Camarillo</td><td><code>GOOGLE_INSTALL_CALENDAR_CA_ID</code> (fallback <code>GOOGLE_INSTALL_CALENDAR_CALIFORNIA_ID</code>)</td></tr>
<tr><td>Camarillo override</td><td><code>GOOGLE_INSTALL_CALENDAR_CAMARILLO_ID</code></td></tr>
</tbody>
</table>

<h2>Optimizer Presets</h2>
<p>The schedule optimizer offers four routing presets:</p>
<ul>
<li><strong>Balanced</strong> — default mix of distance, crew utilization, and revenue</li>
<li><strong>Revenue-first</strong> — prioritize highest-dollar jobs</li>
<li><strong>PE Priority</strong> — Participate Energy projects first</li>
<li><strong>Urgency-first</strong> — overdue projects to the top</li>
</ul>

<div class="info">No SALES lead-time rule applies to construction (only site surveys).</div>
`;

const INSPECTION = `
<h1>Inspection Scheduler</h1>

<p>Schedule final inspections and reinspections for projects in the <strong>Inspection</strong> stage.</p>

<h2>Where</h2>
<ul>
<li>URL: <code>/dashboards/inspection-scheduler</code></li>
<li>Visible to: ADMIN, OWNER, MANAGER, OPERATIONS_MANAGER</li>
</ul>

<h2>Click Flow</h2>
<ol>
<li>Pick a project in Inspection stage</li>
<li>Click a date on the calendar</li>
<li>Inspector assignment dialog opens</li>
<li>Confirm → Google Calendar event + ScheduleRecord</li>
</ol>

<h2>Reinspection Logic</h2>

<p>The page handles failed-then-passed reinspections so they don't show up as overdue.</p>

<ul>
<li>Sibling "New Inspection" projects are detected by stripping the suffix from the project number (<code>getBaseProjectNumber()</code>)</li>
<li>If a failed inspection has a sibling "New Inspection" with passed status, the parent is <strong>not</strong> flagged overdue</li>
</ul>

<h2>Camarillo / SLO Cross-Coverage</h2>

<div class="info">SLO inspectors can cover Camarillo inspections — the cross-assignment list explicitly maps Camarillo to <code>["camarillo", "san luis obispo", "slo"]</code>. This is intentional, not a bug.</div>

<h2>Calendars</h2>
<p>Same install-calendar set as the Construction scheduler — see the Construction section for the env var list.</p>

<h2>Timezones</h2>
<ul>
<li>California / SLO / Camarillo: America/Los_Angeles</li>
<li>All others: America/Denver</li>
</ul>
`;

const SERVICE = `
<h1>Service Scheduler</h1>

<p>Schedule service visits and revisits for warranty work, troubleshooting, and customer-requested follow-ups.</p>

<h2>Where</h2>
<ul>
<li>URL: <code>/dashboards/service-scheduler</code></li>
<li>Visible to: ADMIN, OWNER, MANAGER, OPERATIONS_MANAGER</li>
</ul>

<h2>Layout</h2>
<p>Three view modes: Month (default), Week, Day. Day view is unique to this scheduler.</p>

<h2>Two Visit Types</h2>

<table>
<thead><tr><th>Type</th><th>Color</th><th>Zuper Category UID</th></tr></thead>
<tbody>
<tr><td>Service Visit</td><td>Emerald</td><td><code>cff6f839-c043-46ee-a09f-8d0e9f363437</code></td></tr>
<tr><td>Service Revisit</td><td>Amber</td><td><code>8a29a1c0-9141-4db6-b8bb-9d9a65e2a1de</code></td></tr>
</tbody>
</table>

<p>Both types route to the same location calendar — the visual distinction (emerald vs amber stripe) is on the dashboard only.</p>

<h2>Click Flow</h2>
<ol>
<li>Pick location + month</li>
<li>Click a date</li>
<li>Service team assignment dialog — choose visit or revisit type</li>
<li>Confirm → Google Calendar event + ScheduleRecord</li>
</ol>

<h2>Capacity</h2>
<p>No office-level daily cap on this scheduler. Per-crew <code>maxDailyJobs</code> still applies. Overdue flag fires if the scheduled date is in the past and the job isn't completed.</p>
`;

const SECTIONS = [
  {
    id: "sched-overview",
    sidebarGroup: "Schedulers",
    title: "Overview",
    dotColor: "blue",
    sortOrder: 0,
    content: OVERVIEW.trim(),
  },
  {
    id: "sched-site-survey",
    sidebarGroup: "Schedulers",
    title: "Site Survey",
    dotColor: "purple",
    sortOrder: 1,
    content: SITE_SURVEY.trim(),
  },
  {
    id: "sched-construction",
    sidebarGroup: "Schedulers",
    title: "Construction",
    dotColor: "orange",
    sortOrder: 2,
    content: CONSTRUCTION.trim(),
  },
  {
    id: "sched-inspection",
    sidebarGroup: "Schedulers",
    title: "Inspection",
    dotColor: "amber",
    sortOrder: 3,
    content: INSPECTION.trim(),
  },
  {
    id: "sched-service",
    sidebarGroup: "Schedulers",
    title: "Service",
    dotColor: "emerald",
    sortOrder: 4,
    content: SERVICE.trim(),
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
