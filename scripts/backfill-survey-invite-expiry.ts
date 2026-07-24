/**
 * Backfill for the two survey-invite expiry bugs (found 7/23).
 *
 * Phase 1 — unblock re-invites. Flip PENDING invites that are past their
 * expiry to EXPIRED. Nothing ever did this (the only EXPIRED write ran when a
 * customer clicked their dead link), so deals whose invite lapsed unused were
 * permanently 409-locked against a new invite. Olivia had been skipping them
 * since June.
 *
 * Phase 2 — unblock booked customers. Extend expiresAt on SCHEDULED /
 * RESCHEDULED invites still carrying the original 14-day TTL. Booking never
 * extended the token, so a customer clicking their own link to reschedule
 * past that TTL had their live booking stamped EXPIRED.
 *
 * Reports each affected deal's current HubSpot stage so ops can see which
 * customers still actually need a survey.
 *
 * Usage:
 *   npx tsx scripts/backfill-survey-invite-expiry.ts            # dry run
 *   npx tsx scripts/backfill-survey-invite-expiry.ts --apply    # write
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Real HubSpot deal ids are numeric; the rest are Postman/E2E leftovers. */
function isRealDeal(dealId: string): boolean {
  return /^\d{8,}$/.test(dealId);
}

async function fetchDealStages(dealIds: string[]) {
  const stages = new Map<string, Record<string, string>>();
  if (dealIds.length === 0) return stages;

  const { hubspotClient, DEAL_STAGE_MAP } = await import("../src/lib/hubspot");
  const { getStageMaps } = await import("../src/lib/deals-pipeline");

  // DEAL_STAGE_MAP only covers the project pipeline; these invites span sales
  // too, so flatten every pipeline's stage labels as a fallback.
  const allStages: Record<string, string> = { ...DEAL_STAGE_MAP };
  try {
    for (const perPipeline of Object.values(await getStageMaps())) {
      Object.assign(allStages, perPipeline);
    }
  } catch {
    /* static map is good enough */
  }

  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    try {
      const res = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map((id) => ({ id })),
        properties: ["dealname", "project_number", "dealstage", "site_survey_date"],
        propertiesWithHistory: [],
      });
      for (const deal of res.results) {
        const stageId = deal.properties.dealstage || "";
        stages.set(deal.id, {
          projectNumber: deal.properties.project_number || "",
          dealName: deal.properties.dealname || "",
          stage: allStages[stageId] || stageId,
          siteSurveyDate: deal.properties.site_survey_date || "",
        });
      }
    } catch (err) {
      console.warn(`  (HubSpot batch read failed for ${batch.length} deals)`, err);
    }
  }
  return stages;
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  if (!prisma) throw new Error("DATABASE_URL not configured");

  const now = new Date();
  console.log(`\n=== Survey invite expiry backfill (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: lapsed PENDING invites blocking re-invites
  // -------------------------------------------------------------------------
  const stalePending = await prisma.surveyInvite.findMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
  });

  console.log(`Phase 1 — lapsed PENDING invites: ${stalePending.length}`);

  const realStale = stalePending.filter((i) => isRealDeal(i.dealId));
  const stages = await fetchDealStages(realStale.map((i) => i.dealId));

  for (const invite of stalePending) {
    const meta = stages.get(invite.dealId);
    const label = meta
      ? `${meta.projectNumber || invite.dealId} — ${meta.stage}${meta.siteSurveyDate ? ` (survey ${meta.siteSurveyDate.slice(0, 10)})` : " (NO SURVEY BOOKED)"}`
      : `${invite.dealId} — test/non-deal row`;
    console.log(
      `  ${invite.expiresAt.toISOString().slice(0, 10)}  ${(invite.customerName || "").padEnd(22)} ${label}`,
    );
  }

  if (APPLY && stalePending.length > 0) {
    const { count } = await prisma.surveyInvite.updateMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    });
    console.log(`  → flipped ${count} to EXPIRED`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: booked invites whose token TTL already lapsed
  // -------------------------------------------------------------------------
  const staleBooked = await prisma.surveyInvite.findMany({
    where: {
      status: { in: ["SCHEDULED", "RESCHEDULED"] },
      expiresAt: { lt: now },
    },
    orderBy: { expiresAt: "asc" },
  });

  console.log(`\nPhase 2 — booked invites past token TTL: ${staleBooked.length}`);

  let extended = 0;
  for (const invite of staleBooked) {
    // Anchor on the booking itself; fall back to when the customer booked.
    const anchor = invite.scheduledDate
      ? new Date(`${invite.scheduledDate}T12:00:00Z`)
      : invite.scheduledAt;
    if (!anchor || Number.isNaN(anchor.getTime())) {
      console.log(`  SKIP ${invite.dealId} ${invite.customerName} — no booking date to anchor on`);
      continue;
    }

    const newExpiry = new Date(anchor.getTime() + GRACE_MS);
    if (newExpiry <= invite.expiresAt) continue;

    extended++;
    if (APPLY) {
      await prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { expiresAt: newExpiry },
      });
    }
  }

  console.log(
    `  ${APPLY ? "extended" : "would extend"} ${extended} booking token(s) to survey date + 7d`,
  );

  console.log(`\n${APPLY ? "Done." : "Dry run — re-run with --apply to write."}\n`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
