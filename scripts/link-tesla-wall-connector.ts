/**
 * Link Tesla Wall Connector 1734412 variants to Zoho Inventory
 *
 * Fixes: BOM Pipeline "Unmatched Items" for Tesla 1734412-02-X / 1734412-03-X
 *
 * The InternalProduct for 1734412-02-X exists but has no zohoItemId.
 * The Zoho item "Universal Wall Connector, Wi-Fi Enabled, Indoor/Outdoor, 24' Cable Length"
 * (SKU: 1734412-02-X / 2521526, item_id: 5385454000000808481) is the correct match.
 *
 * For 1734412-03-X (a style variant of the same Wall Connector), we create a new
 * InternalProduct pointing to the same Zoho item — the -03 vs -02 suffix is a
 * Tesla style/revision code, not a different product.
 *
 * Usage: npx tsx scripts/link-tesla-wall-connector.ts [--dry-run]
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes("--dry-run");

// Known Zoho item for Tesla Wall Connector (Gen 3)
const ZOHO_WALL_CONNECTOR = {
  itemId: "5385454000000808481",
  name: "Universal Wall Connector, Wi-Fi Enabled, Indoor/Outdoor, 24' Cable Length",
  sku: "1734412-02-X / 2521526",
};

// IP ID from backfill candidates
const EXISTING_IP_ID = "e7574b15-7738-4d2b-a5cf-c9047cbe78e4";

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log();

  // Step 1: Link existing IP for 1734412-02-X
  // Search by model since IDs may have changed since the audit snapshot
  const existing = await prisma.internalProduct.findFirst({
    where: {
      brand: "Tesla",
      model: { contains: "1734412-02", mode: "insensitive" },
      isActive: true,
    },
    select: { id: true, brand: true, model: true, zohoItemId: true, category: true },
  });

  if (!existing) {
    console.log("No IP found for 1734412-02-X — creating...");
    if (!DRY_RUN) {
      const created = await prisma.internalProduct.create({
        data: {
          brand: "Tesla",
          model: "1734412-02-X",
          name: "Tesla Wall Connector (1734412-02-X)",
          category: "EV_CHARGER",
          zohoItemId: ZOHO_WALL_CONNECTOR.itemId,
          isActive: true,
        },
      });
      console.log("  ✓ Created IP: " + created.id);
    } else {
      console.log("  (dry run — would create with zohoItemId: " + ZOHO_WALL_CONNECTOR.itemId + ")");
    }
  } else {
    console.log("Found IP: " + existing.brand + " " + existing.model + " (id: " + existing.id + ", category: " + existing.category + ")");

    if (existing.zohoItemId) {
      console.log("  Already linked to Zoho: " + existing.zohoItemId + " — skipping");
    } else {
      console.log("  Linking to Zoho item: " + ZOHO_WALL_CONNECTOR.itemId);
      console.log("    Name: " + ZOHO_WALL_CONNECTOR.name);
      console.log("    SKU:  " + ZOHO_WALL_CONNECTOR.sku);

      if (!DRY_RUN) {
        await prisma.internalProduct.update({
          where: { id: existing.id },
          data: {
            zohoItemId: ZOHO_WALL_CONNECTOR.itemId,
          },
        });
        console.log("  ✓ Linked");
      } else {
        console.log("  (dry run — would update)");
      }
    }
  }

  // Step 2: Check if 1734412-03-X IP exists; create if not
  console.log();
  const variant03 = await prisma.internalProduct.findFirst({
    where: {
      brand: "Tesla",
      model: { contains: "1734412-03", mode: "insensitive" },
      isActive: true,
    },
    select: { id: true, model: true, zohoItemId: true },
  });

  if (variant03) {
    console.log("Found IP for 1734412-03-X: " + variant03.id);
    if (variant03.zohoItemId) {
      console.log("  Already linked to Zoho: " + variant03.zohoItemId);
    } else {
      console.log("  Linking to same Zoho item: " + ZOHO_WALL_CONNECTOR.itemId);
      if (!DRY_RUN) {
        await prisma.internalProduct.update({
          where: { id: variant03.id },
          data: {
            zohoItemId: ZOHO_WALL_CONNECTOR.itemId,
            zohoName: ZOHO_WALL_CONNECTOR.name,
            zohoSku: ZOHO_WALL_CONNECTOR.sku,
          },
        });
        console.log("  ✓ Linked");
      } else {
        console.log("  (dry run — would update)");
      }
    }
  } else {
    console.log("No IP found for 1734412-03-X — creating...");
    console.log("  Brand:    Tesla");
    console.log("  Model:    1734412-03-X");
    console.log("  Category: EV_CHARGER");
    console.log("  Zoho:     " + ZOHO_WALL_CONNECTOR.itemId);

    if (!DRY_RUN) {
      const created = await prisma.internalProduct.create({
        data: {
          brand: "Tesla",
          model: "1734412-03-X",
          name: "Tesla Wall Connector (1734412-03-X)",
          category: "EV_CHARGER",
          zohoItemId: ZOHO_WALL_CONNECTOR.itemId,
          isActive: true,
        },
      });
      console.log("  ✓ Created IP: " + created.id);
    } else {
      console.log("  (dry run — would create)");
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
