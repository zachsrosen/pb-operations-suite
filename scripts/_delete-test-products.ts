/**
 * Delete the 3 test products from InternalProduct + their corresponding
 * HubSpot Product / Zuper Product / Zoho Item records.
 *
 * Idempotent — checks each record before deleting.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_delete-test-products.ts [--dry-run] [--confirm]
 *
 * Pass --confirm to actually delete (otherwise dry-run).
 */
import { prisma } from "../src/lib/db";
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const ZUPER_API_KEY = process.env.ZUPER_API_KEY;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

const DRY_RUN = !process.argv.includes("--confirm");

const TEST_IDS = [
  "cmo39tkke000joj8od6j6e42z",  // TestBrand_*, no external links
  "cmo39ufkn000uoj8oh475ail7",  // UIBrand_*, all 3 systems linked
  "cmo39vyq2001aoj8osv4z0pxo",  // UIBrand2_*, all 3 systems linked
];

async function deleteHubSpot(id: string): Promise<{ ok: boolean; status: number; msg: string }> {
  if (!HUBSPOT_TOKEN) return { ok: false, status: 0, msg: "no token" };
  if (DRY_RUN) return { ok: true, status: 0, msg: "DRY RUN (would DELETE)" };
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  return { ok: r.ok, status: r.status, msg: r.ok ? "archived" : await r.text().then((t) => t.slice(0, 100)) };
}

async function deleteZuper(id: string): Promise<{ ok: boolean; status: number; msg: string }> {
  if (!ZUPER_API_KEY) return { ok: false, status: 0, msg: "no key" };
  if (DRY_RUN) return { ok: true, status: 0, msg: "DRY RUN (would DELETE)" };
  const r = await fetch(`${ZUPER_API_URL}/product/${id}`, {
    method: "DELETE",
    headers: { "x-api-key": ZUPER_API_KEY },
  });
  return { ok: r.ok, status: r.status, msg: r.ok ? "deleted" : await r.text().then((t) => t.slice(0, 100)) };
}

async function deleteZoho(id: string): Promise<{ ok: boolean; status: number; msg: string }> {
  if (DRY_RUN) return { ok: true, status: 0, msg: "DRY RUN (would mark inactive)" };
  const result = await zohoInventory.deleteItem(id);
  return {
    ok: result.status === "deleted" || result.status === "not_found",
    status: result.httpStatus ?? 0,
    msg: result.message,
  };
}

async function deleteInternalProduct(id: string, brand: string, model: string, category: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`    DRY RUN: would cascade-delete InternalProduct ${id} + spec rows + stock rows`);
    return;
  }
  if (!prisma) throw new Error("prisma not configured");

  await prisma.$transaction(async (tx) => {
    // Cascade delete: specs → transactions → stock → SKU
    const SPEC_TABLES = [
      "moduleSpec", "inverterSpec", "batterySpec", "evChargerSpec",
      "mountingHardwareSpec", "electricalHardwareSpec", "relayDeviceSpec",
    ];
    for (const t of SPEC_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (tx as any)[t];
      if (model?.deleteMany) {
        await model.deleteMany({ where: { internalProductId: id } });
      }
    }
    await tx.stockTransaction.deleteMany({ where: { stock: { internalProductId: id } } });
    await tx.inventoryStock.deleteMany({ where: { internalProductId: id } });
    await tx.internalProduct.delete({ where: { id } });
  });

  // Audit log
  const { logActivity } = await import("../src/lib/db");
  await logActivity({
    type: "INVENTORY_ADJUSTED",
    description: `Permanently deleted test product: ${brand} ${model} (${category})`,
    userEmail: "zach@photonbrothers.com",
    userName: "Phase B cleanup script",
    entityType: "internal_product",
    entityId: id,
    entityName: `${brand} ${model}`.trim(),
    metadata: {
      action: "delete_sku",
      category,
      brand,
      model,
      reason: "Phase B test product cleanup (2026-04-24)",
    },
    riskLevel: "MEDIUM",
  });
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  console.log(`${DRY_RUN ? "DRY RUN — pass --confirm to actually delete\n" : "DELETING — confirmed\n"}`);

  for (const id of TEST_IDS) {
    const p = await prisma.internalProduct.findUnique({ where: { id } });
    if (!p) {
      console.log(`${id}: NOT FOUND (already deleted?)`);
      continue;
    }
    console.log(`── ${p.brand} ${p.model} (${id}) ──`);

    if (p.hubspotProductId) {
      const r = await deleteHubSpot(p.hubspotProductId);
      console.log(`  HubSpot ${p.hubspotProductId}: ${r.ok ? "✓" : "✗"} ${r.status} ${r.msg}`);
    } else {
      console.log(`  HubSpot: (not linked)`);
    }

    if (p.zuperItemId) {
      const r = await deleteZuper(p.zuperItemId);
      console.log(`  Zuper ${p.zuperItemId}: ${r.ok ? "✓" : "✗"} ${r.status} ${r.msg}`);
    } else {
      console.log(`  Zuper: (not linked)`);
    }

    if (p.zohoItemId) {
      const r = await deleteZoho(p.zohoItemId);
      console.log(`  Zoho ${p.zohoItemId}: ${r.ok ? "✓" : "✗"} ${r.status} ${r.msg}`);
    } else {
      console.log(`  Zoho: (not linked)`);
    }

    await deleteInternalProduct(id, p.brand, p.model, p.category);
    if (!DRY_RUN) console.log(`  InternalProduct: ✓ cascade-deleted`);
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
