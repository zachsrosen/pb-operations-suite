import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { matchVendorName } from "../src/lib/vendor-normalize";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const applyMode = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${applyMode ? "APPLY" : "DRY-RUN"}`);

  // Load all active vendor lookups
  const lookups = await prisma.vendorLookup.findMany({
    where: { isActive: true },
    select: { zohoVendorId: true, name: true },
  });
  console.log(`Loaded ${lookups.length} active vendors from VendorLookup`);

  // Find products with vendorName but no zohoVendorId
  const skus = await prisma.internalProduct.findMany({
    where: {
      vendorName: { not: null },
      zohoVendorId: null,
    },
    select: { id: true, vendorName: true, brand: true, model: true },
  });
  console.log(`Found ${skus.length} SKUs with vendorName but no zohoVendorId\n`);

  let matched = 0;
  let unmatched = 0;

  for (const sku of skus) {
    const result = matchVendorName(sku.vendorName!, lookups);
    if (result) {
      matched++;
      console.log(
        `  MATCH: "${sku.vendorName}" → "${result.name}" (${result.zohoVendorId}) — ${sku.brand} ${sku.model}`
      );
      if (applyMode) {
        await prisma.internalProduct.update({
          where: { id: sku.id },
          data: { zohoVendorId: result.zohoVendorId },
        });
      }
    } else {
      unmatched++;
      console.log(
        `  NO MATCH: "${sku.vendorName}" — ${sku.brand} ${sku.model}`
      );
    }
  }

  console.log(`\nInternalProduct: ${matched} matched, ${unmatched} unmatched`);

  // Also backfill PendingCatalogPush records
  const pushes = await prisma.pendingCatalogPush.findMany({
    where: {
      vendorName: { not: null },
      zohoVendorId: null,
    },
    select: { id: true, vendorName: true, brand: true, model: true },
  });
  console.log(`\nFound ${pushes.length} PendingCatalogPush records with vendorName but no zohoVendorId`);

  let pushMatched = 0;
  let pushUnmatched = 0;

  for (const push of pushes) {
    const result = matchVendorName(push.vendorName!, lookups);
    if (result) {
      pushMatched++;
      console.log(
        `  MATCH: "${push.vendorName}" → "${result.name}" (${result.zohoVendorId}) — ${push.brand} ${push.model}`
      );
      if (applyMode) {
        await prisma.pendingCatalogPush.update({
          where: { id: push.id },
          data: { zohoVendorId: result.zohoVendorId },
        });
      }
    } else {
      pushUnmatched++;
      console.log(
        `  NO MATCH: "${push.vendorName}" — ${push.brand} ${push.model}`
      );
    }
  }

  console.log(`PendingCatalogPush: ${pushMatched} matched, ${pushUnmatched} unmatched`);
  const totalMatched = matched + pushMatched;
  if (!applyMode && totalMatched > 0) {
    console.log(`\nRun with --apply to write the ${totalMatched} matches.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
