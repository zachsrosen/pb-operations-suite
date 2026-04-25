/**
 * Fix the auto-fixable issues found by _audit-catalog-integrity.ts:
 *   1. Re-write cross-link IDs for the 11 mismatched rows
 *   2. Null out the 4 broken HubSpot links (InternalProduct points to a deleted HubSpot Product)
 *   3. Backfill missing vendor_name + vendor_part_number on linked HubSpot Products
 *
 * Idempotent. Pass --confirm to actually apply.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_fix-catalog-integrity.ts [--confirm]
 */
import { prisma, logActivity } from "../src/lib/db";
import { writeCrossLinkIds } from "../src/lib/catalog-cross-link";
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const DRY_RUN = !process.argv.includes("--confirm");

interface AuditFile {
  cross_link_mismatches: Array<{ id: string; system: string; field: string; expected: string; actual: string | null }>;
  broken_external_ids: { hubspot: Array<{ id: string; ext: string }>; zoho: Array<{ id: string; ext: string }>; zuper: Array<{ id: string; ext: string }> };
}

async function fixCrossLinks(audit: AuditFile): Promise<void> {
  if (!prisma) throw new Error("prisma");
  // Group mismatches by InternalProduct id
  const byId = new Map<string, Set<string>>();
  for (const m of audit.cross_link_mismatches) {
    const set = byId.get(m.id) ?? new Set();
    set.add(`${m.system}.${m.field}`);
    byId.set(m.id, set);
  }
  console.log(`\n──── 1. Cross-link mismatches (${byId.size} unique InternalProducts) ────`);
  for (const [id, fields] of byId) {
    const row = await prisma.internalProduct.findUnique({
      where: { id },
      select: { id: true, brand: true, model: true, hubspotProductId: true, zohoItemId: true, zuperItemId: true },
    });
    if (!row) {
      console.log(`  ${id}: NOT FOUND, skip`);
      continue;
    }
    console.log(`  ${id} "${row.brand} ${row.model}"  fields=${[...fields].join(",")}`);
    if (DRY_RUN) {
      console.log(`    DRY RUN: would call writeCrossLinkIds`);
      continue;
    }
    const result = await writeCrossLinkIds({
      internalProductId: row.id,
      hubspotProductId: row.hubspotProductId,
      zohoItemId: row.zohoItemId,
      zuperItemId: row.zuperItemId,
    });
    const status = result.warnings.length === 0 ? "✓" : "⚠";
    console.log(`    ${status} attempted=${result.attempted.join(",")} warnings=${result.warnings.length}`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`      ${w}`);
    }
    await logActivity({
      type: "CATALOG_PRODUCT_UPDATED",
      description: `Cross-link IDs re-written for ${row.brand} ${row.model} (integrity audit fix)`,
      userEmail: "zach@photonbrothers.com",
      userName: "Phase B integrity-fix script",
      entityType: "internal_product",
      entityId: row.id,
      entityName: `${row.brand} ${row.model}`.trim(),
      metadata: { changedFields: [...fields], source: "integrity_audit_fix" },
      riskLevel: "LOW",
    });
  }
}

async function nullBrokenHubSpotLinks(audit: AuditFile): Promise<void> {
  if (!prisma) throw new Error("prisma");
  console.log(`\n──── 2. Broken HubSpot links (${audit.broken_external_ids.hubspot.length} rows) ────`);
  for (const b of audit.broken_external_ids.hubspot) {
    const row = await prisma.internalProduct.findUnique({
      where: { id: b.id },
      select: { id: true, brand: true, model: true, hubspotProductId: true },
    });
    if (!row) { console.log(`  ${b.id}: NOT FOUND, skip`); continue; }
    if (row.hubspotProductId !== b.ext) {
      console.log(`  ${b.id}: hubspotProductId already changed (was ${b.ext}, now ${row.hubspotProductId}), skip`);
      continue;
    }
    console.log(`  ${row.id} "${row.brand} ${row.model}"  null out hubspotProductId=${b.ext}`);
    if (DRY_RUN) {
      console.log(`    DRY RUN`);
      continue;
    }
    await prisma.internalProduct.update({
      where: { id: row.id },
      data: { hubspotProductId: null },
    });
    await logActivity({
      type: "CATALOG_PRODUCT_UPDATED",
      description: `Cleared broken HubSpot link on ${row.brand} ${row.model} (target HubSpot Product no longer exists)`,
      userEmail: "zach@photonbrothers.com",
      userName: "Phase B integrity-fix script",
      entityType: "internal_product",
      entityId: row.id,
      entityName: `${row.brand} ${row.model}`.trim(),
      metadata: { changedFields: ["hubspotProductId"], from: b.ext, to: null, source: "integrity_audit_fix", reason: "HubSpot Product 404" },
      riskLevel: "MEDIUM",
    });
    console.log(`    ✓ cleared`);
  }
}

async function backfillHubSpotVendorFields(): Promise<void> {
  if (!prisma) throw new Error("prisma");
  console.log(`\n──── 3. Backfill vendor_name + vendor_part_number on HubSpot ────`);
  const candidates = await prisma.internalProduct.findMany({
    where: {
      isActive: true,
      hubspotProductId: { not: null },
      OR: [
        { vendorName: { not: null } },
        { vendorPartNumber: { not: null } },
        { unitLabel: { not: null } },
      ],
    },
    select: { id: true, brand: true, model: true, hubspotProductId: true, vendorName: true, vendorPartNumber: true, unitLabel: true },
  });
  console.log(`  ${candidates.length} candidates with internal vendor/unit info AND a HubSpot link.`);
  let patched = 0, skipped = 0, failed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    if (i % 20 === 0) process.stdout.write(`\r  [${i + 1}/${candidates.length}]`);
    if (!HUBSPOT_TOKEN) break;

    // Fetch current HubSpot props to see what's missing
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/products/${r.hubspotProductId}?properties=vendor_name,vendor_part_number,unit_label`,
      { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } },
    );
    if (!res.ok) { failed++; continue; }
    const d = await res.json();
    const cur = d.properties || {};
    const updates: Record<string, string> = {};
    if (!cur.vendor_name && r.vendorName) updates.vendor_name = r.vendorName;
    if (!cur.vendor_part_number && r.vendorPartNumber) updates.vendor_part_number = r.vendorPartNumber;
    if (!cur.unit_label && r.unitLabel) updates.unit_label = r.unitLabel;
    if (Object.keys(updates).length === 0) { skipped++; continue; }

    if (DRY_RUN) { patched++; continue; }
    const pr = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${r.hubspotProductId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: updates }),
    });
    if (pr.ok) {
      patched++;
    } else {
      failed++;
      const errBody = (await pr.text()).slice(0, 100);
      console.log(`\n  ✗ ${r.id} HubSpot ${r.hubspotProductId}: ${pr.status} ${errBody}`);
    }
  }
  console.log(`\n  patched=${patched}  skipped (already filled)=${skipped}  failed=${failed}`);
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }
  const fs = await import("fs");
  const audit = JSON.parse(fs.readFileSync("scripts/catalog-integrity-audit.json", "utf-8")) as AuditFile;

  console.log(`${DRY_RUN ? "DRY RUN — pass --confirm to apply\n" : "APPLYING\n"}`);

  await fixCrossLinks(audit);
  await nullBrokenHubSpotLinks(audit);
  await backfillHubSpotVendorFields();

  await prisma.$disconnect();
  console.log("\n✓ Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
