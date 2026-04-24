/**
 * One-off cleanup for the 4 test catalog items submitted by Zach in Feb–Mar
 * 2026 while exercising the submit-product form. These items pollute the
 * catalog audit and have no real downstream usage.
 *
 * For each item this removes:
 *   - The Zoho Inventory item
 *   - The HubSpot Product (if any)
 *   - The Zuper Part (if any)
 *   - The InternalProduct (EquipmentSku) row (if still present and active)
 *   - The PendingCatalogPush row
 *
 * Each step is best-effort — if the external item already doesn't exist, we
 * log and move on. Run with --apply to actually delete; default is dry-run.
 *
 *   npx tsx scripts/cleanup-test-catalog-items.ts          # dry run
 *   npx tsx scripts/cleanup-test-catalog-items.ts --apply  # delete
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

const TEST_PUSH_IDS = [
  "cmm59mlfd000n04jtsb52ojsy", // Hyundai TEST
  "cmmo5y4x4001004l86w253oym", // Hyundai Test Module
  "cmmo6p6wy000d04jxcvj8q4tc", // Tesla Test Battery
  "cmmo73xkc000d04l5b1h50gj4", // Iron Ridge Test Ironridge Part
];

async function deleteHubSpotProduct(id: string): Promise<{ status: "deleted" | "not_found" | "failed"; message?: string }> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return { status: "failed", message: "HUBSPOT_ACCESS_TOKEN not set" };
  const res = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { status: "deleted" };
  if (res.status === 404) return { status: "not_found" };
  const body = await res.text().catch(() => "");
  return { status: "failed", message: `HTTP ${res.status}: ${body.slice(0, 160)}` };
}

async function deleteZuperPart(id: string): Promise<{ status: "deleted" | "not_found" | "failed"; message?: string }> {
  const apiKey = process.env.ZUPER_API_KEY;
  const base = process.env.ZUPER_API_BASE || "https://us.zuperpro.com/api";
  if (!apiKey) return { status: "failed", message: "ZUPER_API_KEY not set" };
  // Try the /parts endpoint first, then /products as a fallback (Zuper aliases both).
  for (const endpoint of ["parts", "products"]) {
    const res = await fetch(`${base}/${endpoint}/${id}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    });
    if (res.status === 200 || res.status === 204) return { status: "deleted" };
    if (res.status === 404) continue; // try next endpoint
    const body = await res.text().catch(() => "");
    return { status: "failed", message: `HTTP ${res.status}: ${body.slice(0, 160)}` };
  }
  return { status: "not_found" };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const { zohoInventory } = await import("../src/lib/zoho-inventory.js");

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { id: { in: TEST_PUSH_IDS } },
    select: {
      id: true, brand: true, model: true, zohoItemId: true,
      hubspotProductId: true, zuperItemId: true, internalSkuId: true,
      requestedBy: true, createdAt: true,
    },
  });

  if (pushes.length !== TEST_PUSH_IDS.length) {
    console.warn(`Warning: expected ${TEST_PUSH_IDS.length} pushes, found ${pushes.length}`);
  }

  for (const p of pushes) {
    console.log(`→ ${p.brand} ${p.model}  (pushId=${p.id})`);

    // 1. Zoho
    if (p.zohoItemId) {
      if (!APPLY) {
        console.log(`    DRY   delete Zoho item ${p.zohoItemId}`);
      } else {
        const r = await zohoInventory.deleteItem(p.zohoItemId);
        console.log(`    zoho  ${r.status}: ${r.message || ""}`);
      }
    }

    // 2. HubSpot
    if (p.hubspotProductId) {
      if (!APPLY) {
        console.log(`    DRY   delete HubSpot product ${p.hubspotProductId}`);
      } else {
        const r = await deleteHubSpotProduct(p.hubspotProductId);
        console.log(`    hs    ${r.status}: ${r.message || ""}`);
      }
    }

    // 3. Zuper
    if (p.zuperItemId) {
      if (!APPLY) {
        console.log(`    DRY   delete Zuper part ${p.zuperItemId}`);
      } else {
        const r = await deleteZuperPart(p.zuperItemId);
        console.log(`    zuper ${r.status}: ${r.message || ""}`);
      }
    }

    // 4. InternalProduct (EquipmentSku)
    if (p.internalSkuId) {
      if (!APPLY) {
        console.log(`    DRY   delete InternalProduct ${p.internalSkuId}`);
      } else {
        try {
          await prisma.internalProduct.delete({ where: { id: p.internalSkuId } });
          console.log(`    int   deleted`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Fall back to soft delete if a FK prevents hard delete
          if (/foreign key|P2003/i.test(msg)) {
            await prisma.internalProduct.update({
              where: { id: p.internalSkuId },
              data: { isActive: false },
            }).catch(() => null);
            console.log(`    int   soft-deactivated (FK ref)`);
          } else if (/P2025|Record to delete/i.test(msg)) {
            console.log(`    int   not_found`);
          } else {
            console.log(`    int   failed: ${msg.slice(0, 160)}`);
          }
        }
      }
    }

    // 5. PendingCatalogPush
    if (!APPLY) {
      console.log(`    DRY   delete PendingCatalogPush ${p.id}`);
    } else {
      await prisma.pendingCatalogPush.delete({ where: { id: p.id } });
      console.log(`    push  deleted`);
    }
    console.log("");
  }

  console.log(`Done. mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  if (!APPLY) console.log("(Re-run with --apply to actually delete.)");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
