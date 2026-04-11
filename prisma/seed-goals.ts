// prisma/seed-goals.ts

/**
 * Seeds OfficeGoal records for April 2026 with David's per-location targets.
 *
 * Usage: npx tsx prisma/seed-goals.ts
 *
 * Safe to re-run — uses upsert on the unique constraint.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

const TARGETS: Array<{
  location: string;
  revenueTarget: number;
  reviewTarget: number;
}> = [
  { location: "Westminster",       revenueTarget: 1_100_000, reviewTarget: 15 },
  { location: "Centennial",        revenueTarget: 1_100_000, reviewTarget: 15 },
  { location: "Colorado Springs",  revenueTarget: 300_000,   reviewTarget: 10 },
  { location: "San Luis Obispo",   revenueTarget: 500_000,   reviewTarget: 10 },
  { location: "Camarillo",         revenueTarget: 500_000,   reviewTarget: 10 },
];

const METRICS = [
  { metric: "sales_revenue",      useRevenue: true },
  { metric: "da_revenue",         useRevenue: true },
  { metric: "cc_revenue",         useRevenue: true },
  { metric: "inspection_revenue", useRevenue: true },
  { metric: "five_star_reviews",  useRevenue: false },
];

const MONTH = 4;
const YEAR = 2026;

async function main() {
  let created = 0;

  for (const loc of TARGETS) {
    for (const m of METRICS) {
      const target = m.useRevenue ? loc.revenueTarget : loc.reviewTarget;

      await prisma.officeGoal.upsert({
        where: {
          location_metric_month_year: {
            location: loc.location,
            metric: m.metric,
            month: MONTH,
            year: YEAR,
          },
        },
        update: { target },
        create: {
          location: loc.location,
          metric: m.metric,
          target,
          month: MONTH,
          year: YEAR,
        },
      });
      created++;
    }
  }

  console.log(`✅ Seeded ${created} OfficeGoal records for ${MONTH}/${YEAR}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
