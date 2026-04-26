/**
 * Rebrand the 20 high/medium-confidence "Generic" products identified by
 * scripts/_audit-generic-products.ts, plus 1 MONITORING row inferred from
 * its Zoho category, plus delete the "test123" row.
 *
 * Canonicalizes brand names so they match HubSpot enum:
 *   "EATON" → "Eaton"
 *   "SQ D"  → "Square D"
 *   "Homeline" → "Square D" (Homeline is Square D's residential brand line)
 *
 * For each rebrand: updates InternalProduct.brand + pushes to HubSpot
 * (manufacturer property) + Zoho (brand field).
 *
 * Run: node --env-file=.env.local --import tsx scripts/_rebrand-generic-products.ts [--confirm]
 */
import { prisma, logActivity } from "../src/lib/db";
import { zohoInventory } from "../src/lib/zoho-inventory";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const DRY_RUN = !process.argv.includes("--confirm");

// Canonical brand mapping (from audit's proposedBrand to HubSpot enum value)
const CANONICALIZE: Record<string, string> = {
  EATON: "Eaton",
  Eaton: "Eaton",
  "SQ D": "Square D",
  "Square D": "Square D",
  Homeline: "Square D",
  Tesla: "Tesla",
  Milbank: "Milbank",
  Heyco: "Heyco",
  bussman: "bussman",
  GE: "GE",
};

// Manual additions: 1 MONITORING row whose Zoho category was "Tesla"
const MANUAL_ADDS: Array<{ id: string; brand: string }> = [
  { id: "cmn6lsop9001x7a8o8104qaiu", brand: "Tesla" },  // MONITORING 1622277-01 (Zoho category "Tesla")
];

const TO_DELETE_TEST = ["cmn6lsvoe00517a8o985dsm17"]; // PROJECT_MILESTONES "test123"

interface AuditRow {
  id: string;
  category: string;
  model: string;
  proposedBrand: string;
  confidence: string;
}

async function patchHubSpot(id: string, brand: string): Promise<{ ok: boolean; msg: string }> {
  if (!HUBSPOT_TOKEN) return { ok: false, msg: "no token" };
  if (DRY_RUN) return { ok: true, msg: "DRY RUN" };
  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { manufacturer: brand } }),
  });
  if (r.ok) return { ok: true, msg: "patched" };
  return { ok: false, msg: `${r.status} ${(await r.text()).slice(0, 120)}` };
}

async function patchZoho(id: string, brand: string): Promise<{ ok: boolean; msg: string }> {
  if (DRY_RUN) return { ok: true, msg: "DRY RUN" };
  try {
    const r = await zohoInventory.updateItem(id, { brand });
    return { ok: r.status === "updated", msg: r.message };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : String(e) };
  }
}

async function rebrandRow(rowId: string, newBrand: string): Promise<void> {
  if (!prisma) throw new Error("prisma not configured");
  const row = await prisma.internalProduct.findUnique({
    where: { id: rowId },
    select: { id: true, brand: true, model: true, category: true, hubspotProductId: true, zohoItemId: true },
  });
  if (!row) {
    console.log(`  ${rowId}: NOT FOUND, skip`);
    return;
  }
  if (row.brand === newBrand) {
    console.log(`  ${rowId}: already "${newBrand}" — skip`);
    return;
  }
  console.log(`  ${row.id}  ${row.category} "${row.model}" : "${row.brand}" → "${newBrand}"`);

  if (row.hubspotProductId) {
    const r = await patchHubSpot(row.hubspotProductId, newBrand);
    console.log(`    HubSpot ${row.hubspotProductId}: ${r.ok ? "✓" : "✗"} ${r.msg}`);
  }
  if (row.zohoItemId) {
    const r = await patchZoho(row.zohoItemId, newBrand);
    console.log(`    Zoho ${row.zohoItemId}:    ${r.ok ? "✓" : "✗"} ${r.msg}`);
  }
  if (DRY_RUN) {
    console.log(`    InternalProduct: DRY RUN`);
    return;
  }
  await prisma.internalProduct.update({
    where: { id: row.id },
    data: { brand: newBrand },
  });
  await logActivity({
    type: "CATALOG_PRODUCT_UPDATED",
    description: `Rebranded "${row.brand}" → "${newBrand}" on ${row.model} (${row.category})`,
    userEmail: "zach@photonbrothers.com",
    userName: "Phase B Generic-rebrand script",
    entityType: "internal_product",
    entityId: row.id,
    entityName: `${newBrand} ${row.model}`.trim(),
    metadata: { changedFields: ["brand"], from: row.brand, to: newBrand, source: "phase_b_cleanup" },
    riskLevel: "LOW",
  });
  console.log(`    InternalProduct: ✓`);
}

