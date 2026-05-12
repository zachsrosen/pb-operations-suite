#!/usr/bin/env npx tsx
/**
 * Backfill cross-link IDs for all InternalProducts.
 *
 * Calls writeCrossLinkIds for every InternalProduct that has ≥2 external IDs,
 * writing peer IDs into each linked system's custom fields. Safe to re-run —
 * writeCrossLinkIds is idempotent (overwrites with the same values).
 *
 * Usage:
 *   npx tsx scripts/backfill-cross-links.ts              # dry-run (default)
 *   npx tsx scripts/backfill-cross-links.ts --execute     # actually write
 *   npx tsx scripts/backfill-cross-links.ts --zuper-only  # only fix Zuper gaps
 *   npx tsx scripts/backfill-cross-links.ts --execute --zuper-only
 */

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { writeCrossLinkIds } from "../src/lib/catalog-cross-link.js";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const zuperOnly = args.includes("--zuper-only");

async function main() {
  console.log(
    execute
      ? "🚀 EXECUTE mode — writing cross-link IDs to external systems"
      : "🔍 DRY-RUN mode — pass --execute to actually write",
  );
  if (zuperOnly) console.log("📌 Zuper-only mode — skipping Zoho and HubSpot");

  // Fetch all InternalProducts with at least 2 external links
  const products = await prisma.internalProduct.findMany({
    where: {
      OR: [
        // Has Zuper + at least one other
        {
          zuperItemId: { not: null },
          OR: [
            { zohoItemId: { not: null } },
            { hubspotProductId: { not: null } },
          ],
        },
        // Has Zoho + HubSpot (no Zuper needed if not zuper-only)
        ...(!zuperOnly
          ? [
              {
                zohoItemId: { not: null } as const,
                hubspotProductId: { not: null } as const,
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      zohoItemId: true,
      hubspotProductId: true,
      zuperItemId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nFound ${products.length} products with ≥2 external links\n`);

  let success = 0;
  let warnings = 0;
  let errors = 0;
  const allWarnings: string[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const label = p.name || p.id;

    if (i > 0 && i % 25 === 0) {
      console.log(
        `  Progress: ${i}/${products.length} (${success} ok, ${warnings} warned, ${errors} failed)`,
      );
    }

    if (!execute) {
      // Dry-run: just count what would be attempted
      const systems: string[] = [];
      if (p.zohoItemId && !zuperOnly) systems.push("zoho");
      if (p.zuperItemId) systems.push("zuper");
      if (p.hubspotProductId && !zuperOnly) systems.push("hubspot");
      console.log(`  [DRY] ${label} → would write to: ${systems.join(", ")}`);
      success++;
      continue;
    }

    try {
      const input = zuperOnly
        ? {
            // Only pass zuper + its peer IDs so only Zuper gets written
            internalProductId: p.id,
            zuperItemId: p.zuperItemId,
            hubspotProductId: p.hubspotProductId,
            zohoItemId: p.zohoItemId,
          }
        : {
            internalProductId: p.id,
            hubspotProductId: p.hubspotProductId,
            zohoItemId: p.zohoItemId,
            zuperItemId: p.zuperItemId,
          };

      const result = await writeCrossLinkIds(input);

      if (result.warnings.length > 0) {
        warnings++;
        for (const w of result.warnings) {
          allWarnings.push(`${label}: ${w}`);
          console.log(`  ⚠️  ${label}: ${w}`);
        }
      } else {
        success++;
      }

      // Pace requests: ~3 products/sec avoids Zoho/Zuper rate limits
      // Each product may hit up to 3 APIs, so ~9 req/sec worst case
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      errors++;
      console.log(
        `  ❌ ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ⚠️  Warnings: ${warnings}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log(`  Total: ${products.length}`);

  if (allWarnings.length > 0) {
    console.log(`\n=== ALL WARNINGS ===`);
    for (const w of allWarnings) console.log(`  ${w}`);
  }

  if (!execute) {
    console.log(`\n💡 Run with --execute to actually write cross-link IDs`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
