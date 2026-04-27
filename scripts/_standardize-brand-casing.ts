/**
 * Standardize brand casing on InternalProduct rows + push the canonical brand
 * to linked HubSpot/Zoho records.
 *
 * Targets:
 *   "UNIRAC" → "Unirac"   (matches IronRidge/SolarEdge convention in HubSpot enum)
 *   "MULTIPLE" → "Multiple"
 *
 * Idempotent — only updates rows that don't already match the canonical form.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_standardize-brand-casing.ts [--confirm]
 */
import { prisma, logActivity } from "../src/lib/db";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const DRY_RUN = !process.argv.includes("--confirm");

const RENAMES: Array<{ from: string; to: string }> = [
  { from: "UNIRAC", to: "Unirac" },
  { from: "MULTIPLE", to: "Multiple" },
];

async function patchHubSpotProduct(id: string, manufacturer: string): Promise<{ ok: boolean; status: number; msg: string }> {
  if (!HUBSPOT_TOKEN) return { ok: false, status: 0, msg: "no token" };
  if (DRY_RUN) return { ok: true, status: 0, msg: "DRY RUN" };
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { manufacturer } }),
  });
  if (r.ok) return { ok: true, status: r.status, msg: "patched" };
  return { ok: false, status: r.status, msg: (await r.text()).slice(0, 150) };
}

async function patchZohoBrand(id: string, brand: string): Promise<{ ok: boolean; msg: string }> {
  if (DRY_RUN) return { ok: true, msg: "DRY RUN" };
  const { zohoInventory } = await import("../src/lib/zoho-inventory");
  try {
    const r = await zohoInventory.updateItem(id, { brand });
    return { ok: r.status === "updated", msg: r.message };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }
  console.log(`${DRY_RUN ? "DRY RUN — pass --confirm to apply\n" : "APPLYING\n"}`);

  for (const { from, to } of RENAMES) {
    const rows = await prisma.internalProduct.findMany({
      where: { brand: from, isActive: true },
      select: { id: true, brand: true, model: true, category: true, hubspotProductId: true, zohoItemId: true },
    });
    console.log(`── "${from}" → "${to}" (${rows.length} rows) ──`);
    if (rows.length === 0) {
      console.log(`  Nothing to do.\n`);
      continue;
    }
    for (const row of rows) {
      console.log(`  ${row.id}  "${row.model}" (${row.category})`);
      // Update HubSpot
      if (row.hubspotProductId) {
        const r = await patchHubSpotProduct(row.hubspotProductId, to);
        console.log(`    HubSpot ${row.hubspotProductId}: ${r.ok ? "✓" : "✗"} ${r.msg}`);
      }
      // Update Zoho brand
      if (row.zohoItemId) {
        const r = await patchZohoBrand(row.zohoItemId, to);
        console.log(`    Zoho ${row.zohoItemId}:    ${r.ok ? "✓" : "✗"} ${r.msg}`);
      }
      // Update InternalProduct
      if (DRY_RUN) {
        console.log(`    InternalProduct: DRY RUN (would set brand="${to}")`);
      } else {
        await prisma.internalProduct.update({
          where: { id: row.id },
          data: { brand: to },
        });
        await logActivity({
          type: "CATALOG_PRODUCT_UPDATED",
          description: `Standardized brand "${from}" → "${to}" on ${row.model}`,
          userEmail: "zach@photonbrothers.com",
          userName: "Phase B brand-cleanup script",
          entityType: "internal_product",
          entityId: row.id,
          entityName: `${to} ${row.model}`.trim(),
          metadata: { changedFields: ["brand"], from, to, source: "phase_b_cleanup" },
          riskLevel: "LOW",
        });
        console.log(`    InternalProduct: ✓ brand updated`);
      }
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
