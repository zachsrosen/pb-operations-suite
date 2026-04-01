/**
 * Fix site_surveyor mismatches by looking up deals by project number
 * and updating to match Zuper assignee.
 *
 * Usage:
 *   npx tsx scripts/fix-surveyor-mismatches.ts          # dry-run
 *   npx tsx scripts/fix-surveyor-mismatches.ts --apply   # write to HubSpot
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const DRY_RUN = !process.argv.includes("--apply");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hubspotSearch(body: object): Promise<{ results: Array<{ id: string; properties: Record<string, string | null> }> }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) { await sleep(Math.pow(2, attempt) * 1100 + Math.random() * 400); continue; }
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    return (await res.json()) as { results: Array<{ id: string; properties: Record<string, string | null> }> };
  }
  throw new Error("Max retries");
}

async function hubspotPatch(dealId: string, properties: Record<string, string>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties }),
    });
    if (res.status === 429) { await sleep(Math.pow(2, attempt) * 1100 + Math.random() * 400); continue; }
    if (!res.ok) { console.error(`  PATCH failed for deal ${dealId}: ${res.status} ${await res.text()}`); return false; }
    return true;
  }
  return false;
}

// Fixes: [projectNumber, correctSurveyorName, correctOwnerID]
// Excludes PROJ-8732 (Daniel Kelly — Zuper mistake) and PROJ-8979 (Oleksandr not in HubSpot)
const FIXES: [string, string, string][] = [
  ["PROJ-9543", "Samuel Paro", "218234917"],
  ["PROJ-9521", "Samuel Paro", "218234917"],
  ["PROJ-9545", "Samuel Paro", "218234917"],
  ["PROJ-9551", "Samuel Paro", "218234917"],
  ["PROJ-9536", "Samuel Paro", "218234917"],
  ["PROJ-9517", "Samuel Paro", "218234917"],
  ["PROJ-9529", "Samuel Paro", "218234917"],
  ["PROJ-9537", "Samuel Paro", "218234917"],
  ["PROJ-8708", "Derek Pomar", "216569628"],
  ["PROJ-9474", "Joe Lynch", "216569627"],
  ["PROJ-9061", "Drew Perry", "216569618"],
  ["PROJ-8725", "Derek Pomar", "216569628"],
  ["PROJ-9070", "Drew Perry", "216569618"],
  ["PROJ-9038", "Lucas Scarpellino", "218237048"],
  ["PROJ-8842", "Joe Lynch", "216569627"],
];

async function main() {
  console.log(`=== Fix Site Surveyor Mismatches ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  let updated = 0;
  let failed = 0;

  for (const [projNum, name, ownerId] of FIXES) {
    // Look up deal ID by project number
    const result = await hubspotSearch({
      filterGroups: [{
        filters: [{ propertyName: "project_number", operator: "EQ", value: projNum }],
      }],
      properties: ["project_number", "site_surveyor"],
      limit: 1,
    });
    await sleep(200);

    const deal = result.results[0];
    if (!deal) {
      console.log(`  ${projNum}: Deal not found in HubSpot — skipping`);
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${projNum} (${deal.id}): Would set site_surveyor = "${ownerId}" (${name})`);
      updated++;
    } else {
      const success = await hubspotPatch(deal.id, { site_surveyor: ownerId });
      if (success) {
        console.log(`  ${projNum} (${deal.id}): Updated site_surveyor → ${name}`);
        updated++;
      } else {
        console.log(`  ${projNum} (${deal.id}): FAILED`);
        failed++;
      }
      await sleep(150);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  if (failed) console.log(`Failed/skipped: ${failed}`);
  console.log("=".repeat(50));
  if (DRY_RUN && updated > 0) console.log(`\nRun with --apply to write.`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
