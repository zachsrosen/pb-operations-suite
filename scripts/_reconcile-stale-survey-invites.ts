/**
 * One-time reconcile: close PENDING survey portal invites whose survey is
 * already scheduled in our DB (booked through the internal scheduler, which
 * — before the fix in this branch — never closed the customer's invite).
 *
 * For each PENDING SurveyInvite whose deal has a scheduled survey
 * ScheduleRecord, flip the invite to SCHEDULED and backfill scheduledDate /
 * scheduledTime / zuperJobUid / scheduleRecordId from that record. Invites
 * with no matching scheduled survey are left alone (genuinely open, or
 * expired — the expiry cron owns those).
 *
 * Dry-run (default):
 *     npx tsx scripts/_reconcile-stale-survey-invites.ts
 * Apply:
 *     npx tsx scripts/_reconcile-stale-survey-invites.ts --apply
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });

  const pending = await prisma.surveyInvite.findMany({
    where: { status: "PENDING" },
    select: { id: true, dealId: true, customerName: true },
  });
  console.log(`PENDING invites: ${pending.length} (${APPLY ? "APPLY" : "dry-run"})`);

  let closed = 0;
  const skipped: string[] = [];
  for (const inv of pending) {
    const rec = await prisma.scheduleRecord.findFirst({
      where: { projectId: inv.dealId, scheduleType: "survey", status: "scheduled" },
      orderBy: { createdAt: "desc" },
      select: { id: true, scheduledDate: true, scheduledStart: true, assignedUser: true, zuperJobUid: true },
    });
    if (!rec) {
      skipped.push(`${inv.customerName || inv.dealId} (no scheduled survey — left PENDING)`);
      continue;
    }
    console.log(
      `  ${APPLY ? "CLOSE" : "would close"} ${inv.customerName || inv.dealId} → SCHEDULED ${rec.scheduledDate} ${rec.scheduledStart} (${rec.assignedUser})`,
    );
    if (APPLY) {
      await prisma.surveyInvite.update({
        where: { id: inv.id },
        data: {
          status: "SCHEDULED",
          scheduledAt: new Date(),
          ...(rec.scheduledDate ? { scheduledDate: rec.scheduledDate } : {}),
          ...(rec.scheduledStart ? { scheduledTime: rec.scheduledStart } : {}),
          ...(rec.zuperJobUid ? { zuperJobUid: rec.zuperJobUid } : {}),
          scheduleRecordId: rec.id,
        },
      });
      closed++;
    }
  }

  console.log(
    `\n${APPLY ? `Closed ${closed}` : `Would close ${pending.length - skipped.length}`} stale invite(s). Left PENDING: ${skipped.length}.`,
  );
  if (skipped.length) skipped.slice(0, 20).forEach((s) => console.log(`  - ${s}`));
  if (!APPLY) console.log("\nDry run complete. Re-run with --apply.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
