/**
 * One-off: cancel two EagleView orders that EagleView terminated as
 * "Closed - …" but that were stuck in ORDERED because the poller never
 * recognized "Closed" as terminal (fixed in this branch).
 *
 *   71362507 — Closed - Wrong House
 *   71587725 — Closed - Poor Images
 *
 * Dry-run:   tsx scripts/_cancel-stuck-eagleview-orders.ts
 * Apply:     tsx scripts/_cancel-stuck-eagleview-orders.ts --apply
 *
 * Safe to delete after running. The deployed poll cron would eventually mark
 * these CANCELLED on its own once this branch ships; this just does it now.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const STUCK = [
  { reportId: "71362507", evStatus: "Closed - Wrong House" },
  { reportId: "71587725", evStatus: "Closed - Poor Images" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode — writing changes\n" : "DRY-RUN — pass --apply to write\n");

  for (const { reportId, evStatus } of STUCK) {
    const row = await prisma.eagleViewOrder.findUnique({
      where: { reportId },
      select: { id: true, dealId: true, status: true, errorMessage: true },
    });

    if (!row) {
      console.log(`  SKIP ${reportId} — no order row found`);
      continue;
    }
    if (row.status !== "ORDERED") {
      console.log(`  SKIP ${reportId} — already ${row.status} (no change)`);
      continue;
    }

    console.log(
      `  ${apply ? "FAIL" : "WOULD FAIL"} ${reportId} (deal ${row.dealId}, ${row.status} → FAILED, "${evStatus}")`,
    );

    if (apply) {
      await prisma.eagleViewOrder.update({
        where: { id: row.id },
        data: { status: "FAILED", errorMessage: `EV status: ${evStatus}` },
      });
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
