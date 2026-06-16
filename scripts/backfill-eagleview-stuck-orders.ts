/**
 * Backfill delivery for EagleView orders stranded in ORDERED.
 *
 * Re-runs the (now fixed, dual-folder) delivery pipeline over every
 * EagleViewOrder still in ORDERED with a real reportId. The root cause —
 * a Drive folder URL passed to the API as a bare id — is fixed in
 * eagleview-pipeline-deps.ts; this script delivers the rows that were
 * stranded before the fix shipped.
 *
 * Idempotent + resumable: fetchAndStoreDeliverables() skips rows already
 * DELIVERED, so re-running only touches what's left. Safe to re-run.
 *
 * Run (from the dual-folder worktree so it imports the fixed code):
 *   node --env-file=/tmp/evprod.env --import tsx scripts/backfill-eagleview-stuck-orders.ts --dry-run
 *   node --env-file=/tmp/evprod.env --import tsx scripts/backfill-eagleview-stuck-orders.ts
 *   ... --rid 71282781            # limit to one report id (repeatable)
 *
 * Env required: DATABASE_URL, EAGLEVIEW_CLIENT_ID/SECRET, EAGLEVIEW_BASE_URL,
 *   HUBSPOT_ACCESS_TOKEN, GOOGLE service-account creds (Drive).
 */
import { prisma } from "../src/lib/db";
import { fetchAndStoreDeliverables } from "../src/lib/eagleview-pipeline";
import { defaultPipelineDeps } from "../src/lib/eagleview-pipeline-deps";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ridFilter = args
  .map((a, i) => (a === "--rid" ? args[i + 1] : null))
  .filter((x): x is string => !!x);

async function main() {
  const deps = defaultPipelineDeps();

  const rows = await prisma.eagleViewOrder.findMany({
    where: {
      status: "ORDERED",
      reportId: { not: { startsWith: "pending:" } },
      ...(ridFilter.length ? { reportId: { in: ridFilter } } : {}),
    },
    orderBy: { orderedAt: "asc" },
  });

  console.log(
    `${DRY_RUN ? "[DRY-RUN] " : ""}${rows.length} stuck ORDERED order(s) to process\n`,
  );

  const tally: Record<string, number> = {};
  for (const order of rows) {
    const rid = order.reportId;
    try {
      // Gate on EagleView status first: only deliver Completed/Delivered
      // reports. Leaves in-progress + terminal-but-undeliverable rows
      // (e.g. "Closed - Wrong House") untouched in ORDERED for the cron.
      const rep = await deps.client.getReport(rid);
      const status = (rep.displayStatus ?? "").toLowerCase();
      const isComplete =
        status.includes("complet") || status.includes("delivered");
      if (!isComplete) {
        tally.skip_not_complete = (tally.skip_not_complete ?? 0) + 1;
        console.log(
          `  rid=${rid} deal=${order.dealId} => SKIP (status=${rep.displayStatus ?? "?"})`,
        );
        continue;
      }

      if (DRY_RUN) {
        // file-links can be 204 (no body) even when Completed; treat as 0.
        const links = await deps.client
          .getFileLinks(rid)
          .then((r) => r.links ?? [])
          .catch(() => []);
        const deal = await deps.fetchDealAddress(order.dealId);
        const designParent =
          deal?.driveDesignDocumentsFolderId ??
          deal?.driveAllDocumentsFolderId ??
          null;
        let surveyParent = deal?.driveSiteSurveyFolderId ?? null;
        if (!surveyParent && deal?.driveAllDocumentsFolderId) {
          surveyParent = await deps.findSiteSurveyFolder(
            deal.driveAllDocumentsFolderId,
          );
        }
        const targets = [
          designParent ? `Design=${designParent}` : null,
          surveyParent && surveyParent !== designParent
            ? `SiteSurvey=${surveyParent}`
            : null,
        ].filter(Boolean);
        const ok = isComplete && links.length > 0 && targets.length > 0;
        tally[ok ? "would_deliver" : "would_skip"] =
          (tally[ok ? "would_deliver" : "would_skip"] ?? 0) + 1;
        console.log(
          `  rid=${rid} deal=${order.dealId} status=${rep.displayStatus} files=${links.length} ` +
            `targets=[${targets.join(", ")}] => ${ok ? "WOULD DELIVER" : "WOULD SKIP"}`,
        );
      } else {
        const r = await fetchAndStoreDeliverables(deps, rid);
        tally[r.status] = (tally[r.status] ?? 0) + 1;
        console.log(
          `  rid=${rid} deal=${order.dealId} => ${r.status}${r.reason ? ` (${r.reason})` : ""}${r.driveFolderId ? ` folder=${r.driveFolderId}` : ""}`,
        );
      }
    } catch (err) {
      tally.ERROR = (tally.ERROR ?? 0) + 1;
      console.log(
        `  rid=${rid} deal=${order.dealId} => ERROR ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(`\nTotals:`, tally);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
