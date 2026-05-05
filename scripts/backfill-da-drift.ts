/* eslint-disable no-console */
/**
 * One-off historical sweep for DA status drift.
 *
 * Reuses /api/cron/pandadoc-da-reconcile logic with a configurable
 * lookback (default 30 days). Idempotent — upserts keyed on pandaDocId.
 *
 * Usage:
 *   LOOKBACK_DAYS=30 npx tsx scripts/backfill-da-drift.ts
 *
 * Delete this file after the one-off sweep is done.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import {
  DA_TEMPLATE_ID,
  expectedLayoutStatusForDoc,
  extractHubspotDealId,
  getDocumentDetail,
  isCandidateForReconcile,
  listDocumentsByTemplate,
} from "../src/lib/pandadoc";
import { hubspotClient } from "../src/lib/hubspot";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 30);

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const modifiedFrom = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  console.log(
    `Sweeping DAs modified since ${modifiedFrom.toISOString()} (${LOOKBACK_DAYS}d lookback)...`,
  );

  const docs = await listDocumentsByTemplate({
    templateId: DA_TEMPLATE_ID,
    modifiedFrom,
    pageSize: 100,
    maxPages: 50,
  });

  console.log(`Found ${docs.length} DA documents in window.`);

  let terminal = 0;
  let matched = 0;
  let drifted = 0;
  const errors: string[] = [];

  let unanswered = 0;
  for (const doc of docs) {
    if (!isCandidateForReconcile(doc.status)) continue;
    terminal++;

    try {
      const detail = await getDocumentDetail(doc.id);
      const expected = expectedLayoutStatusForDoc(detail);
      if (!expected) {
        unanswered++;
        continue;
      }
      const dealId = extractHubspotDealId(detail);
      if (!dealId) {
        errors.push(`${doc.id}: no HubSpot deal linkage`);
        continue;
      }

      let actualLayoutStatus: string | null = null;
      try {
        const dealRes = await hubspotClient.crm.deals.basicApi.getById(dealId, [
          "layout_status",
        ]);
        actualLayoutStatus =
          (dealRes.properties?.layout_status as string | undefined) ?? null;
      } catch (err) {
        errors.push(
          `${doc.id}/deal=${dealId}: hubspot fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      if (actualLayoutStatus === expected) {
        matched++;
        continue;
      }

      drifted++;
      await prisma.daStatusDrift.upsert({
        where: { pandaDocId: doc.id },
        update: {
          hubspotDealId: dealId,
          templateId: detail.template?.id ?? null,
          documentName: detail.name,
          pandaDocStatus: doc.status,
          expectedHubspot: expected,
          actualHubspot: actualLayoutStatus,
          pandaDocSentAt: detail.date_sent ? new Date(detail.date_sent) : null,
          pandaDocCompleted: detail.date_completed
            ? new Date(detail.date_completed)
            : null,
          status: "OPEN",
          resolvedAt: null,
          resolvedBy: null,
          resolveNote: null,
        },
        create: {
          pandaDocId: doc.id,
          hubspotDealId: dealId,
          templateId: detail.template?.id ?? null,
          documentName: detail.name,
          pandaDocStatus: doc.status,
          expectedHubspot: expected,
          actualHubspot: actualLayoutStatus,
          pandaDocSentAt: detail.date_sent ? new Date(detail.date_sent) : null,
          pandaDocCompleted: detail.date_completed
            ? new Date(detail.date_completed)
            : null,
        },
      });

      process.stdout.write(
        `  • drift: deal=${dealId} expected="${expected}" actual="${
          actualLayoutStatus ?? "(empty)"
        }" — ${(detail.name ?? "").slice(0, 80)}\n`,
      );
    } catch (err) {
      errors.push(
        `${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Scanned:                        ${docs.length}`);
  console.log(`Terminal (completed/declined):  ${terminal}`);
  console.log(`Unanswered dropdown (skipped):   ${unanswered}`);
  console.log(`Matched (HubSpot in sync):      ${matched}`);
  console.log(`Drifted (mismatch logged):      ${drifted}`);
  console.log(`Errors:                          ${errors.length}`);
  if (errors.length) {
    console.log("\nErrors:");
    errors.slice(0, 20).forEach((e) => console.log("  -", e));
    if (errors.length > 20) console.log(`  ... ${errors.length - 20} more`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
