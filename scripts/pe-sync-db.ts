#!/usr/bin/env npx tsx
/**
 * PE Portal Doc Status → Database Sync
 *
 * Reads the compact PE scrape data, matches projects to HubSpot deals,
 * and upserts document statuses into PeDocumentReview via direct SQL.
 *
 * Usage:
 *   npx tsx scripts/pe-sync-db.ts              # dry run
 *   npx tsx scripts/pe-sync-db.ts --execute    # actually write to DB
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

// Load env
const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../../.env"),
  "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.env",
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

import { Client as HubSpotClient } from "@hubspot/api-client";

const EXECUTE = process.argv.includes("--execute");
const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

// ---------------------------------------------------------------------------
// PE document constants
// ---------------------------------------------------------------------------

const DOC_NAMES = [
  "Customer Agreement (PPA/ESA)",
  "Installation Order",
  "State Disclosures",
  "Utility Bill",
  "Signed Proposal",
  "Design Plan",
  "Photos per Policy",
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
  "Signed Interconnection Agreement",
  "Conditional Waiver — Final Payment",
  "Permission to Operate (PTO)",
];

// Maps compact status codes → PeDocStatus enum values (must match Prisma enum)
const STATUS_MAP: Record<string, string> = {
  A: "APPROVED",
  R: "ACTION_REQUIRED",
  U: "UNDER_REVIEW",
  N: "NOT_UPLOADED",
  X: "UPLOADED",
  D: "UPLOADED",
  F: "NOT_UPLOADED",
  K: "NOT_UPLOADED",
};

const MILESTONE_MAP: Record<string, string> = {
  OB: "Project Onboarded",
  IC: "Inspection Complete",
  PC: "Project Complete",
};

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Read compact scrape
  const compactPath = path.join(__dirname, "pe-scrape-compact.txt");
  const lines = fs.readFileSync(compactPath, "utf-8").split("\n").filter(l => l.trim());
  console.log(`📋 Loaded ${lines.length} scraped PE projects\n`);

  // 2. Fetch PE deals from HubSpot
  const hsClient = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

  interface HsDeal {
    id: string;
    dealname: string;
    pe_project_id: string | null;
  }

  const deals: HsDeal[] = [];
  let after: string | undefined;
  do {
    const resp = await hsClient.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: "EQ", value: PROJECT_PIPELINE_ID },
            { propertyName: "tags", operator: "CONTAINS_TOKEN", value: "Participate Energy" },
          ],
        },
      ],
      properties: ["hs_object_id", "dealname", "pe_project_id"],
      sorts: [{ propertyName: "dealname", direction: "ASCENDING" }] as any,
      limit: 100,
      ...(after ? { after } : {}),
    } as any);

    for (const d of resp.results) {
      deals.push({
        id: String(d.properties.hs_object_id),
        dealname: String(d.properties.dealname || ""),
        pe_project_id: d.properties.pe_project_id || null,
      });
    }
    after = (resp as any).paging?.next?.after;
  } while (after);

  console.log(`🔗 Fetched ${deals.length} PE deals from HubSpot\n`);

  // 3. Build lookup maps
  const peIdMap = new Map<string, string>(); // pe_project_id → deal_id
  const nameMap = new Map<string, HsDeal[]>(); // normalized name → deals

  for (const d of deals) {
    if (d.pe_project_id) {
      peIdMap.set(d.pe_project_id.toLowerCase(), d.id);
    }
    const norm = normalize(d.dealname);
    if (!nameMap.has(norm)) nameMap.set(norm, []);
    nameMap.get(norm)!.push(d);
  }

  // 4. Match and build upsert operations
  interface UpsertOp {
    dealId: string;
    docName: string;
    status: string;
    notes: string;
  }

  const ops: UpsertOp[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length !== 4) continue;
    const [peProjectId, customerName, milestoneCode, docCodes] = parts;
    if (docCodes.length !== 15) continue;

    const milestone = MILESTONE_MAP[milestoneCode] || milestoneCode;

    // Match by PE project ID first (most reliable since we just wrote these)
    let dealId: string | null = peIdMap.get(peProjectId.toLowerCase()) || null;

    if (!dealId) {
      // Name match fallback
      const custNorm = normalize(customerName);
      for (const [dn, dList] of nameMap) {
        if (dn.includes(custNorm) && dList.length === 1) {
          dealId = dList[0].id;
          break;
        }
      }
    }

    if (!dealId) {
      unmatched++;
      continue;
    }

    matched++;
    for (let i = 0; i < 15; i++) {
      const code = docCodes[i] || "K";
      ops.push({
        dealId,
        docName: DOC_NAMES[i],
        status: STATUS_MAP[code] || "NOT_UPLOADED",
        notes: `PE Portal ${peProjectId} | ${milestone} | Synced 2026-05-11`,
      });
    }
  }

  console.log(`✅ Matched: ${matched} / ${lines.length}`);
  console.log(`❌ Unmatched: ${unmatched}`);
  console.log(`📊 Total upsert ops: ${ops.length}`);

  if (!EXECUTE) {
    console.log(`\n⚠️  DRY RUN — add --execute to write ${ops.length} doc statuses to DB`);
    return;
  }

  // 5. Connect to DB and upsert
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL not set");
    process.exit(1);
  }

  console.log(`\n📝 Connecting to DB and writing ${ops.length} doc statuses...\n`);

  const sql = neon(dbUrl);
  const now = new Date().toISOString();
  let upserted = 0;
  let errors = 0;

  // Process in batches of 50 (neon serverless has per-query limits)
  const BATCH = 50;
  for (let i = 0; i < ops.length; i += BATCH) {
    const batch = ops.slice(i, i + BATCH);

    // Build multi-value INSERT ... ON CONFLICT UPDATE
    const values: string[] = [];
    const params: any[] = [];

    for (let j = 0; j < batch.length; j++) {
      const op = batch[j];
      const offset = j * 5;
      values.push(`(gen_random_uuid(), $${offset + 1}, $${offset + 2}, $${offset + 3}::"PeDocStatus", $${offset + 4}, $${offset + 5}, '${now}'::timestamp, '${now}'::timestamp, '${now}'::timestamp)`);
      params.push(op.dealId, op.docName, op.status, op.notes, "pe-portal-scrape-2026-05-11");
    }

    const query = `
      INSERT INTO "PeDocumentReview" (id, "dealId", "docName", status, notes, "reviewedBy", "reviewedAt", "createdAt", "updatedAt")
      VALUES ${values.join(", ")}
      ON CONFLICT ("dealId", "docName") DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        "reviewedBy" = EXCLUDED."reviewedBy",
        "reviewedAt" = EXCLUDED."reviewedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    try {
      await sql.query(query, params);
      upserted += batch.length;
    } catch (err: any) {
      errors += batch.length;
      console.error(`   ❌ Batch error: ${err.message}`);
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= ops.length) {
      console.log(`   Progress: ${Math.min(i + BATCH, ops.length)}/${ops.length}`);
    }
  }

  console.log(`\n✅ Done! Upserted: ${upserted}, Errors: ${errors}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
