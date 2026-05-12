/* eslint-disable no-console */
/**
 * One-off historical sweep for DA status drift.
 *
 * Mirrors /api/cron/pandadoc-da-reconcile but with a wider lookback
 * (default 30 days). Latest-doc-per-deal dedup so multi-revision DAs
 * don't generate false positives.
 *
 * Usage:
 *   LOOKBACK_DAYS=30 npx tsx scripts/backfill-da-drift.ts
 *   WIPE=1 LOOKBACK_DAYS=30 npx tsx scripts/backfill-da-drift.ts
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
  pickLatestDocPerDeal,
  type PandaDocDocumentDetail,
} from "../src/lib/pandadoc";
import { hubspotClient } from "../src/lib/hubspot";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 30);
const WIPE = process.env.WIPE === "1";

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (WIPE) {
    const wiped = await prisma.daStatusDrift.deleteMany({});
    console.log(`Wiped ${wiped.count} existing drift rows (WIPE=1).`);
  }

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

  // Phase 1: fetch detail for every terminal candidate.
  const withDealId: Array<{ detail: PandaDocDocumentDetail; dealId: string }> = [];
  const errors: string[] = [];
  let terminal = 0;
  for (const doc of docs) {
    if (!isCandidateForReconcile(doc.status)) continue;
    terminal++;
    try {
      const detail = await getDocumentDetail(doc.id);
      const dealId = extractHubspotDealId(detail);
      if (!dealId) {
        errors.push(`${doc.id}: no HubSpot deal linkage`);
        continue;
      }
      withDealId.push({ detail, dealId });
    } catch (err) {
      errors.push(`${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Phase 2: dedupe per deal — keep only the latest doc per deal.
  const { latest, supersededPandaDocIds } = pickLatestDocPerDeal(withDealId);
  console.log(
    `Grouped into ${latest.size} unique deals; ${supersededPandaDocIds.size} older revisions superseded.`,
  );

  // Phase 3: check drift on each deal's latest doc.
  let matched = 0;
  let drifted = 0;
  let unanswered = 0;
  let autoResolved = 0;

  for (const [dealId, { detail }] of latest) {
    const expected = expectedLayoutStatusForDoc(detail);
    if (!expected) {
      unanswered++;
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
        `${detail.id}/deal=${dealId}: hubspot fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    // Auto-resolve any open drift rows for OLDER revisions of this deal.
    const autoResolveResult = await prisma.daStatusDrift.updateMany({
      where: {
        hubspotDealId: dealId,
        pandaDocId: { not: detail.id },
        status: "OPEN",
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: "system:superseded",
        resolveNote: `Superseded by newer DA revision (${detail.id})`,
      },
    });
    autoResolved += autoResolveResult.count;

    if (actualLayoutStatus === expected) {
      matched++;
      // Heal the latest doc's own row if it was previously flagged.
      await prisma.daStatusDrift.updateMany({
        where: { pandaDocId: detail.id, status: "OPEN" },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: "system:healed",
          resolveNote: "HubSpot layout_status now matches PandaDoc dropdown",
        },
      });
      continue;
    }

    drifted++;
    await prisma.daStatusDrift.upsert({
      where: { pandaDocId: detail.id },
      update: {
        hubspotDealId: dealId,
        templateId: detail.template?.id ?? null,
        documentName: detail.name,
        pandaDocStatus: detail.status,
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
        pandaDocId: detail.id,
        hubspotDealId: dealId,
        templateId: detail.template?.id ?? null,
        documentName: detail.name,
        pandaDocStatus: detail.status,
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
  }

  console.log("\n=== Summary ===");
  console.log(`Scanned docs:                   ${docs.length}`);
  console.log(`Terminal (completed/declined):  ${terminal}`);
  console.log(`Unique deals after dedupe:      ${latest.size}`);
  console.log(`Superseded older revisions:     ${supersededPandaDocIds.size}`);
  console.log(`Unanswered dropdown (skipped):   ${unanswered}`);
  console.log(`Matched (HubSpot in sync):      ${matched}`);
  console.log(`Drifted (mismatch logged):      ${drifted}`);
  console.log(`Auto-resolved stale rows:        ${autoResolved}`);
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
