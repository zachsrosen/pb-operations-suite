/**
 * Audit: pipeline-generated Sales Orders that should contain a base Powerwall 3
 * (model 1707000) but where it was dropped by the stale BOM_QUERY_OVERRIDES SKU
 * (1707000-21-K, fixed → 1707000-21-M on 2026-06-15).
 *
 * For every BomPipelineRun whose saved BOM snapshot contained a base PW3, this
 * fetches the LIVE Zoho SO and reports whether a base PW3 line item is present
 * today (ops may have manually corrected some). Read-only. Writes a JSON list.
 *
 *   npx tsx --env-file=.env scripts/audit-pw3-missing-base.ts
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import { ZohoInventoryClient } from "../src/lib/zoho-inventory.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});
const zoho = new ZohoInventoryClient();

const BASE_PW3 = /\b1707000\b/i;
const EXPANSION = /\b1807000\b/i;

type Row = {
  dealId: string;
  soNumber: string | null;
  soId: string | null;
  customer: string | null;
  createdAt: string;
  snapshotBaseQty: number;
  snapshotExpansionQty: number;
  soBaseQty: number | null; // null = SO not fetchable
  soExpansionQty: number;
  soStatus: string | null;
  soItemCount: number;
  // NEEDS_BASE: live SO lacks the base PW3 on a real (multi-line) order → must remediate.
  // REVIEW: lacks base but is a small/stub SO (likely a change-order or superseded) → eyeball.
  // OK: base present.  SO_NOT_FOUND: order not fetchable.
  status: "NEEDS_BASE" | "REVIEW" | "OK" | "SO_NOT_FOUND";
};

function sumQty(items: any[], re: RegExp, modelKeys: string[]): number {
  return items
    .filter((i) => re.test(modelKeys.map((k) => i[k] ?? "").join(" ")))
    .reduce((s, i) => s + (Number(i.qty ?? i.quantity) || 0), 0);
}

async function main() {
  const runs = await prisma.bomPipelineRun.findMany({
    where: { zohoSoId: { not: null } },
    select: { dealId: true, zohoSoNumber: true, zohoSoId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: Row[] = [];
  let processed = 0;

  for (const run of runs) {
    if (!run.dealId) continue;
    const snap = await prisma.projectBomSnapshot.findFirst({
      where: { dealId: run.dealId },
      orderBy: { version: "desc" },
      select: { bomData: true },
    });
    const snapItems = ((snap?.bomData as any)?.items as any[]) || [];
    const snapshotBaseQty = sumQty(snapItems, BASE_PW3, ["model", "description"]);
    if (snapshotBaseQty === 0) continue; // only audit SOs that SHOULD have a base PW3

    const snapshotExpansionQty = sumQty(snapItems, EXPANSION, ["model", "description"]);

    let soBaseQty: number | null = null;
    let soExpansionQty = 0;
    let customer: string | null = null;
    let soStatus: string | null = null;
    let soItemCount = 0;
    try {
      const so: any = await zoho
        .getSalesOrderById(run.zohoSoId!)
        .catch(() => (run.zohoSoNumber ? zoho.getSalesOrder(run.zohoSoNumber) : null));
      if (so) {
        const li = so.line_items || [];
        customer = so.customer_name ?? null;
        soStatus = so.status ?? null;
        soItemCount = li.length;
        soBaseQty = sumQty(li, BASE_PW3, ["sku", "name"]);
        soExpansionQty = sumQty(li, EXPANSION, ["sku", "name"]);
      }
    } catch {
      /* leave soBaseQty null */
    }

    let status: Row["status"];
    if (soBaseQty === null) status = "SO_NOT_FOUND";
    else if (soBaseQty > 0) status = "OK";
    // base missing: a real multi-line order needs it; a tiny stub SO needs human review
    else if (soItemCount >= 5) status = "NEEDS_BASE";
    else status = "REVIEW";

    rows.push({
      dealId: run.dealId,
      soNumber: run.zohoSoNumber,
      soId: run.zohoSoId,
      customer,
      createdAt: run.createdAt.toISOString().slice(0, 10),
      snapshotBaseQty,
      snapshotExpansionQty,
      soBaseQty,
      soExpansionQty,
      soStatus,
      soItemCount,
      status,
    });

    processed++;
    if (processed % 20 === 0) console.error(`  ...checked ${processed} SOs`);
  }

  const byStatus = (s: Row["status"]) => rows.filter((r) => r.status === s);
  const needs = byStatus("NEEDS_BASE").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const review = byStatus("REVIEW").sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  console.log(`\n=== PW3 base-unit audit ===`);
  console.log(`SOs whose snapshot had a base PW3: ${rows.length}`);
  console.log(`  NEEDS_BASE (real order missing base PW3): ${needs.length}`);
  console.log(`  REVIEW (stub/superseded, base missing):   ${review.length}`);
  console.log(`  OK (base present on SO):                  ${byStatus("OK").length}`);
  console.log(`  SO_NOT_FOUND (deleted/unfetchable):       ${byStatus("SO_NOT_FOUND").length}`);

  const line = (r: Row) =>
    `  ${r.soNumber}  ${r.customer ?? ""}  (deal ${r.dealId}, ${r.createdAt})  ` +
    `status=${r.soStatus}, items=${r.soItemCount}  ` +
    `snapshot base x${r.snapshotBaseQty}, expansion x${r.snapshotExpansionQty}`;

  console.log(`\n--- NEEDS_BASE: add base PW3 1707000-21-M (qty = snapshot base) ---`);
  for (const r of needs) console.log(line(r));

  console.log(`\n--- REVIEW: base missing but small/stub SO — confirm before acting ---`);
  for (const r of review) console.log(line(r));

  const out = "data/pw3-missing-base-audit.json";
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\nFull results written to ${out}`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
