/**
 * Backfill missing `description` and `part_number` on Zoho Inventory items
 * linked to APPROVED PendingCatalogPush rows.
 *
 * Context: prior to PR adding description+part_number to the UPDATE payload
 * of createOrUpdateItem(), items that were matched to an existing Zoho item
 * (by SKU) had their PB-submitted description and part_number silently
 * dropped. This script walks every APPROVED push and, for any field where
 * PB has a value but Zoho's is empty, sends an update.
 *
 *   npx tsx scripts/backfill-zoho-item-fields.ts          # dry run
 *   npx tsx scripts/backfill-zoho-item-fields.ts --apply  # push updates
 *
 * Idempotent: re-running skips items that already match.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");
const DELAY_MS = 250;

const norm = (s: string | null | undefined) => (s ?? "").trim();

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");
  const orgId = process.env.ZOHO_INVENTORY_ORG_ID!;
  const base = "https://www.zohoapis.com/inventory/v1";
  const getAccessToken = (zohoInventory as unknown as { getAccessToken: () => Promise<string> }).getAccessToken.bind(zohoInventory);
  const token = await getAccessToken();

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { status: "APPROVED", zohoItemId: { not: null } },
    select: {
      id: true, brand: true, model: true, description: true,
      vendorPartNumber: true, zohoItemId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Scanning ${pushes.length} approved push(es) for description/part_number gaps in Zoho...\n`);

  let checked = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of pushes) {
    checked += 1;
    const res = await fetch(`${base}/items/${p.zohoItemId}?organization_id=${orgId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 404) {
      console.log(`  SKIP  ${p.brand} ${p.model}  zoho item missing (404)`);
      skipped += 1;
      continue;
    }
    const body = await res.json().catch(() => ({})) as { item?: { description?: string; part_number?: string } };
    const it = body.item ?? {};

    const pbDesc = norm(p.description);
    const pbPart = norm(p.vendorPartNumber || p.model);
    const zhDesc = norm(it.description);
    const zhPart = norm(it.part_number);

    const update: Record<string, unknown> = {};
    if (pbDesc && !zhDesc) update.description = pbDesc;
    if (pbPart && !zhPart) update.part_number = pbPart;

    if (Object.keys(update).length === 0) {
      skipped += 1;
      continue;
    }

    const label = `${p.brand} ${p.model}`.padEnd(40);
    const fields = Object.keys(update).join(",");
    if (!APPLY) {
      console.log(`  DRY   ${label}  zoho=${p.zohoItemId}  fields=${fields}`);
      updated += 1;
      continue;
    }

    try {
      const result = await zohoInventory.updateItem(p.zohoItemId!, update);
      if (result.status === "updated") {
        console.log(`  OK    ${label}  zoho=${p.zohoItemId}  ${fields}`);
        updated += 1;
      } else {
        console.log(`  FAIL  ${label}  ${result.status}: ${result.message}`);
        failed += 1;
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL  ${label}  ${msg}`);
      failed += 1;
    }
  }

  console.log(`\nDone. checked=${checked}  updated=${updated}  skipped=${skipped}  failed=${failed}  mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  if (!APPLY) console.log("(Re-run with --apply to push updates.)");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
