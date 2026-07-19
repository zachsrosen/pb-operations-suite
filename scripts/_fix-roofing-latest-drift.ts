// scripts/_fix-roofing-latest-drift.ts
// One-off corrective: the first backfill run used the pre-fix NULLS-FIRST ordering,
// which mis-picked the "latest" roofing permit on a handful of properties. This
// recomputes the correct latest (coalesced issueDate??fileDate, max) and re-pushes
// ONLY the properties whose pick differs, updating all four roofing_* fields so the
// number/jurisdiction match the corrected date.
//
// Usage: tsx scripts/_fix-roofing-latest-drift.ts [--apply]
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const APPLY = process.argv.includes("--apply");

// Emulates the OLD backfill pick (Postgres NULLS-FIRST desc on issueDate, then fileDate desc).
function oldPick<T extends { issueDate: Date | null; fileDate: Date | null }>(recs: T[]): T {
  const ordered = [...recs].sort((a, b) => {
    const ai = a.issueDate?.getTime() ?? null, bi = b.issueDate?.getTime() ?? null;
    if (ai === null && bi !== null) return -1;
    if (bi === null && ai !== null) return 1;
    if (ai !== null && bi !== null && ai !== bi) return bi - ai;
    const af = a.fileDate?.getTime() ?? null, bf = b.fileDate?.getTime() ?? null;
    if (af === null && bf !== null) return -1;
    if (bf === null && af !== null) return 1;
    return (bf ?? 0) - (af ?? 0);
  });
  return ordered.find((p) => p.issueDate || p.fileDate) ?? ordered[0];
}

function newPick<T extends { issueDate: Date | null; fileDate: Date | null }>(recs: T[]): T {
  const dated = recs
    .map((p) => ({ p, w: p.issueDate ?? p.fileDate }))
    .filter((x): x is { p: T; w: Date } => x.w != null)
    .sort((a, b) => b.w.getTime() - a.w.getTime());
  return dated[0]?.p ?? recs[0];
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  if (!prisma) throw new Error("no db");
  const { updateProperty } = await import("../src/lib/hubspot-property");

  const props = await prisma.hubSpotPropertyCache.findMany({
    where: { shovelsEnrichmentStatus: "ENRICHED" },
    select: { id: true, hubspotObjectId: true, fullAddress: true },
  });

  let fixed = 0, failed = 0;
  for (const prop of props) {
    const recs = await prisma.shovelsPermitRecord.findMany({
      where: { propertyId: prop.id, tags: { has: "roofing" } },
      select: { issueDate: true, fileDate: true, permitNumber: true, jurisdiction: true },
    });
    if (recs.length === 0) continue;

    const oldP = oldPick(recs);
    const newP = newPick(recs);
    const oldWhen = (oldP.issueDate ?? oldP.fileDate)?.toISOString().slice(0, 10);
    const newWhen = (newP.issueDate ?? newP.fileDate)?.toISOString().slice(0, 10);
    if (oldWhen === newWhen && oldP.permitNumber === newP.permitNumber) continue; // no drift

    const props4: Record<string, string | number | null> = { roofing_permit_count: recs.length };
    if (newWhen) props4.latest_roofing_permit_date = newWhen;
    if (newP.permitNumber) props4.latest_roofing_permit_number = newP.permitNumber;
    if (newP.jurisdiction) props4.latest_roofing_permit_jurisdiction = newP.jurisdiction;

    console.log(`${(prop.fullAddress ?? prop.id).slice(0, 42).padEnd(42)} ${oldWhen} -> ${newWhen}  #${newP.permitNumber ?? "-"}`);
    if (APPLY) {
      try {
        await updateProperty(prop.hubspotObjectId, props4);
        fixed++;
      } catch (err) {
        failed++;
        console.error(`  FAILED ${prop.id}:`, err instanceof Error ? err.message : err);
      }
    } else {
      fixed++;
    }
  }
  console.log(`\n${APPLY ? "Fixed" : "Would fix"}: ${fixed}, failed: ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
