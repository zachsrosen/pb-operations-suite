/**
 * One-time backfill: stamp EagleView properties on the originating deal/ticket
 * for existing order rows, from DB state. Bypasses the feature flag (explicit
 * operator action). Idempotent. Safe to delete after use.
 *
 * Dry-run:  tsx scripts/_backfill-eagleview-hubspot-stamps.ts
 * Apply:    tsx scripts/_backfill-eagleview-hubspot-stamps.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { updateDealProperty } from "../src/lib/hubspot";
import { updateTicketProperties } from "../src/lib/hubspot-tickets";
import { buildEagleViewProps, type EagleViewStampFields } from "../src/lib/eagleview-pipeline";

const STATUS_MAP: Record<string, EagleViewStampFields["status"]> = {
  ORDERED: "Ordered",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode\n" : "DRY-RUN (pass --apply)\n");

  const rows = await prisma.eagleViewOrder.findMany({ orderBy: { orderedAt: "asc" } });
  let stamped = 0, skipped = 0, failed = 0;

  for (const o of rows) {
    if (o.reportId.startsWith("pending:")) { skipped++; continue; }
    const status = STATUS_MAP[o.status];
    if (!status) { skipped++; continue; }

    const fields: EagleViewStampFields = {
      status,
      reportId: o.reportId,
      orderedDate: o.orderedAt,
      deliveredDate: o.deliveredAt ?? null,
      driveFolderUrl: o.driveFolderId
        ? `https://drive.google.com/drive/folders/${o.driveFolderId}`
        : null,
    };
    const props = buildEagleViewProps(fields);
    const targetLabel = o.ticketId ? `ticket ${o.ticketId}` : `deal ${o.dealId}`;
    console.log(`  ${apply ? "STAMP" : "WOULD STAMP"} ${o.reportId} → ${targetLabel} (${status})`);

    if (apply) {
      try {
        const ok = o.ticketId
          ? await updateTicketProperties(o.ticketId, props)
          : await updateDealProperty(o.dealId, props);
        ok ? stamped++ : failed++;
        if (!ok) console.warn(`    write returned false for ${targetLabel}`);
      } catch (e) {
        failed++;
        console.warn(`    error stamping ${targetLabel}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`\nDone. stamped=${stamped} skipped=${skipped} failed=${failed} total=${rows.length}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
