/**
 * Seed the meta-SOP — "How to Use the SOP Guide" — into the Reference tab.
 *
 * The Reference tab is public, so every authenticated user can read this.
 * Within-tab admin-only sections (ref-user-roles, ref-system) are still
 * gated separately.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-meta.ts
 *
 * Idempotent. Pass --force to overwrite content.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const FORCE = process.argv.includes("--force");

const TAB_ID = "ref";
const SECTION_ID = "ref-using-sop-guide";

const CONTENT = `
<h1>How to Use the SOP Guide</h1>

<p>The SOP Guide (this page) is the canonical knowledge base for the PB Tech Ops Suite. It's organized by tab, sub-organized by sidebar group, and each section is a focused page with steps, tables, and callouts.</p>

<h2>Finding What You Need</h2>

<ul>
<li><strong>Search bar</strong> at the top (or <code>Ctrl+K</code>) — searches across every section you have access to</li>
<li><strong>Tab bar</strong> — top navigation, one tab per topic area</li>
<li><strong>Sidebar</strong> — within a tab, lists every section grouped by category</li>
<li><strong>Direct URL</strong> — every tab is reachable at <code>/sop?tab=&lt;tabId&gt;</code> and every section at <code>/sop?tab=&lt;tabId&gt;#&lt;sectionId&gt;</code></li>
</ul>

<h2>Why You Can't See Some Tabs</h2>

<p>Tabs and sections are gated by your role. The lock icon next to a tab means it's gated. You'll only see tabs your role grants access to.</p>

<table>
<thead><tr><th>Visibility tier</th><th>Who can see it</th></tr></thead>
<tbody>
<tr><td><strong>Public</strong></td><td>All authenticated users</td></tr>
<tr><td><strong>Tab-gated</strong></td><td>Anyone with one or more matching roles (multi-role users get the union)</td></tr>
<tr><td><strong>Section-gated</strong></td><td>Within a visible tab, specific sections may still be hidden</td></tr>
<tr><td><strong>Admin / Owner / Executive</strong></td><td>Bypass all gates — see everything</td></tr>
</tbody>
</table>

<div class="info"><strong>Multi-role users</strong> get the union of every role's permissions. So a user with <code>SALES</code> + <code>SERVICE</code> sees both teams' tabs.</div>

<h2>Public Tabs (everyone)</h2>

<ul>
<li><strong>HubSpot Guide</strong> — basic CRM workflows</li>
<li><strong>Project Pipeline</strong> — pipeline-stage overviews</li>
<li><strong>Reference</strong> — general reference (you're here)</li>
<li><strong>Zoho Inventory</strong> — inventory workflow</li>
<li><strong>Catalog</strong> — submitting new products</li>
<li><strong>Suites</strong> — directory of the 10 departmental suites</li>
</ul>

<h2>Role-Gated Tabs</h2>

<p>You'll see these only if your role qualifies:</p>

<ul>
<li><strong>Service</strong> — Service triage workflows</li>
<li><strong>Scheduling</strong> — Site Survey / Construction / Inspection / Service schedulers</li>
<li><strong>Forecast</strong> — Timeline / Schedule / Accuracy</li>
<li><strong>AHJ &amp; Utility</strong> — Per-AHJ and per-utility analytics</li>
<li><strong>Tools</strong> — BOM Pipeline, Hubs, Surveyor, Schedules, Maps, Workflows</li>
<li><strong>Action Queues</strong> — D&amp;E and P&amp;I daily action queues</li>
<li><strong>Executive</strong> — Leadership dashboards (admin / owner / executive only)</li>
<li><strong>Accounting</strong> — Payment workflows (accounting + admin)</li>
<li><strong>Sales &amp; Marketing</strong> — Sales pipeline and quoting tools</li>
</ul>

<hr>

<h2>Editing Sections</h2>

<p>Three permission tiers control what you can do with a section:</p>

<table>
<thead><tr><th>Your role</th><th>What you can do</th></tr></thead>
<tbody>
<tr><td><strong>ADMIN / OWNER / EXECUTIVE</strong></td><td>Full edit — write directly with the in-app HTML editor (CodeMirror). Edits write through immediately and create a SopRevision row in the audit log.</td></tr>
<tr><td><strong>Any other authenticated role (not VIEWER)</strong></td><td>Submit a suggestion — same editor, but saves as a SopSuggestion in PENDING state. An admin reviews and approves or rejects.</td></tr>
<tr><td><strong>VIEWER</strong></td><td>Read-only.</td></tr>
</tbody>
</table>

<h2>The Edit / Suggest Flow</h2>

<ol>
<li>Open a section you want to edit or suggest a change to</li>
<li>Click the <strong>Edit</strong> button in the top-right (or <strong>Suggest</strong> if you don't have edit rights)</li>
<li>The editor opens with the current HTML content + a live preview pane</li>
<li>Make your changes — write semantic HTML (<code>&lt;h2&gt;</code>, <code>&lt;table&gt;</code>, <code>&lt;ul&gt;</code>, etc.)</li>
<li>Add a brief <strong>edit summary</strong> describing what changed and why</li>
<li>Click <strong>Save</strong> (admins) or <strong>Submit suggestion</strong> (non-admins)</li>
</ol>

<h2>HTML Conventions Used Here</h2>

<p>The SOP renderer styles a small set of semantic classes consistently. Use these in your edits:</p>

<table>
<thead><tr><th>Pattern</th><th>Renders as</th></tr></thead>
<tbody>
<tr><td><code>&lt;div class="info"&gt;...&lt;/div&gt;</code></td><td>Blue informational callout</td></tr>
<tr><td><code>&lt;div class="warn"&gt;...&lt;/div&gt;</code></td><td>Amber warning callout</td></tr>
<tr><td><code>&lt;div class="tip"&gt;...&lt;/div&gt;</code></td><td>Green tip callout</td></tr>
<tr><td><code>&lt;div class="sys"&gt;...&lt;/div&gt;</code></td><td>System-action callout</td></tr>
<tr><td><code>&lt;code&gt;something&lt;/code&gt;</code></td><td>Inline code formatting</td></tr>
<tr><td><code>&lt;table&gt;...&lt;/table&gt;</code></td><td>Striped data table</td></tr>
</tbody>
</table>

<h2>Optimistic Locking</h2>

<p>Every section has a version number. When you save, your edit must match the current version — if someone else saved while you were editing, you'll get a "version conflict" error and need to merge their changes into yours before retrying.</p>

<h2>Revision History</h2>

<p>Every save creates a <code>SopRevision</code> row capturing the previous content, who edited it, when, and the edit summary. Admins can browse the history of any section.</p>

<h2>Suggestion Review (Admins)</h2>

<p>If non-admins submit suggestions, a badge appears next to the Edit button showing the pending count. Admins click through to review, approve, or reject each suggestion with optional review notes. Approved suggestions become live edits with attribution to the original suggester.</p>

<hr>

<h2>Maintaining the Guide</h2>

<p>The SOP guide stays useful only if it stays current. A few habits:</p>

<ul>
<li><strong>When you change a tool</strong>, update its SOP section in the same PR. Don't ship workflow changes without updating the docs.</li>
<li><strong>When you onboard someone</strong>, point them at the public tabs first, then their team-gated tabs. Watch them use it. Anything confusing? Edit the SOP.</li>
<li><strong>When you fix a recurring confusion</strong> in chat or a meeting, ask yourself if the fix belongs in an SOP section. Add a "Common Pitfalls" entry if so.</li>
<li><strong>When a feature is deprecated</strong>, mark its section with a <code>&lt;div class="warn"&gt;</code> deprecation notice rather than deleting — the institutional knowledge of <em>why</em> something was removed is valuable.</li>
</ul>

<h2>Adding a New Tab or Section</h2>

<p>Adding new content via seed scripts (rather than the in-app editor) is the right move when:</p>
<ul>
<li>You're adding many sections at once</li>
<li>You want the content version-controlled in git</li>
<li>You're building a new tab from scratch</li>
</ul>

<p>The pattern lives in <code>scripts/seed-sop-*.ts</code>. Each script:</p>
<ol>
<li>Imports <code>PrismaClient</code> + <code>PrismaNeon</code></li>
<li>Defines a tab ID, label, sortOrder</li>
<li>Lists sections with HTML content as TS template strings</li>
<li>Idempotent main() — skips existing rows; <code>--force</code> overwrites with version increment</li>
</ol>

<p>If the tab needs to be gated, also update <code>src/lib/sop-access.ts</code>:</p>
<ul>
<li>Add to <code>PUBLIC_TABS</code> if everyone should see it</li>
<li>Add to <code>TAB_ROLE_GATES</code> with the allowed roles if team-specific</li>
<li>Add to <code>SECTION_ROLE_GATES</code> for sensitive sections within otherwise-visible tabs (empty array = admin-only)</li>
</ul>

<p>After running the seed, the new content is live immediately — Vercel rebuilds aren't required since the SOP system is database-driven.</p>
`;

async function main() {
  const tab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!tab) {
    console.error(`ERROR: Tab "${TAB_ID}" doesn't exist.`);
    process.exit(1);
  }

  const existing = await prisma.sopSection.findUnique({ where: { id: SECTION_ID } });

  // Find a free sortOrder near the top of the Reference tab so it's discoverable.
  let sortOrder = 0;
  while (true) {
    const conflict = await prisma.sopSection.findFirst({
      where: { tabId: TAB_ID, sortOrder },
    });
    if (!conflict || conflict.id === SECTION_ID) break;
    sortOrder += 1;
  }

  if (existing && !FORCE) {
    console.log(`Section "${SECTION_ID}" already exists — skipping (--force to overwrite).`);
    return;
  }

  if (existing && FORCE) {
    await prisma.sopSection.update({
      where: { id: SECTION_ID },
      data: {
        sidebarGroup: "Using This Guide",
        title: "How to Use the SOP Guide",
        dotColor: "blue",
        sortOrder,
        content: CONTENT.trim(),
        version: { increment: 1 },
        updatedBy: "system@photonbrothers.com",
      },
    });
    console.log(`Overwrote section "${SECTION_ID}" (--force).`);
    return;
  }

  await prisma.sopSection.create({
    data: {
      id: SECTION_ID,
      tabId: TAB_ID,
      sidebarGroup: "Using This Guide",
      title: "How to Use the SOP Guide",
      dotColor: "blue",
      sortOrder,
      content: CONTENT.trim(),
      version: 1,
      updatedBy: "system@photonbrothers.com",
    },
  });

  console.log(`Created section: ${SECTION_ID} — How to Use the SOP Guide`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
