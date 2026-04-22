/**
 * Seed the Zoho Inventory tab and sections into SOP.
 *
 * Usage:
 *   source .env && npx tsx scripts/seed-sop-inventory.ts
 *
 * Idempotent: skips existing tab/sections.
 * To reset: pass --force to delete and recreate.
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

const TAB_ID = "zoho-inventory";
const TAB_LABEL = "Zoho Inventory";
const TAB_SORT = 7; // After ref (6)

// ─── Section content ──────────────────────────────────────────────

const WORKFLOW_OVERVIEW = `
<h1>Zoho Inventory Workflow</h1>

<p>End-to-end inventory lifecycle for solar projects — from Sales Order creation through final invoicing. Six stages across Ops and Accounting, with three steps automated by the system.</p>

<h2>Workflow Overview</h2>

<table>
<thead>
<tr>
<th style="width:5%">#</th>
<th style="width:20%">Step</th>
<th style="width:10%">Owner</th>
<th style="width:15%">Trigger</th>
<th style="width:18%">Status</th>
<th style="width:32%">Inventory Effect</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>1</strong></td>
<td><strong>Create Sales Order (SO)</strong></td>
<td>Ops</td>
<td>Ready To Build</td>
<td><span class="sp">Confirmed</span></td>
<td>Inventory <strong>"Committed"</strong> — reserved but still in stock</td>
</tr>
<tr>
<td><strong>2</strong></td>
<td><strong>Create Purchase Order (PO)</strong></td>
<td>Ops</td>
<td>SO created</td>
<td><span class="sp">Issued</span></td>
<td>No stock change — order sent to vendor</td>
</tr>
<tr>
<td><strong>3</strong></td>
<td><strong>Receive Purchase Order (PR)</strong></td>
<td>Ops</td>
<td>Shipment arrives</td>
<td><span class="sp">Received</span></td>
<td>Inventory <strong>into physical stock</strong></td>
</tr>
<tr>
<td><strong>4</strong></td>
<td><strong>Pick / Pack / Ship (PKG/SHP)</strong></td>
<td>Ops</td>
<td>Install date</td>
<td><span class="sp">Shipped</span></td>
<td>Inventory <strong>out of physical stock</strong></td>
</tr>
<tr>
<td><strong>5</strong></td>
<td><strong>Invoice Sales Order (INV)</strong></td>
<td>Acctg</td>
<td>Construction complete</td>
<td><span class="sp">Confirmed</span></td>
<td>Inventory <strong>out of accounting stock</strong> — closes SO</td>
</tr>
<tr>
<td><strong>6</strong></td>
<td><strong>Receive Vendor Bill</strong></td>
<td>Acctg</td>
<td>Bill received</td>
<td>—</td>
<td>Inventory <strong>into accounting stock</strong> — closes PO</td>
</tr>
</tbody>
</table>

<hr>

<h2>Stage Details</h2>

<h3>1. Sales Order (SO)</h3>

<div class="sys">Automated at <strong>Ready To Build</strong> stage</div>

<p><em>One SO per project (PROJ)</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Complete listing of all materials the install team needs for the project (stock &amp; special order items)</li>
<li>The SO is the comprehensive list — even items pulled from warehouse stock should appear here</li>
</ul>

<p><strong>Timing</strong></p>
<ul>
<li>Project has moved into construction scheduled</li>
<li>Can also be created manually by extracting the BOM from HubSpot into Zoho</li>
</ul>

<p><strong>Key Fields</strong></p>
<table>
<thead><tr><th>Field</th><th>Value</th></tr></thead>
<tbody>
<tr><td>SO #</td><td>Matches deal number (PROJ-####)</td></tr>
<tr><td>Reference #</td><td><code>PROJ-### | Customer Name</code></td></tr>
<tr><td>Order Date</td><td>Current date</td></tr>
<tr><td>Expected Shipment Date</td><td>Construction schedule date</td></tr>
</tbody>
</table>

<div class="info">When viewing a sales order, you can see how much inventory is currently available. The system pulls directly from warehouse stock.</div>

<hr>

<h3>2. Purchase Order (PO)</h3>

<p><em>Multiple POs per Sales Order</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Listing of all materials needed to order from vendors</li>
<li>Emailed to supplier to purchase required inventory</li>
</ul>

<p><strong>Timing</strong></p>
<ul>
<li>At creation of the Sales Order (convert from SO via three-dot menu)</li>
</ul>

<p><strong>Creating a PO from a Sales Order</strong></p>
<ol>
<li>Open saved Sales Order → three-dot menu → "Convert to Purchase Order" → confirm "Yes"</li>
<li>Select the <strong>vendor</strong> you are ordering from</li>
<li>Set the <strong>delivery date</strong></li>
<li><strong>Remove items</strong> that are already in stock or will be pulled from the warehouse</li>
<li>Remove items not being ordered from this specific vendor</li>
<li>Save and send</li>
</ol>

<p><strong>Key Fields</strong></p>
<table>
<thead><tr><th>Field</th><th>Value</th></tr></thead>
<tbody>
<tr><td>PO #</td><td>Matches deal number (PROJ-####)</td></tr>
<tr><td>Reference #</td><td>Sales Order # only (no name or additional information)</td></tr>
<tr><td>Order Date</td><td>Current date</td></tr>
<tr><td>Delivery Date</td><td>When shipment is needed</td></tr>
<tr><td>Delivery Address</td><td>Warehouse name and address</td></tr>
</tbody>
</table>

<div class="tip"><strong>Reference # format:</strong> Only include the Sales Order number on the PO reference — do not add customer name or other info.</div>

<div class="tip"><strong>Multiple vendors:</strong> If parts are needed from different vendors, create a separate PO for each. Remove the items not from that vendor on each PO.</div>

<hr>

<h3>3. Purchase Receives (PR)</h3>

<p><em>Multiple PRs per Purchase Order</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Records receipt of inventory and moves it into physical stock count</li>
</ul>

<p><strong>Timing</strong></p>
<ul>
<li>When inventory is received from vendor at the delivery location</li>
</ul>

<p><strong>How to Receive</strong></p>
<ol>
<li>Locate the PO number (usually on the shipping slip)</li>
<li>Verify all received line items against the PO</li>
<li>Hit "Receive"</li>
<li>If partial shipment: adjust quantity to what was actually received → system creates another slip for the remaining items</li>
</ol>

<div class="warn"><strong>Important rules:</strong>
<ul style="margin:6px 0 0 0">
<li>Only receive items that are physically in the shipment</li>
<li>If a backorder occurs, it must be a <strong>separate PR</strong></li>
<li>Vendor bills can only match to a <strong>full PR</strong> — partial receives break the match</li>
<li>Always <strong>double check quantity</strong> against packing slip</li>
<li>If an incorrect item was sent, receive it under a <strong>separate PR</strong></li>
<li><strong>Receive promptly</strong> — Accounting often gets the invoice within 1–2 days and will auto-receive if the team hasn't done it</li>
</ul>
</div>

<hr>

<h3>4. Pick / Pack / Ship (PKG/SHP)</h3>

<div class="sys">Automated on <strong>Date Installation Begins</strong></div>

<p><em>One per Sales Order</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Reserves inventory in physical stock count once <strong>"confirmed"</strong></li>
<li>Removes inventory from physical stock count once <strong>"shipped"</strong></li>
</ul>

<p><strong>Timing</strong></p>
<ul>
<li>Start of construction</li>
</ul>

<div class="info"><strong>At Photon Brothers, this is all one step.</strong> The three sub-stages are:</div>

<table>
<thead><tr><th>Sub-step</th><th>What it means</th><th>PB approach</th></tr></thead>
<tbody>
<tr><td><strong>Pick</strong></td><td>Pulling items from shelves</td><td>PB does not do this step</td></tr>
<tr><td><strong>Pack</strong></td><td>Consolidating items on cart</td><td><code>PKG-####</code> (project number)</td></tr>
<tr><td><strong>Ship</strong></td><td>Loading items onto truck</td><td><code>SHP-####</code> (auto assigned number)</td></tr>
</tbody>
</table>

<div class="warn"><strong>Pack &amp; Ship dates must be set to when inventory actually leaves the warehouse.</strong></div>

<hr>

<h3>5. Invoice (INV)</h3>

<div class="sys">Automated at <strong>Construction Complete</strong></div>

<p><em>One per Sales Order</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Removes inventory from accounting stock count</li>
<li>Closes the Sales Order</li>
</ul>

<p><strong>Timing</strong></p>
<ul>
<li>Following Pick/Pack/Ship completion</li>
</ul>

<p><strong>Key Fields</strong></p>
<table>
<thead><tr><th>Field</th><th>Value</th></tr></thead>
<tbody>
<tr><td>Invoice Date</td><td>Construction complete date</td></tr>
</tbody>
</table>

<hr>

<h3>6. Receive Vendor Bill</h3>

<p><em>Accounting</em></p>

<p><strong>Purpose</strong></p>
<ul>
<li>Records vendor costs into accounting stock</li>
<li>Closes the Purchase Order</li>
</ul>

<p><strong>Process</strong></p>
<ul>
<li>Accounting matches the invoice to the corresponding PO</li>
<li>Vendor invoices are often numbered with dashes (e.g., PO-1, PO-2) for partial shipments related to the same order</li>
</ul>

<hr>

<h2>Quick Reference</h2>

<table>
<thead>
<tr><th>Relationship</th><th>Ratio</th></tr>
</thead>
<tbody>
<tr><td>Projects → Sales Orders</td><td>1 : 1</td></tr>
<tr><td>Sales Orders → Purchase Orders</td><td>1 : Many</td></tr>
<tr><td>Purchase Orders → Purchase Receives</td><td>1 : Many</td></tr>
<tr><td>Sales Orders → Pack/Ship</td><td>1 : 1</td></tr>
<tr><td>Sales Orders → Invoice</td><td>1 : 1</td></tr>
</tbody>
</table>
`;

const EDGE_CASES = `
<h1>Edge Cases &amp; Exceptions</h1>

<p>Common scenarios that fall outside the standard workflow. These apply to all locations.</p>

<h2>Pulling from Stock (No PO Needed)</h2>

<p>When items are already in warehouse stock and don't need to be ordered:</p>
<ol>
<li><strong>Confirm</strong> the Sales Order (all items appear on SO regardless of source)</li>
<li><strong>Do not</strong> create a Purchase Order for stocked items</li>
<li>Create a <strong>Package and Shipment</strong> directly to account for items leaving the warehouse</li>
</ol>

<div class="info">The Sales Order is the comprehensive list of everything the job needs. The Purchase Order is only for items that need to be ordered from a vendor.</div>

<hr>

<h2>Ramp Card / Credit Card Purchases</h2>

<p>For items purchased with a Ramp card (e.g., picking up pavers/blocks for ballast kits):</p>

<div class="warn"><strong>Do NOT create a Purchase Order</strong> for Ramp card purchases.</div>

<ul>
<li>Use an <strong>Inventory Adjustment</strong> instead to add items to stock</li>
<li>This also applies to any ad-hoc pickups paid by credit card on the way to a job</li>
<li>If accounting cannot close an SO because of these items, they will do an inventory adjustment for the line item to allow the SO to close</li>
</ul>

<hr>

<h2>Multiple Vendors for One Job</h2>

<p>When parts for a single Sales Order come from different vendors:</p>
<ol>
<li>Convert SO to PO for the <strong>first vendor</strong></li>
<li>Remove all items <strong>not</strong> being ordered from that vendor</li>
<li>Save and send the PO</li>
<li>Go back to the SO → create <strong>another PO</strong> for the next vendor</li>
<li>Repeat for each vendor</li>
</ol>

<div class="tip">The SO stays the same — it's the master list. Each PO is just a slice of the SO for a specific vendor.</div>

<hr>

<h2>Bulk / Stock Purchase Orders</h2>

<p>For ordering inventory not tied to a specific project (replenishing stock):</p>

<ol>
<li>Go to <strong>Purchase Orders</strong> → create new (top corner button)</li>
<li>Select the <strong>vendor</strong></li>
<li>Select the correct <strong>warehouse</strong></li>
<li>Search and add items, set quantities</li>
<li>Save and send</li>
</ol>

<div class="warn"><strong>Warehouse default:</strong> Centennial is the default warehouse on all forms (SOs, POs, everything). Always verify you have the correct warehouse selected before saving.</div>

<p>Every bulk purchase still requires a PO — even if not originating from a sales order — so accounting can match invoices.</p>

<hr>

<h2>Partial Receives</h2>

<p>When only part of an order arrives:</p>
<ol>
<li>Open the Purchase Order</li>
<li>In "Receive Items," adjust the <strong>quantity to what was actually received</strong></li>
<li>Mark items not yet received as <strong>zero</strong></li>
<li>Save as received</li>
<li>The system automatically creates another receive slip for the <strong>remaining items</strong></li>
</ol>

<div class="info">Accounting expects partial receives to happen. Vendor invoices are often numbered (e.g., -1, -2) to correspond to partial shipments. Receiving promptly prevents accounting from auto-receiving and keeps counts accurate.</div>

<hr>

<h2>Missing BOM Items</h2>

<p>The automated BOM extraction currently does not capture all items. Known gaps:</p>
<ul>
<li><strong>Breakers</strong> — not typically included in planset BOMs. Check the <strong>one-line diagram</strong> to identify required breakers.</li>
<li><strong>Wire lengths</strong> — standard wire (THHN 6, etc.) is ordered as bulk stock, not per-job. Job-specific wire (e.g., 1/2/3 gauge for MPUs) should be ordered per job.</li>
<li><strong>Twins / panel accessories</strong> — items like twins for main panel space should be added to the SO manually.</li>
</ul>

<div class="you">If the BOM tool pulls incorrect information, submit feedback via the BOM tool so errors can be corrected.</div>

<hr>

<h2>Damaged / Defective Items</h2>

<p>If a part is found defective or damaged:</p>
<ul>
<li>Use the <strong>Damaged Items</strong> category in Zoho to account for the part</li>
<li>Do not leave it as regular stock — it will skew inventory counts</li>
<li>Field techs should report defective parts immediately so the adjustment can be made</li>
</ul>

<hr>

<h2>Inventory Adjustments</h2>

<p>Use inventory adjustments when items enter or leave stock <strong>outside the normal PO/SO flow</strong>:</p>

<table>
<thead><tr><th>Scenario</th><th>Action</th></tr></thead>
<tbody>
<tr><td>Ramp card / credit card pickup</td><td>Inventory adjustment to add items</td></tr>
<tr><td>Damaged or defective part</td><td>Adjustment to damaged items category</td></tr>
<tr><td>SO won't close due to missing stock record</td><td>Accounting does a one-line-item adjustment</td></tr>
<tr><td>Quarter-end stock counts</td><td>Adjustments to reconcile physical vs. system counts</td></tr>
</tbody>
</table>
`;

const CALIFORNIA_OPS = `
<h1>California Operations</h1>

<p>California-specific inventory procedures. CA operates a bulk-stock model rather than per-job ordering due to distributor reliability challenges.</p>

<h2>Ordering Model</h2>

<div class="info">California does <strong>not</strong> need to follow the Colorado per-job ordering model. CA can order stock at any cadence.</div>

<p><strong>How CA orders:</strong></p>
<ul>
<li><strong>Rail, attachments, breakers:</strong> Stocked in bulk at the shop. Reordered when running low.</li>
<li><strong>Job-specific items:</strong> Ordered per job (e.g., specific three-phase inverters for commercial jobs). Reference the customer's last name on the PO for warehouse identification.</li>
<li><strong>Electrical distributor (CES):</strong> Visits the shop approximately every 2 weeks, checks inventory, and reorders automatically. QR-based scanning system available.</li>
<li><strong>Standard wire (THHN, 6 gauge):</strong> Ordered as bulk stock. Job-specific wire (1/2/3 gauge for MPUs) ordered per job.</li>
</ul>

<h3>Why Bulk Ordering</h3>
<p>CED (CA distributor) is unreliable — lead times of 1.5 to 2+ weeks for standard materials like rail and attachments are common. Competitors in the area also stock their shops, depleting local supply. Bulk ordering prevents construction delays.</p>

<hr>

<h2>Stock Flow for Bulk-Ordered Items</h2>

<p>When items are pulled from existing warehouse stock for a job:</p>

<ol>
<li><strong>Confirm</strong> the Sales Order (items show as available from inventory)</li>
<li><strong>Skip</strong> creating a PO for stocked items</li>
<li>Create <strong>Package → Shipment</strong> to account for items leaving the warehouse</li>
</ol>

<p>When warehouse stock needs replenishing:</p>
<ol>
<li>Create a <strong>standalone PO</strong> (not from a sales order)</li>
<li>Select vendor and <strong>CA warehouse</strong> (not Centennial)</li>
<li>Add items and quantities needed</li>
<li>When received, create a <strong>Purchase Receive</strong> to add to stock</li>
</ol>

<div class="warn"><strong>Every purchase must have a PO</strong> — even bulk stock orders — so accounting can match invoices. The only exception is Ramp card purchases (use inventory adjustments instead).</div>

<hr>

<h2>Getting Started: Quarter-End Stock Counts</h2>

<p>For locations onboarding to Zoho inventory, the starting process is a quarter-end stock adjustment:</p>

<ol>
<li>Accounting issues <strong>stock counts</strong> broken into small groups (15–20 counts)</li>
<li>Groups are organized by category: modules, batteries, inverters, rail, breakers, etc.</li>
<li>Team physically counts each group and enters the actual quantity</li>
<li>Zoho adjusts stock to match the physical count</li>
</ol>

<div class="tip">Breaking counts into small groups prevents the entire stock count from getting stuck on a single discrepancy. Each group can be completed independently.</div>
`;

const SERVICE_RMA = `
<h1>Service &amp; RMA Inventory</h1>

<p>Inventory procedures for service operations, Return Material Authorizations (RMAs), and field truck stock.</p>

<div class="review">This area is actively evolving. Integration with vendor portals (Tesla Energy Service Portal, SolarEdge, etc.) is planned to automate much of the manual entry described here.</div>

<h2>Service Parts from Inventory</h2>

<p>When a service job needs parts from warehouse stock:</p>
<ol>
<li>Check Zoho to see if the part is available in inventory</li>
<li>If available, pull from stock</li>
<li>Account for the part leaving the warehouse via package/shipment or inventory adjustment</li>
</ol>

<div class="info">Service teams need to track all parts used — even if pulled from general stock for a repair. Untracked usage causes inventory counts to drift.</div>

<hr>

<h2>RMA (Return Material Authorization)</h2>

<p>RMA parts are vendor warranty replacements and require special handling:</p>

<h3>Key Principle</h3>
<div class="warn"><strong>RMA parts should be tracked by customer, not as general stock.</strong> They are received for a specific customer's warranty claim and should be linked to that customer/deal in Zoho.</div>

<h3>RMA Flow</h3>
<ol>
<li>Vendor ships replacement part to warehouse</li>
<li>Receive the part into Zoho, <strong>associated with the customer</strong></li>
<li>When the service team takes the part for the job, account for it leaving inventory</li>
<li>If the RMA part doesn't match what's needed (common with Tesla), flag it and work with the vendor</li>
</ol>

<h3>Using Stock for an RMA Job</h3>
<p>If the correct RMA part hasn't arrived but you have the part in stock:</p>
<ol>
<li>Pull the part from general stock for the service job</li>
<li>When the RMA replacement eventually arrives, receive it <strong>back to general stock</strong> (it's replacing what was used)</li>
</ol>

<hr>

<h2>Service Truck Inventory</h2>

<p>Service trucks carry common parts for on-site repairs (breakers, TRMs, backup switches, etc.).</p>

<ul>
<li>Truck inventory should be tracked — consider setting up service trucks as inventory locations in Zoho</li>
<li>When a tech uses a part from the truck, it needs to be accounted for</li>
<li>If a truck part is found defective, report immediately and move to the <strong>damaged items</strong> category</li>
<li>Regular truck inventory counts (e.g., weekly) help keep numbers accurate</li>
</ul>

<hr>

<h2>D&amp;R (Detach &amp; Reset) Parts</h2>

<p>D&amp;R jobs also consume parts that need tracking. Currently, parts used on D&amp;R jobs are often unallocated — they need to be accounted for just like install jobs.</p>

<div class="you">When using parts for a D&amp;R job, follow the same SO → Package/Ship flow to account for items leaving the warehouse.</div>

<hr>

<h2>Vendor Portal Integration (Planned)</h2>

<p>Future integration will connect vendor portals (Tesla Energy Service Portal, SolarEdge, etc.) with PB Tech Ops Suite and Zoho:</p>
<ul>
<li>Automatically pull tracking numbers and case information</li>
<li>Reduce manual sales order creation for service tickets</li>
<li>Improve RMA part tracking and receipt verification</li>
</ul>
`;

// ─── Sections to create ──────────────────────────────────────────

const SECTIONS = [
  {
    id: "zi-workflow",
    sidebarGroup: "Inventory Workflow",
    title: "Workflow Overview",
    dotColor: "blue",
    sortOrder: 0,
    content: WORKFLOW_OVERVIEW.trim(),
  },
  {
    id: "zi-edge-cases",
    sidebarGroup: "Inventory Workflow",
    title: "Edge Cases & Exceptions",
    dotColor: "amber",
    sortOrder: 1,
    content: EDGE_CASES.trim(),
  },
  {
    id: "zi-california",
    sidebarGroup: "By Location",
    title: "California Operations",
    dotColor: "green",
    sortOrder: 2,
    content: CALIFORNIA_OPS.trim(),
  },
  {
    id: "zi-service-rma",
    sidebarGroup: "Service Inventory",
    title: "Service & RMA",
    dotColor: "teal",
    sortOrder: 3,
    content: SERVICE_RMA.trim(),
  },
];

async function main() {
  // ── Handle --force ──
  if (FORCE) {
    // Delete old single section from ops tab if it exists
    await prisma.sopSection.deleteMany({ where: { id: "ops-zoho-inventory" } });
    // Delete sections in this tab
    await prisma.sopSection.deleteMany({ where: { tabId: TAB_ID } });
    await prisma.sopTab.deleteMany({ where: { id: TAB_ID } });
    console.log("Cleaned up existing Zoho Inventory tab and sections.");
  }

  // ── Also clean up the old ops-tab section if it exists ──
  const oldSection = await prisma.sopSection.findUnique({ where: { id: "ops-zoho-inventory" } });
  if (oldSection) {
    await prisma.sopSection.delete({ where: { id: "ops-zoho-inventory" } });
    console.log("Removed old ops-zoho-inventory section from ops tab.");
  }

  // ── Create tab ──
  const existingTab = await prisma.sopTab.findUnique({ where: { id: TAB_ID } });
  if (existingTab) {
    console.log(`Tab "${TAB_ID}" already exists — skipping tab creation.`);
  } else {
    await prisma.sopTab.create({
      data: {
        id: TAB_ID,
        label: TAB_LABEL,
        sortOrder: TAB_SORT,
      },
    });
    console.log(`Created tab: ${TAB_ID} (${TAB_LABEL})`);
  }

  // ── Create sections ──
  for (const section of SECTIONS) {
    const existing = await prisma.sopSection.findUnique({ where: { id: section.id } });
    if (existing) {
      console.log(`  Section "${section.id}" already exists — skipping.`);
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

  console.log(`\nDone! Navigate to: /sop?tab=zoho-inventory`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