async function deleteRow(rowId: string): Promise<void> {
  if (!prisma) throw new Error("prisma not configured");
  const row = await prisma.internalProduct.findUnique({
    where: { id: rowId },
    select: { id: true, brand: true, model: true, category: true, hubspotProductId: true, zohoItemId: true, zuperItemId: true },
  });
  if (!row) {
    console.log(`  ${rowId}: NOT FOUND, skip delete`);
    return;
  }
  console.log(`  DELETE ${row.id}  "${row.brand}" "${row.model}" (${row.category})`);
  if (DRY_RUN) {
    console.log(`    DRY RUN`);
    return;
  }
  // External deletes (best-effort)
  if (row.hubspotProductId) {
    const r = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${row.hubspotProductId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN!}` },
    });
    console.log(`    HubSpot ${row.hubspotProductId}: ${r.ok ? "✓ archived" : `✗ ${r.status}`}`);
  }
  if (row.zuperItemId) {
    const r = await fetch(`${process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api"}/product/${row.zuperItemId}`, {
      method: "DELETE",
      headers: { "x-api-key": process.env.ZUPER_API_KEY! },
    });
    console.log(`    Zuper ${row.zuperItemId}: ${r.ok ? "✓ deleted" : `✗ ${r.status}`}`);
  }
  if (row.zohoItemId) {
    const r = await zohoInventory.deleteItem(row.zohoItemId);
    console.log(`    Zoho ${row.zohoItemId}: ${r.status === "deleted" ? "✓" : "✗"} ${r.message}`);
  }

  // InternalProduct cascade delete
  await prisma.$transaction(async (tx) => {
    const SPEC_TABLES = ["moduleSpec", "inverterSpec", "batterySpec", "evChargerSpec", "mountingHardwareSpec", "electricalHardwareSpec", "relayDeviceSpec"];
    for (const t of SPEC_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (tx as any)[t];
      if (m?.deleteMany) await m.deleteMany({ where: { internalProductId: rowId } });
    }
    await tx.stockTransaction.deleteMany({ where: { stock: { internalProductId: rowId } } });
    await tx.inventoryStock.deleteMany({ where: { internalProductId: rowId } });
    await tx.internalProduct.delete({ where: { id: rowId } });
  });
  await logActivity({
    type: "INVENTORY_ADJUSTED",
    description: `Permanently deleted Generic test product: ${row.brand} ${row.model} (${row.category})`,
    userEmail: "zach@photonbrothers.com",
    userName: "Phase B Generic-cleanup script",
    entityType: "internal_product",
    entityId: rowId,
    entityName: `${row.brand} ${row.model}`.trim(),
    metadata: { action: "delete_sku", category: row.category, brand: row.brand, model: row.model, reason: "Phase B test product cleanup (test123)" },
    riskLevel: "MEDIUM",
  });
  console.log(`    InternalProduct: ✓ cascade-deleted`);
}

async function main() {
  if (!prisma) { console.error("prisma not configured"); process.exit(1); }

  const fs = await import("fs");
  const audit = JSON.parse(fs.readFileSync("scripts/generic-audit.json", "utf-8")) as { rows: AuditRow[] };

  // Filter to high/medium confidence with non-Generic proposed brand
  const auditRebrands = audit.rows
    .filter((r) => r.confidence !== "low" && r.proposedBrand !== "Generic")
    .map((r) => ({ id: r.id, brand: CANONICALIZE[r.proposedBrand] || r.proposedBrand }));

  const allRebrands = [...auditRebrands, ...MANUAL_ADDS];

  console.log(`${DRY_RUN ? "DRY RUN — pass --confirm to apply\n" : "APPLYING\n"}`);
  console.log(`Will rebrand ${allRebrands.length} rows:`);
  const byBrand = new Map<string, number>();
  for (const r of allRebrands) byBrand.set(r.brand, (byBrand.get(r.brand) || 0) + 1);
  for (const [b, n] of [...byBrand.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${b.padEnd(20)} ${n} rows`);
  }
  console.log(`Will DELETE ${TO_DELETE_TEST.length} test row(s).\n`);

  console.log("── Rebrands ──");
  for (const r of allRebrands) {
    await rebrandRow(r.id, r.brand);
  }

  console.log("\n── Deletes ──");
  for (const id of TO_DELETE_TEST) {
    await deleteRow(id);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
