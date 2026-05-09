/**
 * Seed PeDocumentReview table with manually-captured document statuses
 * from the PE portal (raceway.participate.energy).
 *
 * Reads captured data from scripts/pe-doc-data.json, matches PE portal
 * customer names to HubSpot deal IDs via the HubSpot search API, then
 * upserts PeDocumentReview records for each document.
 *
 * Run from main project root (needs .env with DATABASE_URL + HUBSPOT_ACCESS_TOKEN):
 *   node --env-file=.env --import tsx scripts/seed-pe-docs.ts [--dry-run]
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRY_RUN = process.argv.includes("--dry-run");
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL missing from environment");
  process.exit(1);
}
const sql = neon(DB_URL);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeDocStatus =
  | "NOT_UPLOADED"
  | "UPLOADED"
  | "UNDER_REVIEW"
  | "ACTION_REQUIRED"
  | "REJECTED"
  | "APPROVED";

interface CapturedProject {
  name: string;
  docs: Record<string, string>;
}

interface CapturedData {
  capturedAt: string;
  projects: Record<string, CapturedProject>;
}

// ---------------------------------------------------------------------------
// HubSpot deal lookup
// ---------------------------------------------------------------------------

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!HUBSPOT_TOKEN) {
  console.error("❌ HUBSPOT_ACCESS_TOKEN missing from environment");
  process.exit(1);
}

/** Search HubSpot for PE-tagged deals and return name→dealId map */
async function fetchPeDealMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: "EQ",
              value: process.env.HUBSPOT_PIPELINE_PROJECT || "6900017",
            },
            {
              propertyName: "tags",
              operator: "CONTAINS_TOKEN",
              value: "Participate Energy",
            },
          ],
        },
      ],
      properties: ["hs_object_id", "dealname"],
      sorts: [{ propertyName: "dealname", direction: "ASCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    };

    let res: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/deals/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HUBSPOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.log(`   ⏳ Rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      const text = res ? await res.text() : "No response";
      throw new Error(`HubSpot search failed (${res?.status}): ${text}`);
    }

    const data = (await res.json()) as {
      results: { properties: Record<string, string> }[];
      paging?: { next?: { after?: string } };
    };

    for (const deal of data.results) {
      const id = deal.properties.hs_object_id;
      const name = deal.properties.dealname || "";
      if (id && name) {
        map.set(name.toLowerCase().trim(), id);
      }
    }

    after = data.paging?.next?.after;
  } while (after);

  return map;
}

/** Fuzzy match a customer name from the PE portal to a HubSpot deal name */
function findDealId(
  customerName: string,
  dealMap: Map<string, string>,
): string | null {
  const lower = customerName.toLowerCase().trim();

  // Exact match on customer name within deal name
  for (const [dealName, dealId] of dealMap) {
    if (dealName.includes(lower)) return dealId;
  }

  // Try last name only
  const parts = lower.split(/\s+/);
  const lastName = parts[parts.length - 1];
  if (lastName.length >= 3) {
    for (const [dealName, dealId] of dealMap) {
      if (dealName.includes(lastName)) return dealId;
    }
  }

  // Try first name + last name separately
  if (parts.length >= 2) {
    const firstName = parts[0];
    for (const [dealName, dealId] of dealMap) {
      if (dealName.includes(firstName) && dealName.includes(lastName)) {
        return dealId;
      }
    }
  }

  return null;
}

/** Map portal status strings to PeDocStatus enum values */
function normalizeStatus(raw: string): PeDocStatus {
  switch (raw) {
    case "APPROVED":
      return "APPROVED";
    case "ACTION_REQUIRED":
      return "ACTION_REQUIRED";
    case "UNDER_REVIEW":
      return "UNDER_REVIEW";
    case "REJECTED":
      return "REJECTED";
    case "UPLOADED":
      return "UPLOADED";
    case "NOT_UPLOADED":
    case "MISSING":
    case "UNKNOWN":
      return "NOT_UPLOADED";
    default:
      console.warn(`  ⚠ Unknown status "${raw}", defaulting to NOT_UPLOADED`);
      return "NOT_UPLOADED";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    DRY_RUN ? "🔍 DRY RUN — no database writes\n" : "💾 LIVE RUN\n",
  );

  // 1. Load captured data
  const dataPath = join(__dirname, "pe-doc-data.json");
  const raw = readFileSync(dataPath, "utf-8");
  const data: CapturedData = JSON.parse(raw);
  const projectIds = Object.keys(data.projects);
  console.log(
    `📋 Loaded ${projectIds.length} projects captured on ${data.capturedAt}`,
  );

  // 2. Fetch PE deals from HubSpot
  console.log("🔌 Fetching PE deals from HubSpot...");
  const dealMap = await fetchPeDealMap();
  console.log(`   Found ${dealMap.size} PE deals\n`);

  // 3. Match and upsert
  let totalUpserted = 0;
  let totalSkipped = 0;
  const unmatched: string[] = [];

  for (const [projectId, project] of Object.entries(data.projects)) {
    const dealId = findDealId(project.name, dealMap);
    if (!dealId) {
      console.log(`❌ ${projectId} (${project.name}) — no HubSpot deal match`);
      unmatched.push(`${projectId} (${project.name})`);
      continue;
    }

    console.log(
      `✅ ${projectId} (${project.name}) → deal ${dealId}`,
    );

    for (const [docName, rawStatus] of Object.entries(project.docs)) {
      const status = normalizeStatus(rawStatus);

      if (DRY_RUN) {
        console.log(`   📄 ${docName}: ${status}`);
        totalUpserted++;
        continue;
      }

      try {
        const notes = `Captured from PE portal (${projectId}) on ${data.capturedAt}`;
        const reviewedBy = "zach@photonbrothers.com";
        const reviewedAt = new Date(data.capturedAt + "T12:00:00Z").toISOString();
        const id = `cuid_${dealId}_${docName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30)}`;

        await sql`
          INSERT INTO "PeDocumentReview" ("id", "dealId", "docName", "status", "notes", "reviewedBy", "reviewedAt", "createdAt", "updatedAt")
          VALUES (${id}, ${dealId}, ${docName}, ${status}::"PeDocStatus", ${notes}, ${reviewedBy}, ${reviewedAt}::timestamp, NOW(), NOW())
          ON CONFLICT ("dealId", "docName")
          DO UPDATE SET
            "status" = ${status}::"PeDocStatus",
            "notes" = ${notes},
            "reviewedBy" = ${reviewedBy},
            "reviewedAt" = ${reviewedAt}::timestamp,
            "updatedAt" = NOW()
        `;
        totalUpserted++;
      } catch (err) {
        console.error(`   ❌ Failed to upsert ${docName}:`, err);
        totalSkipped++;
      }
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Upserted: ${totalUpserted} document reviews`);
  if (totalSkipped > 0) console.log(`⚠ Skipped:   ${totalSkipped}`);
  if (unmatched.length > 0) {
    console.log(`❌ Unmatched: ${unmatched.length}`);
    unmatched.forEach((u) => console.log(`   - ${u}`));
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
