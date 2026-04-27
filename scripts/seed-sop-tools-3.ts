/**
 * Seed additional Tools sections: Workflow Builder, Equipment Backlog,
 * Deal Detail Panel, Property Drawer.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-tools-3.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "tools";

// ─── Sections ─────────────────────────────────────────────────────

const WORKFLOW_BUILDER = `
<h1>Admin Workflow Builder</h1>

<p>Visual workflow builder for chaining existing actions into automated sequences. Built on Inngest (the same engine the BOM pipeline runs on). Admin-only.</p>

<ul>
<li>List: <code>/dashboards/admin/workflows</code></li>
<li>Editor: <code>/dashboards/admin/workflows/[id]</code></li>
<li>Run history: <code>/dashboards/admin/workflows/runs</code></li>
<li>Per-run detail: <code>/dashboards/admin/workflows/runs/[runId]</code></li>
<li>Visible to: ADMIN only</li>
</ul>

<h2>Anatomy of a Workflow</h2>

<p>A workflow is a saved <code>AdminWorkflow</code> row containing:</p>
<ul>
<li>A <strong>trigger</strong> — what fires the workflow</li>
<li>A <strong>definition</strong> (JSON) — the ordered list of steps</li>
<li>Activation flag — only ACTIVE workflows actually run</li>
</ul>

<h2>Triggers</h2>

<table>
<thead><tr><th>Trigger</th><th>Description</th></tr></thead>
<tbody>
<tr><td><strong>MANUAL</strong></td><td>Admin clicks "Run now" from the editor — useful for one-off batch jobs and testing</td></tr>
<tr><td><strong>HUBSPOT_PROPERTY_CHANGE</strong></td><td>Fires when a HubSpot deal/contact/ticket property changes (piggy-backs on the existing <code>deal-sync</code> webhook)</td></tr>
<tr><td><strong>ZUPER_PROPERTY_CHANGE</strong></td><td>Fires when a Zuper job property changes (handled at <code>/api/webhooks/zuper/admin-workflows</code>)</td></tr>
<tr><td><strong>CRON</strong></td><td>Fires on a cron schedule</td></tr>
<tr><td><strong>CUSTOM_EVENT</strong></td><td>Fires when any other workflow emits a custom event (chaining workflows together)</td></tr>
</tbody>
</table>

<h2>Action Palette</h2>

<p>The editor offers a fixed set of actions, organized by category:</p>

<h3>Messaging</h3>
<ul>
<li><strong>send-email</strong> — Send an email via the dual-provider system (Google Workspace primary, Resend fallback)</li>
</ul>

<h3>AI</h3>
<ul>
<li><strong>ai-compose</strong> — Generate text via Claude using a prompt with template substitution</li>
</ul>

<h3>HubSpot — Reads</h3>
<ul>
<li><strong>fetch-hubspot-deal</strong> — Pull a deal record by ID</li>
<li><strong>find-hubspot-contact</strong> — Look up a contact by email/phone/name</li>
</ul>

<h3>HubSpot — Writes</h3>
<ul>
<li><strong>update-hubspot-property</strong> — Set a deal property</li>
<li><strong>update-hubspot-contact-property</strong> — Set a contact property</li>
<li><strong>update-hubspot-ticket-property</strong> — Set a ticket property</li>
<li><strong>add-hubspot-note</strong> — Append a note to a deal</li>
<li><strong>add-hubspot-contact-note</strong> — Append a note to a contact</li>
<li><strong>create-hubspot-task</strong> — Create a HubSpot task</li>
</ul>

<h3>Zuper</h3>
<ul>
<li><strong>fetch-zuper-job</strong> — Pull a Zuper job</li>
<li><strong>update-zuper-property</strong> — Set a Zuper job custom field</li>
</ul>

<h3>HTTP</h3>
<ul>
<li><strong>http-request</strong> — Generic outbound HTTP call (POST/GET/PATCH/etc.) — escape hatch for systems without dedicated actions</li>
</ul>

<h3>PB Ops</h3>
<ul>
<li><strong>run-bom-pipeline</strong> — Trigger the BOM pipeline for a deal</li>
<li><strong>log-activity</strong> — Write an ActivityLog row for audit purposes</li>
</ul>

<h3>Control Flow (special — handled outside step.run)</h3>
<ul>
<li><strong>delay</strong> — Wait N seconds/minutes/hours/days before continuing</li>
<li><strong>stop-if</strong> — Halt the workflow if a condition matches</li>
</ul>

<h2>Template Expressions</h2>

<p>Step inputs support two interpolation prefixes:</p>
<ul>
<li><code>{{trigger.X}}</code> — values from the trigger context (e.g., the deal property that just changed)</li>
<li><code>{{previous.stepId.field}}</code> — outputs from a prior step (chain a fetch → an update)</li>
</ul>

<h2>Templates</h2>

<p>The editor offers "Start from template" — code-defined starter workflows in <code>src/lib/admin-workflows/templates.ts</code>. Click one to clone it into a new editable workflow.</p>

<h2>Run History</h2>

<p>Every execution writes an <code>AdminWorkflowRun</code> row capturing:</p>
<ul>
<li>Status: succeeded / failed / partial</li>
<li>Per-step inputs and outputs</li>
<li>Duration in ms</li>
<li>Error message and stack on failure</li>
</ul>

<p>The cross-workflow run history view (<code>/runs</code>) and per-run detail (<code>/runs/[runId]</code>) make it easy to debug.</p>

<h2>Feature Flags</h2>

<table>
<thead><tr><th>Flag</th><th>What it gates</th></tr></thead>
<tbody>
<tr><td><code>ADMIN_WORKFLOWS_ENABLED</code></td><td>Editor + API + manual runs</td></tr>
<tr><td><code>ADMIN_WORKFLOWS_FANOUT_ENABLED</code></td><td>Webhook → workflow event fan-out (separate kill switch from manual runs)</td></tr>
</tbody>
</table>

<div class="warn"><strong>Be careful with HubSpot writes.</strong> A workflow that sets a property on every deal that matches a trigger can quickly snowball if the trigger is too broad. Test with the MANUAL trigger first, then narrow the property-change trigger before activating.</div>
`;

const EQUIPMENT_BACKLOG = `
<h1>Equipment Backlog</h1>

<p>Forecast equipment demand by brand, model, and stage. Use this to make sure modules, inverters, and batteries arrive when crews need them.</p>

<ul>
<li>URL: <code>/dashboards/equipment-backlog</code></li>
<li>Visible from: Operations Suite</li>
<li>Service-only equipment forecast: <code>/dashboards/service-backlog</code> (separate dashboard in the Service Suite)</li>
</ul>

<h2>What's on the Page</h2>

<p>Three product breakdown sections:</p>
<ul>
<li><strong>Modules</strong> — by brand + model</li>
<li><strong>Inverters</strong> — by brand + model</li>
<li><strong>Batteries</strong> — by brand + model</li>
</ul>

<p>Each row shows the total quantity needed across all in-flight projects, and you can expand the row to see which projects contribute (with stage, location, and quantity per deal).</p>

<h2>Per-Project Equipment Card</h2>

<p>The top of the page lists every active project with its full equipment specification. Projects with missing equipment data show a warning indicator (⚠ "Missing equipment data").</p>

<h2>Filters</h2>

<ul>
<li>Location filter — show only projects from selected PB offices</li>
<li>Stage filter — focus on a specific pipeline phase (e.g., RTB only)</li>
<li>Search — filter by project name, brand, or model</li>
</ul>

<h2>How to Use It</h2>

<ol>
<li>Filter to your PB location</li>
<li>Look at the Modules / Inverters / Batteries totals — these are what you need on hand for projects currently in flight</li>
<li>Cross-reference with current Zoho stock to identify shortfalls</li>
<li>Place bulk POs (or follow up with vendors) for any item where stock + on-order &lt; backlog</li>
</ol>

<div class="info">For the Service-pipeline equipment forecast, use <code>/dashboards/service-backlog</code> — same UI but scoped to service deals only, with stage classification (backlog / in-progress / built).</div>
`;

const DEAL_DETAIL_PANEL = `
<h1>Deal Detail Panel</h1>

<p>The unified deal-detail page used across every pipeline (Sales, Project, D&amp;R, Service, Roofing). One layout, pipeline-specific sections, role-aware visibility.</p>

<ul>
<li>URL: <code>/dashboards/deals/[pipeline]/[dealId]</code></li>
<li>Real-time: SSE listener with cache filter <code>deals:&lt;dealId&gt;</code> — page auto-refreshes when the deal mirror updates</li>
</ul>

<h2>Layout</h2>

<p>The page has three main areas:</p>

<h3>Header (top)</h3>
<ul>
<li>Deal name + customer</li>
<li>Stage chip with color from the pipeline's stage palette</li>
<li>Refresh button — calls <code>POST /api/deals/[id]/sync</code> to pull the latest from HubSpot, then refetches the page data</li>
<li>Milestone Timeline — visual progression through the pipeline stages</li>
<li>Status Flags Bar — at-risk, overdue, etc.</li>
</ul>

<h3>Main Content (center)</h3>

<p>Three switchable tabs (selection persisted to <code>localStorage</code> as <code>deal-detail:active-tab</code>):</p>

<table>
<thead><tr><th>Tab</th><th>What's there</th></tr></thead>
<tbody>
<tr><td><strong>Details</strong></td><td>Pipeline-specific Field Grid sections (e.g., Site Survey, Design, Permitting…) — collapsible</td></tr>
<tr><td><strong>Activity</strong></td><td>HubSpot activity feed — every property change, status update, etc.</td></tr>
<tr><td><strong>Communications</strong></td><td>Notes + emails + calls timeline</td></tr>
</tbody>
</table>

<h3>Sidebar (right)</h3>

<p>Always-visible cards:</p>
<ul>
<li><strong>Team</strong> — assigned PM, designer, permitter, IC owner, etc.</li>
<li><strong>Equipment</strong> — module/inverter/battery counts</li>
<li><strong>Contact</strong> — primary contact details</li>
<li><strong>External Links</strong> — HubSpot, OpenSolar, Zoho SO, design folder, planset</li>
<li><strong>Quick Actions</strong> — common one-click ops (run BOM, generate reports, etc.)</li>
<li><strong>Zuper Jobs</strong> — every Zuper job linked to this deal</li>
<li><strong>Change Log</strong> — recent property changes</li>
<li><strong>Related Deals</strong> — same customer or address</li>
<li><strong>Photo Gallery</strong> — site photos</li>
</ul>

<h2>Role-Based Section Visibility</h2>

<p>Some sections (e.g., <code>install-planning</code>) are hidden from non-operational roles. The "operational roles" set is:</p>

<ul>
<li>ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS</li>
</ul>

<p>If you're SALES or DESIGN, those operational sections won't appear — same data, just role-appropriate filtering.</p>

<h2>Pipeline-Specific Sections</h2>

<p>Section composition is defined in <code>section-registry.ts</code> per pipeline. The Project pipeline shows Site Survey + Design + Permitting + IC + Construction + Inspection sections; the Service pipeline shows Service Visit + Equipment + Resolution sections, and so on.</p>

<h2>Sync Button Behavior</h2>

<p>Clicking Refresh:</p>
<ol>
<li>Sends <code>POST /api/deals/[id]/sync</code></li>
<li>Server pulls fresh data from HubSpot</li>
<li>Client waits 500 ms for the persist to settle</li>
<li>Page does an RSC refresh — new server-rendered data flows in without a full reload</li>
</ol>

<div class="info">In normal use you don't need to hit Refresh — the SSE listener picks up <code>deals:&lt;dealId&gt;</code> events and refreshes automatically. Use it when you suspect HubSpot has new data we haven't seen yet (e.g., a workflow you triggered manually).</div>
`;

const PROPERTY_DRAWER = `
<h1>Property Drawer</h1>

<p>Slide-in drawer that shows everything we have on a physical address — equipment, owners, deals, tickets, jobs — anchored to a canonical HubSpot Property record.</p>

<ul>
<li>Feature flag: <code>NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED</code> — when off, the drawer never renders even if mounted</li>
<li>Surfaces with the drawer wired up: Service Suite customer-360, Deals detail panel address row</li>
</ul>

<h2>What is a "Property"?</h2>

<p>One row per normalized address in <code>HubSpotPropertyCache</code>. Dedup is enforced via <code>addressHash</code> (SHA-256 of <code>street + unit + city + state + zip</code>) and an optional <code>googlePlaceId</code>. So two deals at the same house always link to the same Property record.</p>

<h2>Data You'll See in the Drawer</h2>

<ul>
<li><strong>Map</strong> — Google Maps Static API satellite view, centered on the lat/lng</li>
<li><strong>Address</strong> — canonical formatted address</li>
<li><strong>Equipment summary</strong> — system size, battery presence, module count (rolled up from associated deals)</li>
<li><strong>Owners</strong> — Current Owner, Previous Owner, Authorized Contact (each is a HubSpot contact link)</li>
<li><strong>Deals</strong> — every deal at this address, all pipelines</li>
<li><strong>Tickets</strong> — every ticket at this address</li>
<li><strong>Open ticket count</strong> — quick scan for "is there active service work here?"</li>
<li><strong>Warranty dates</strong> — when applicable</li>
</ul>

<h2>How to Open It</h2>

<p>Anywhere a <code>&lt;PropertyLink&gt;</code> wraps an address (must pass structured <code>AddressParts</code>, not a raw string):</p>
<ul>
<li>Click the address → drawer slides in from the right</li>
<li>Press <code>Escape</code> or click the backdrop to close</li>
</ul>

<h2>"No Property Record" State</h2>

<p>If the address you clicked doesn't have a Property row yet (the back-fill or webhooks haven't created one), the drawer shows a "No property record yet" message with a placeholder Manual Create button (currently disabled — coming with task 6.2).</p>

<h2>Caching</h2>

<ul>
<li>React Query stale time: 60 seconds</li>
<li>No refetch on window focus / mount / reconnect — keep the drawer fast and quiet</li>
<li>Map static URL is memoized per (propertyId, lat, lng) so the browser only issues one Google Maps request per property-open</li>
</ul>

<h2>How Properties Get Created</h2>

<p>Three paths:</p>
<ol>
<li><strong>Contact webhook</strong> — when a HubSpot contact's address changes, <code>onContactAddressChange()</code> geocodes the new address and upserts the Property cache</li>
<li><strong>Backfill script</strong> — <code>scripts/backfill-properties.ts</code> walks contacts → deals → tickets → rollups and creates Property rows for every existing address</li>
<li><strong>Reconcile cron</strong> — <code>/api/cron/property-reconcile</code> runs daily at 9am, re-fetching any property touched in the last 24h to fix cache drift</li>
</ol>

<div class="warn">ATTOM-sourced fields (yearBuilt, squareFootage, roofMaterial, etc.) are <strong>null</strong> until ATTOM integration ships. Current implementation populates only HubSpot-derivable + Google-geocoded fields.</div>

<h2>Feature Flag Reference</h2>

<table>
<thead><tr><th>Flag</th><th>What it gates</th></tr></thead>
<tbody>
<tr><td><code>PROPERTY_SYNC_ENABLED</code></td><td>Webhook + cron + backfill kill switch (server-side; cache tables sit empty when off)</td></tr>
<tr><td><code>NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED</code></td><td>UI surfaces (drawer, links, providers) — independent of the sync flag</td></tr>
</tbody>
</table>
`;

const SECTIONS = [
  { id: "tools-workflow-builder", group: "Admin Automation", title: "Workflow Builder", color: "red", order: 50, content: WORKFLOW_BUILDER },
  { id: "tools-equipment-backlog", group: "Operations", title: "Equipment Backlog", color: "cyan", order: 43, content: EQUIPMENT_BACKLOG },
  { id: "tools-deal-detail", group: "Reference", title: "Deal Detail Panel", color: "blue", order: 60, content: DEAL_DETAIL_PANEL },
  { id: "tools-property-drawer", group: "Reference", title: "Property Drawer", color: "green", order: 61, content: PROPERTY_DRAWER },
];

async function main() {
  const tab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!tab) {
    console.error(`ERROR: Tab "${TAB_ID}" doesn't exist. Run scripts/seed-sop-tools.ts first.`);
    process.exit(1);
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
