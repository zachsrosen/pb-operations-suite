/**
 * Seed the Catalog SOP tab and its initial "Submitting a New Product" section.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-product-creation.ts
 *
 * Idempotent: skips if the section already exists.
 * To rewrite content, pass --force.
 *
 * Migration: cleans up earlier placements (the original `ops-product-creation`
 * row in the `ops`/Project Pipeline tab, and the intermediate
 * `zi-product-creation` row in the `zoho-inventory` tab). Catalog deserves
 * its own SOP tab — it's a distinct workflow from inventory operations and
 * has room to grow (editing products, deduping, vendor management, etc.).
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

const FORCE = process.argv.includes("--force");

const TAB_ID = "catalog";
const TAB_LABEL = "Catalog";
const TAB_SORT = 8; // After zoho-inventory (7)

const SECTION_ID = "cat-submit-new-product";
const LEGACY_SECTION_IDS = ["ops-product-creation", "zi-product-creation"];
const SECTION_TITLE = "Submitting a New Product";
const SIDEBAR_GROUP = "Adding Products";
const DOT_COLOR = "cyan";

// ─── Section content ──────────────────────────────────────────────

const PRODUCT_CREATION = `
<h1>Submitting a New Product</h1>

<p>How to add a new piece of equipment to the catalog so it's available across HubSpot, Zuper, and Zoho. The Submit Product wizard handles all three system pushes for you.</p>

<div class="info"><strong>When to use this:</strong> the BOM tool flagged a missing item, you're processing a deal with new equipment, or a vendor sent something we haven't bought before.</div>

<h2>Where to Start</h2>

<p>Open <strong>Suites → Operations → Submit Product</strong> (or go to <code>/dashboards/submit-product</code> directly). The wizard has four steps:</p>

<table>
<thead><tr><th>Step</th><th>What you do</th></tr></thead>
<tbody>
<tr><td><strong>1. Start</strong></td><td>Pick how you want to populate the form</td></tr>
<tr><td><strong>2. Basics</strong></td><td>Brand, model, category, vendor, pricing</td></tr>
<tr><td><strong>3. Details</strong></td><td>Category-specific specs (wattage, capacity, etc.)</td></tr>
<tr><td><strong>4. Review</strong></td><td>Confirm everything and submit</td></tr>
</tbody>
</table>

<hr>

<h2>Step 1: Pick a Start Mode</h2>

<p>Three ways to begin — pick whichever gets you closest to the finished product fastest.</p>

<h3>Start from Scratch</h3>
<p>Blank form. Fill in everything by hand. Use this when the product is unusual or you can't find a similar one to clone.</p>

<h3>Clone Existing Product</h3>
<p>Search the catalog for a similar product, copy its specs into a new entry, then change brand/model/specs as needed.</p>
<div class="tip"><strong>Best for:</strong> adding a new wattage variant of a module you already carry, or a new size of a battery you've used before. Most fields stay the same — just bump the wattage or capacity.</div>

<h3>Import from Datasheet</h3>
<p>Upload the manufacturer's datasheet PDF (or paste the spec text). AI reads it and pre-fills the form.</p>
<div class="tip"><strong>Best for:</strong> brand-new equipment with a clean PDF spec sheet. You'll still review every field before submitting — AI extraction is a starting point, not a final answer.</div>

<hr>

<h2>Step 2: Basics</h2>

<p>The wizard checks for duplicates as you type. If a similar product already exists, it appears in the panel below the form — <strong>stop and check it</strong> before continuing. Submitting a duplicate creates cleanup work for ops and accounting.</p>

<p><strong>Required fields</strong></p>
<ul>
<li><strong>Category</strong> — module, inverter, battery, battery expansion, EV charger, racking, electrical BOS, monitoring</li>
<li><strong>Brand</strong> — manufacturer (e.g., Enphase, Tesla, REC). Pick from the dropdown when possible so we stay consistent.</li>
<li><strong>Model</strong> — exact model number from the datasheet</li>
<li><strong>Description</strong> — short human-readable name, used in HubSpot line items and Zoho SOs</li>
</ul>

<p><strong>Recommended fields</strong></p>
<ul>
<li><strong>Vendor</strong> — who we buy it from. Pick from the vendor list; if the vendor isn't there, add them via the vendor picker.</li>
<li><strong>Vendor part number</strong> — what the vendor calls it (helps match POs to invoices)</li>
<li><strong>Unit cost / sell price</strong> — required if this product will appear on a Sales Order</li>
<li><strong>SKU</strong> — internal SKU; auto-generated if left blank</li>
</ul>

<div class="warn"><strong>Duplicate panel:</strong> if the search finds an existing product that looks like a match, click into it instead of creating a new one. If the existing entry has wrong info, edit it rather than making a duplicate.</div>

<hr>

<h2>Step 3: Details</h2>

<p>The fields shown depend on the category you picked. Pull these from the datasheet — don't guess.</p>

<table>
<thead><tr><th>Category</th><th>Key spec fields</th></tr></thead>
<tbody>
<tr><td><strong>Module</strong></td><td>Wattage (W), efficiency, cell type, Voc / Isc / Vmp / Imp, temperature coefficients</td></tr>
<tr><td><strong>Inverter</strong></td><td>AC output (kW), max DC input, phase, MPPT channels, type (string / micro / hybrid)</td></tr>
<tr><td><strong>Battery</strong></td><td>Capacity (kWh), usable capacity, continuous power, chemistry, round-trip efficiency</td></tr>
<tr><td><strong>Battery Expansion</strong></td><td>Pass-through — link to its parent battery</td></tr>
<tr><td><strong>EV Charger</strong></td><td>Power (kW), connector type, amperage, voltage, level (1 / 2 / 3)</td></tr>
<tr><td><strong>Racking</strong></td><td>Mount type (roof / ground), material, tilt range, wind / snow ratings</td></tr>
<tr><td><strong>Electrical BOS</strong></td><td>Component type, gauge, voltage rating</td></tr>
<tr><td><strong>Monitoring</strong></td><td>Device type, connectivity (Wi-Fi / cellular / Ethernet), compatible inverters</td></tr>
</tbody>
</table>

<div class="info"><strong>Field tooltips:</strong> hover the <code>?</code> icon next to any field for a definition and example value. If you're unsure, leave it blank and add a note — better to skip a field than guess wrong.</div>

<hr>

<h2>Step 4: Review &amp; Submit</h2>

<p>Final pass before the product hits the catalog.</p>

<ol>
<li>Scan all fields one more time — typos here propagate to HubSpot line items, Zuper jobs, and Zoho SOs</li>
<li>Confirm the four system targets (HubSpot, Zuper, Zoho) are checked</li>
<li>Hit <strong>Submit</strong></li>
</ol>

<p><strong>What happens next</strong></p>
<ul>
<li><strong>Auto-approved:</strong> if every required field validates and there's no duplicate concern, the product is live immediately. You'll see "Product Added to Catalog" with a green checkmark.</li>
<li><strong>Pending review:</strong> if a field couldn't be validated or one of the system pushes failed, the product saves but goes into the admin review queue. An admin gets notified via email and works it from <code>/dashboards/catalog/review</code>.</li>
</ul>

<div class="info">Either way, the product is <strong>saved</strong> — you don't need to redo your work. Pending-review just means an admin needs to retry one of the external system pushes.</div>

<hr>

<h2>After Submission</h2>

<p>The wizard pushes the product to four places automatically:</p>

<table>
<thead><tr><th>System</th><th>What gets created</th></tr></thead>
<tbody>
<tr><td><strong>Internal catalog</strong> (Postgres)</td><td>Source of truth — drives the BOM tool, BOM line items, the catalog page</td></tr>
<tr><td><strong>HubSpot Products</strong></td><td>Line items on deals reference this — required for SO automation</td></tr>
<tr><td><strong>Zuper Custom Fields</strong></td><td>Field service techs see the spec on the job</td></tr>
<tr><td><strong>Zoho Inventory</strong></td><td>Sales Orders, Purchase Orders, stock counts</td></tr>
</tbody>
</table>

<p>Once the product is created, the BOM tool and the deal-to-SO pipeline can use it on the next run — no extra step needed.</p>

<hr>

<h2>Common Pitfalls</h2>

<h3>Duplicates</h3>
<p>The biggest source of cleanup work. Always pause when the duplicate panel shows a match — even if the brand or model is slightly different, it might be the same physical product with a typo. When in doubt, ping a TechOps admin before submitting.</p>

<div class="tip">If you discover a duplicate <em>after</em> the fact, use the <strong>Merge</strong> tool in the catalog dedup panel rather than deleting one — merging preserves the history and the link to existing line items.</div>

<h3>Vendor not in the list</h3>
<p>Don't type a free-text vendor name — the vendor picker syncs to Zoho and a free-text name won't match. Use the picker's "Add new vendor" option, which creates the vendor in Zoho first.</p>

<h3>Missing pricing</h3>
<p>If <strong>unit cost</strong> or <strong>sell price</strong> is blank, the product will save but Zoho SOs won't auto-populate the line. Always set pricing for anything that will be quoted or invoiced.</p>

<h3>Wrong category</h3>
<p>Category drives which spec fields appear and how the BOM tool counts the item (per-module vs per-system, etc.). Changing category later is a hassle — get it right on the first pass.</p>

<h3>Datasheet extraction errors</h3>
<p>AI extraction is convenient but not perfect. Always verify wattage, capacity, voltage, and current values against the actual PDF before submitting — those four numbers drive system sizing.</p>

<hr>

<h2>Editing an Existing Product</h2>

<p>If a product already exists but has wrong specs:</p>
<ol>
<li>Go to <strong>Catalog</strong> and search for the product</li>
<li>Open the detail page → <strong>Edit</strong></li>
<li>Change the fields → <strong>Save</strong> — the wizard re-pushes to HubSpot, Zuper, and Zoho automatically</li>
</ol>

<div class="warn">Edits propagate to <strong>future</strong> line items and SOs, not historical ones. If a deal already has the wrong spec on its line items, you'll need to re-push the BOM for that deal.</div>

<hr>

<h2>Who to Ask</h2>

<ul>
<li><strong>Duplicate / merge questions:</strong> TechOps</li>
<li><strong>Pricing questions:</strong> Accounting</li>
<li><strong>Vendor setup:</strong> Accounting (they own Zoho vendor records)</li>
<li><strong>Category / spec questions:</strong> TechOps or Design Engineering</li>
</ul>
`;

// ─── Section row ──────────────────────────────────────────────────

const SECTION = {
  id: SECTION_ID,
  tabId: TAB_ID,
  sidebarGroup: SIDEBAR_GROUP,
  title: SECTION_TITLE,
  dotColor: DOT_COLOR,
  // Use a high sort order so it lands at the end of the ops tab.
  // Adjust manually in the editor if you want it earlier.
  sortOrder: 100,
  content: PRODUCT_CREATION.trim(),
};

async function main() {
  // Create the Catalog tab if it doesn't exist yet.
  const existingTab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (!existingTab) {
    await prisma.sopTab.create({
      data: { id: TAB_ID, label: TAB_LABEL, sortOrder: TAB_SORT },
    });
    console.log(`Created tab: ${TAB_ID} (${TAB_LABEL})`);
  }

  // Migrate from prior placements (ops/Project Pipeline, then zoho-inventory).
  for (const legacyId of LEGACY_SECTION_IDS) {
    const legacy = await prisma.sopSection.findUnique({ where: { id: legacyId } });
    if (legacy) {
      await prisma.sopRevision.deleteMany({ where: { sectionId: legacyId } });
      await prisma.sopSuggestion.deleteMany({ where: { sectionId: legacyId } });
      await prisma.sopSection.delete({ where: { id: legacyId } });
      console.log(`Removed legacy section "${legacyId}" from tab "${legacy.tabId}".`);
    }
  }

  // Resolve sortOrder collisions by bumping to next free slot.
  let sortOrder = SECTION.sortOrder;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const conflict = await prisma.sopSection.findFirst({
      where: { tabId: TAB_ID, sortOrder },
    });
    if (!conflict || conflict.id === SECTION_ID) break;
    sortOrder += 1;
  }

  const existing = await prisma.sopSection.findUnique({ where: { id: SECTION_ID } });

  if (existing && !FORCE) {
    console.log(`Section "${SECTION_ID}" already exists — skipping (use --force to overwrite).`);
    return;
  }

  if (existing && FORCE) {
    await prisma.sopSection.update({
      where: { id: SECTION_ID },
      data: {
        sidebarGroup: SECTION.sidebarGroup,
        title: SECTION.title,
        dotColor: SECTION.dotColor,
        sortOrder,
        content: SECTION.content,
        version: { increment: 1 },
        updatedBy: "system@photonbrothers.com",
      },
    });
    console.log(`Overwrote section "${SECTION_ID}" (--force).`);
    return;
  }

  await prisma.sopSection.create({
    data: {
      id: SECTION.id,
      tabId: TAB_ID,
      sidebarGroup: SECTION.sidebarGroup,
      title: SECTION.title,
      dotColor: SECTION.dotColor,
      sortOrder,
      content: SECTION.content,
      version: 1,
      updatedBy: "system@photonbrothers.com",
    },
  });

  console.log(`Created section: ${SECTION_ID} — ${SECTION.title}`);
  console.log(`Navigate to: /sop?tab=${TAB_ID}#${SECTION_ID}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
