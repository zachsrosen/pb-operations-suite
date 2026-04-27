/**
 * Seed the Tools SOP tab with BOM Pipeline and AI Design Review sections.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-tools.ts
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
const TAB_LABEL = "Tools";
const TAB_SORT = 14;

// ─── Sections ─────────────────────────────────────────────────────

const BOM = `
<h1>BOM Pipeline (Planset → Sales Order)</h1>

<p>The BOM tool reads a stamped planset PDF, extracts every piece of equipment, matches each item to the catalog, pushes line items to a HubSpot deal, and creates a draft Zoho Sales Order — all from one page.</p>

<ul>
<li>URL: <code>/dashboards/bom</code></li>
<li>Visible to: ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS</li>
</ul>

<div class="info"><strong>When to use this:</strong> a project hits Ready To Build and needs a Sales Order. The BOM tool replaces the manual "read the planset, type items into Zoho" workflow.</div>

<h2>The Four-Stage Pipeline</h2>

<table>
<thead><tr><th>#</th><th>Stage</th><th>What happens</th></tr></thead>
<tbody>
<tr><td><strong>1</strong></td><td>Extraction</td><td>Claude reads the planset PDF and returns a structured list of equipment (modules, inverters, batteries, racking, BOS, etc.) with brand, model, qty, and category.</td></tr>
<tr><td><strong>2</strong></td><td>Snapshot &amp; Catalog Match</td><td>Snapshot saved with auto-incremented version. Each item searched in Zoho Inventory; matches link to internal product records, mismatches queue a 90-day <code>PendingCatalogPush</code>.</td></tr>
<tr><td><strong>3</strong></td><td>HubSpot Line Items Push</td><td>Acquires a per-deal lock, replaces existing BOM-managed line items with new ones from the matched products, logs to <code>BomHubSpotPushLog</code>.</td></tr>
<tr><td><strong>4</strong></td><td>Sales Order Creation</td><td>Post-processes items (batches, bundles, suggests additions), resolves the Zoho customer from the HubSpot company, creates a <strong>draft</strong> Sales Order in Zoho Inventory.</td></tr>
</tbody>
</table>

<h2>Two Ways to Start</h2>

<h3>A. Drive File (preferred)</h3>
<ol>
<li>Link the BOM tool to a HubSpot project (search by deal name or PROJ number)</li>
<li>The tool reads the project's design folder from Google Drive</li>
<li>Pick the planset PDF from the file list (most recently stamped one is highlighted)</li>
<li>Click <strong>Extract</strong></li>
</ol>

<h3>B. Direct Upload</h3>
<ol>
<li>Drag a planset PDF into the upload zone (chunked upload via <code>/api/bom/chunk</code> — stays on our domain to avoid CORS)</li>
<li>Click <strong>Extract</strong></li>
<li>Optionally link to a HubSpot project after extraction</li>
</ol>

<h2>What You See After Extraction</h2>

<p>The page shows:</p>
<ul>
<li><strong>Project header</strong> — customer name, address, AHJ, utility, system size, planset rev, stamp date</li>
<li><strong>Items table</strong> — each line with category, brand, model, qty, source, and any AI-flagged warnings</li>
<li><strong>Catalog Coverage</strong> panel — which line items are matched in HubSpot Products / Zuper / Zoho Inventory</li>
<li><strong>Validation</strong> badges — module count match, battery capacity match, OCPD match (calculated against the planset summary)</li>
<li><strong>Linked HubSpot Project</strong> — links to the deal, design folder, OpenSolar, and Zuper (if available)</li>
</ul>

<h2>Edit Before Pushing</h2>

<p>Items are editable inline. Common edits:</p>
<ul>
<li>Fix brand/model typos</li>
<li>Adjust quantities</li>
<li>Add missed items (breakers are commonly missing — check the one-line diagram)</li>
<li>Remove duplicates the AI may have generated</li>
</ul>

<div class="warn"><strong>Items missing from the catalog:</strong> any item without a Zoho Inventory match must be added to the catalog before SO creation will work. Click "Add to Catalog" on the row, or open the <a href="/sop?tab=catalog">Submit New Product wizard</a> separately and come back.</div>

<h2>Push to HubSpot</h2>

<p>Click <strong>Push Line Items to HubSpot</strong>:</p>
<ul>
<li>Acquires a <code>PENDING</code> lock keyed on the deal ID. Stale after 5 minutes.</li>
<li>Creates a HubSpot line item per matched product with quantity</li>
<li>Deletes any prior BOM-managed line items on success</li>
<li>Logs the result (success/partial/failed) to <code>BomHubSpotPushLog</code></li>
</ul>

<div class="warn">If another user is already pushing the same deal, you'll see a "lock contention" message. Wait — the lock auto-releases after 5 minutes if the other process crashed.</div>

<h2>Create the Sales Order</h2>

<p>Click <strong>Create Zoho Sales Order</strong>:</p>
<ol>
<li>Items run through post-processing rules (racking is computed per-module, electrical BOS is bundled, etc.)</li>
<li>Customer resolved from HubSpot company → Zoho contact (matched by name + address)</li>
<li><strong>Draft</strong> SO created in Zoho — no PO is created automatically. Review and convert to PO from Zoho yourself.</li>
</ol>

<h2>Purchase Orders</h2>

<p>Below the SO, the page offers PO grouping. The tool suggests POs grouped by vendor and lets you create them in Zoho directly:</p>
<ol>
<li>Click <strong>Preview Purchase Orders</strong> — see suggested groupings</li>
<li>Adjust if needed (move items between vendors, remove stocked items)</li>
<li>Click <strong>Create PO</strong> per vendor</li>
</ol>

<h2>Version History</h2>

<p>Every save creates a new version of the BOM snapshot. The history drawer shows:</p>
<ul>
<li>Version number</li>
<li>Saved-by user + timestamp</li>
<li>Item count + total system size</li>
<li>Compare two versions to see what changed</li>
</ul>

<h2>PDF Export</h2>

<p>Generate a clean BOM PDF from the current snapshot — useful for sharing with the install crew or attaching to a deal.</p>

<h2>Common Failure Modes</h2>

<table>
<thead><tr><th>Symptom</th><th>What it means</th><th>What to do</th></tr></thead>
<tbody>
<tr><td>"Lock contention" on push</td><td>Another push is in progress for this deal</td><td>Wait 5 minutes; lock auto-clears</td></tr>
<tr><td>"Customer not found in Zoho"</td><td>HubSpot company doesn't have a matching Zoho contact</td><td>Create the customer in Zoho first, then retry</td></tr>
<tr><td>"Item not in catalog"</td><td>Brand/model not in Zoho Inventory</td><td>Submit via catalog wizard; queued automatically as <code>PendingCatalogPush</code> for 90 days</td></tr>
<tr><td>Module count mismatch warning</td><td>Extracted module qty doesn't match planset summary</td><td>Verify against the planset string sizing diagram before pushing</td></tr>
<tr><td>Extraction failed / timed out</td><td>Planset PDF is unusual format or AI couldn't read it</td><td>Try again, or extract sections manually</td></tr>
</tbody>
</table>

<h2>Pipeline Run Tracking</h2>

<p>Every full run logs a <code>BomPipelineRun</code> row with status (<code>SUCCEEDED</code>, <code>PARTIAL</code>, <code>FAILED</code>) and per-step details. Admins can view recent runs in the admin panel.</p>

<h2>Feedback</h2>

<p>If extraction got something wrong, click the feedback button on the row. Submissions land in <code>BomToolFeedback</code> and feed AI tuning.</p>
`;

const AI_DESIGN_REVIEW = `
<h1>AI Design Review</h1>

<p>One-click AI review of a planset against the project's AHJ rules, utility requirements, and engineering best practices. Available on the project review page.</p>

<ul>
<li>URL: <code>/dashboards/reviews/[dealId]</code> — opened from the project detail or directly via deal ID</li>
<li>Visible to: ADMIN, EXECUTIVE, MANAGER, DESIGNER, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS</li>
</ul>

<h2>How to Run a Review</h2>

<ol>
<li>Open the review page for a deal: <code>/dashboards/reviews/&lt;dealId&gt;</code></li>
<li>Click the <strong>Design Review</strong> button</li>
<li>The progress text walks through the steps (typically 15–45 seconds total):
  <ul>
  <li>"Starting review…"</li>
  <li>"Fetching AHJ &amp; utility requirements…"</li>
  <li>"Locating planset in Drive…"</li>
  <li>"Downloading planset PDF…"</li>
  <li>"Sending planset to Claude for analysis…"</li>
  <li>"Claude is reviewing the planset…"</li>
  <li>"Still analyzing — large plansets take longer…"</li>
  <li>"Almost done…"</li>
  </ul>
</li>
<li>Result appears as <strong>Passed</strong> (green check) or <strong>N errors</strong> (red X)</li>
</ol>

<div class="info">Polling timeout: 3 minutes. If the review hasn't returned by then, the page shows "Review timed out — the background process may have crashed." Try again, or check with TechOps.</div>

<h2>Findings Format</h2>

<p>Each finding has a severity:</p>
<ul>
<li><span style="color:#ef4444">●</span> <strong>Error</strong> — must fix before approving</li>
<li><span style="color:#f59e0b">▲</span> <strong>Warning</strong> — review and decide</li>
<li><span style="color:#3b82f6">ℹ</span> <strong>Info</strong> — informational only</li>
</ul>

<p>Findings include the rule that fired and a short explanation. Click "View full review history →" to see the run-by-run history for this deal.</p>

<h2>Feedback Loop</h2>

<p>After every review, you'll see <strong>"Was this review helpful?"</strong> with thumbs up/down:</p>
<ul>
<li><strong>👍 Positive</strong> — submit immediately, optional notes</li>
<li><strong>👎 Negative</strong> — choose this if findings were wrong, missed real issues, or were spammy. Add notes describing what was wrong.</li>
</ul>

<p>Submissions feed AI tuning. The first negative on a finding type is the most valuable — explicit examples of "the AI flagged X but X is actually fine here" help us calibrate.</p>

<h2>Review History</h2>

<p>Below the run buttons, the page lists every review ever run for this deal:</p>
<ul>
<li>Status dot (green = passed, red = failed)</li>
<li>Trigger source (manual, webhook, etc.)</li>
<li>Triggered-by user, timestamp, duration in ms</li>
<li>Findings list (collapsed if no findings)</li>
</ul>

<p>The 50 most recent reviews are shown.</p>

<h2>EagleView Integration</h2>

<p>The review page also embeds the EagleView TrueDesign panel — order or check status of an aerial measurement. EagleView orders fire automatically via HubSpot workflow when <code>EAGLEVIEW_AUTO_PULL_ENABLED</code> is true; the manual control here is for retries or one-off pulls.</p>

<h2>Common Failure Modes</h2>

<table>
<thead><tr><th>Symptom</th><th>What it means</th></tr></thead>
<tbody>
<tr><td>"Review timed out"</td><td>Background job didn't return within 3 minutes — likely a crash. Try again.</td></tr>
<tr><td>No "Design Review" button visible</td><td>Your role isn't in the allow-list. Ask an admin.</td></tr>
<tr><td>"No reviews yet"</td><td>Just hasn't been run for this deal — click the button to start.</td></tr>
</tbody>
</table>
`;

const SECTIONS = [
  { id: "tools-bom", group: "BOM Pipeline", title: "BOM Pipeline", color: "purple", order: 0, content: BOM },
  { id: "tools-ai-design-review", group: "Reviews", title: "AI Design Review", color: "orange", order: 1, content: AI_DESIGN_REVIEW },
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
