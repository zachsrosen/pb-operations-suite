/**
 * Load the Xcel Case# -> IA# crosswalk onto HubSpot deals.
 *
 * WHY: Xcel's chatter notification emails (from solarprogrammn@xcelenergy.com)
 * cite ONLY the Interconnection Application number (IA160801). HubSpot only
 * stores the Case number (06405260, in utility_application__). The two numbers
 * coexist nowhere except inside Xcel's Renewables portal, so chatter emails
 * cannot be matched to a deal. Verified 2026-07-17: searching HubSpot for any
 * IA-prefixed value in utility_application__ returns 0 deals.
 *
 * This stamps xcel_ia_number on each deal so the shared-inbox correspondence
 * matcher can bind those emails.
 *
 * INPUT: CSV from scripts/xcel-crosswalk-extract.js (run in the portal console)
 *        header: case_number,ia_number,record_id
 *
 * USAGE:
 *   npx tsx scripts/load-xcel-ia-crosswalk.ts crosswalk.csv           # dry run
 *   npx tsx scripts/load-xcel-ia-crosswalk.ts crosswalk.csv --apply   # write
 */

import { readFileSync } from "node:fs";

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const SEARCH_URL = "https://api.hubapi.com/crm/v3/objects/deals/search";
const DEAL_URL = "https://api.hubapi.com/crm/v3/objects/deals";

/** HubSpot search allows ~4 req/sec sustained; stay well under. */
const THROTTLE_MS = 300;

interface Row {
  caseNumber: string;
  iaNumber: string;
}

function parseCsv(path: string): Row[] {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header || !/case_number/i.test(header)) {
    throw new Error(`Expected a header row with case_number,ia_number. Got: ${header}`);
  }
  const cols = header.split(",").map((c) => c.trim().toLowerCase());
  const ci = cols.indexOf("case_number");
  const ii = cols.indexOf("ia_number");
  if (ci < 0 || ii < 0) throw new Error("CSV must have case_number and ia_number columns");

  const rows: Row[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    const caseNumber = (parts[ci] ?? "").trim();
    const iaNumber = (parts[ii] ?? "").trim().toUpperCase();
    // Case numbers are zero-padded 8 digits; IA numbers are IA + digits.
    if (/^\d{6,8}$/.test(caseNumber) && /^IA\d+$/.test(iaNumber)) {
      rows.push({ caseNumber, iaNumber });
    }
  }
  return rows;
}

async function findDealByCaseNumber(caseNumber: string) {
  const body = {
    filterGroups: [
      {
        filters: [
          {
            // utility_application__ is hand-entered and often polluted
            // ("06405260 (PSPS) J STEPHEN POLLOCK"), so match on the token.
            propertyName: "utility_application__",
            operator: "CONTAINS_TOKEN",
            value: `*${caseNumber}*`,
          },
        ],
      },
    ],
    properties: ["project_number", "dealname", "utility_application__", "xcel_ia_number"],
    limit: 5,
  };
  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HubSpot search ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).results ?? [];
}

async function setIaNumber(dealId: string, iaNumber: string) {
  const r = await fetch(`${DEAL_URL}/${dealId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { xcel_ia_number: iaNumber } }),
  });
  if (!r.ok) throw new Error(`HubSpot patch ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  const [csvPath, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (!csvPath) {
    console.error("usage: tsx scripts/load-xcel-ia-crosswalk.ts <crosswalk.csv> [--apply]");
    process.exit(1);
  }
  if (!HUBSPOT_TOKEN) {
    console.error("HUBSPOT_ACCESS_TOKEN not set");
    process.exit(1);
  }

  const rows = parseCsv(csvPath);
  console.log(`${rows.length} valid crosswalk rows${apply ? "" : "  (DRY RUN — pass --apply to write)"}\n`);

  const stats = { matched: 0, noDeal: 0, ambiguous: 0, unchanged: 0, written: 0, failed: 0 };

  for (const row of rows) {
    try {
      const deals = await findDealByCaseNumber(row.caseNumber);

      if (deals.length === 0) {
        stats.noDeal++;
        console.log(`  ${row.caseNumber} -> ${row.iaNumber}   NO DEAL`);
      } else if (deals.length > 1) {
        // Ambiguity means the case number matched several deals; skip rather
        // than guess, and report so it can be resolved by hand.
        stats.ambiguous++;
        const names = deals.map((d: { properties: { project_number?: string } }) => d.properties.project_number).join(", ");
        console.log(`  ${row.caseNumber} -> ${row.iaNumber}   AMBIGUOUS (${names}) — skipped`);
      } else {
        const deal = deals[0];
        const existing = deal.properties.xcel_ia_number;
        stats.matched++;
        if (existing === row.iaNumber) {
          stats.unchanged++;
        } else {
          const note = existing ? ` (was ${existing})` : "";
          console.log(`  ${row.caseNumber} -> ${row.iaNumber}   ${deal.properties.project_number}${note}`);
          if (apply) {
            await setIaNumber(deal.id, row.iaNumber);
            stats.written++;
          }
        }
      }
    } catch (err) {
      stats.failed++;
      console.log(`  ${row.caseNumber}   ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  console.log("\n--- summary ---");
  console.table(stats);
  if (!apply && stats.matched > 0) {
    console.log("Dry run. Re-run with --apply to write xcel_ia_number.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
