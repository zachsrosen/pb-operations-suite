import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import * as fs from "fs";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface BackfillRecord {
  ip_id: string;
  ip_brand: string;
  ip_model: string;
  zoho_item_id: string;
  zoho_item_name: string;
  zoho_item_sku: string;
  times_used: number;
}

async function main() {
  const approved: BackfillRecord[] = JSON.parse(
    fs.readFileSync("scripts/2026-zoho-backfill-approved.json", "utf-8")
  );

  console.log("Backfilling zohoItemId for " + approved.length + " InternalProducts...\n");

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of approved) {
    try {
      // Verify the product exists and doesn't already have a zohoItemId
      const existing = await prisma.internalProduct.findUnique({
        where: { id: record.ip_id },
        select: { id: true, brand: true, model: true, zohoItemId: true },
      });

      if (!existing) {
        console.log("  SKIP: " + record.ip_brand + " " + record.ip_model + " — not found (id: " + record.ip_id + ")");
        skipped++;
        continue;
      }

      if (existing.zohoItemId) {
        console.log("  SKIP: " + record.ip_brand + " " + record.ip_model + " — already has zohoItemId: " + existing.zohoItemId);
        skipped++;
        continue;
      }

      // Update
      await prisma.internalProduct.update({
        where: { id: record.ip_id },
        data: { zohoItemId: record.zoho_item_id },
      });

      console.log("  OK:   " + record.ip_brand.padEnd(14) + " " + record.ip_model.padEnd(24) + " → " + record.zoho_item_id);
      updated++;
    } catch (err) {
      console.log("  ERR:  " + record.ip_brand + " " + record.ip_model + " — " + String(err));
      errors++;
    }
  }

  console.log("\nDone.");
  console.log("  Updated: " + updated);
  console.log("  Skipped: " + skipped);
  console.log("  Errors:  " + errors);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
