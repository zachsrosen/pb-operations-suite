/**
 * Seed OooBotConfig with a placeholder playbook.
 * Run: npx tsx scripts/seed-ooo-bot-config.ts
 *
 * Uses upsert — safe to re-run. Updates the playbook content
 * without losing the enabled/date config.
 */

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const PLACEHOLDER_PLAYBOOK = `## Current Priority Projects
- (To be filled in with Zach before OOO)

## Standing Rules (things Zach would decide on the spot)
- If a project is stuck in permitting for >10 business days, check the AHJ tracker
- If an install gets rained out, check the next available slot on the scheduler before calling the customer
- If someone asks about a BOM approval, tell them to hold until Zach is back unless it's blocking an install this week

## Who Handles What While I'm Out
- Scheduling conflicts: (TBD)
- BOM questions: (TBD)
- Design reviews: (TBD)
- IT issues: Caleb or Patrick

## Things to Hold for My Return
- Any new vendor approvals
- Changes to crew assignments
- Budget approvals over $5k

## Key Contacts
- Caleb: IT, system issues
- Patrick: IT, system issues
- Nathan Kirkegaard: Covering Westminster survey slots
`;

async function main() {
  const result = await prisma.oooBotConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      playbook: PLACEHOLDER_PLAYBOOK,
      enabled: true,
      oooStartDate: new Date("2026-05-29T00:00:00-06:00"),
      oooEndDate: new Date("2026-06-10T23:59:59-06:00"),
    },
    update: {
      playbook: PLACEHOLDER_PLAYBOOK,
    },
  });

  console.log(`OooBotConfig seeded: id=${result.id}, enabled=${result.enabled}`);
  console.log(`OOO period: ${result.oooStartDate.toISOString()} → ${result.oooEndDate.toISOString()}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
