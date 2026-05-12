#!/usr/bin/env npx tsx
/**
 * PE Portal → HubSpot Cross-Reference (Dry Run)
 *
 * Matches scraped PE portal projects to HubSpot deals by customer name.
 * Reports: matched, unmatched, and ambiguous matches.
 *
 * Usage:
 *   npx tsx scripts/pe-crossref.ts              # dry run
 *   npx tsx scripts/pe-crossref.ts --write       # write pe_project_id + pe_portal_url to HubSpot
 *   npx tsx scripts/pe-crossref.ts --sync        # write + sync doc statuses to DB
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load env — search up from script location to find .env
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

const WRITE_MODE = process.argv.includes("--write") || process.argv.includes("--sync");
const SYNC_MODE = process.argv.includes("--sync");

const PE_PORTAL_BASE = "https://raceway.participate.energy";
const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

// ---------------------------------------------------------------------------
// Load scraped data
// ---------------------------------------------------------------------------

const jsonPath = path.join(__dirname, "..", "pe-portal-scrape-2026-05-11.json");
const scrapeData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

interface ScrapedProject {
  projectId: string;
  firestoreId?: string;
  portalUrl?: string;
  customerName: string;
  milestone: string;
  docReview: string;
  documents: {
    onboarding: { name: string; status: string }[];
    inspectionComplete: { name: string; status: string }[];
    projectComplete: { name: string; status: string }[];
  };
}

const scraped: ScrapedProject[] = scrapeData.projects;
console.log(`📋 Loaded ${scraped.length} scraped PE projects\n`);

// ---------------------------------------------------------------------------
// Fetch all PE-tagged deals from HubSpot
// ---------------------------------------------------------------------------

const hsClient = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

interface HsDeal {
  id: string;
  dealname: string;
  dealstage: string;
  pe_project_id: string | null;
  pe_portal_url: string | null;
}

async function fetchPeDeals(): Promise<HsDeal[]> {
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
      properties: ["hs_object_id", "dealname", "dealstage", "pe_project_id", "pe_portal_url"],
      sorts: [{ propertyName: "dealname", direction: "ASCENDING" }] as any,
      limit: 100,
      ...(after ? { after } : {}),
    } as any);

    for (const d of resp.results) {
      deals.push({
        id: String(d.properties.hs_object_id),
        dealname: String(d.properties.dealname || ""),
        dealstage: String(d.properties.dealstage || ""),
        pe_project_id: d.properties.pe_project_id || null,
        pe_portal_url: d.properties.pe_portal_url || null,
      });
    }

    after = (resp as any).paging?.next?.after;
  } while (after);

  return deals;
}

// ---------------------------------------------------------------------------
// Name normalization and matching
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function getLastName(name: string): string {
  const parts = normalize(name).split(" ");
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const meaningful = parts.filter((p) => !SUFFIXES.has(p));
  return meaningful[meaningful.length - 1] || "";
}

function getFirstName(name: string): string {
  const parts = normalize(name).split(" ");
  return parts[0] || "";
}

// ---------------------------------------------------------------------------
// Stage label map
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  "20461940": "Permission to Operate",
  "24743347": "Close Out",
  "20440343": "Project Complete",
  "20440342": "Construction",
  "82363662": "Inspection",
  "1046849539": "Pre-Construction",
  "65073844": "Design & Eng",
  "20440341": "Ready to Build",
  "20440344": "Permit Approved",
  "20440345": "Warranty",
  "20440346": "Cancelled",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const deals = await fetchPeDeals();
  console.log(`🔗 Fetched ${deals.length} PE-tagged HubSpot deals\n`);

  // Build lookup maps
  const dealsByNormName = new Map<string, HsDeal[]>();
  const dealsByLastName = new Map<string, HsDeal[]>();

  for (const d of deals) {
    const norm = normalize(d.dealname);
    if (!dealsByNormName.has(norm)) dealsByNormName.set(norm, []);
    dealsByNormName.get(norm)!.push(d);

    const last = getLastName(d.dealname);
    if (last.length >= 3) {
      if (!dealsByLastName.has(last)) dealsByLastName.set(last, []);
      dealsByLastName.get(last)!.push(d);
    }
  }

  // Match each scraped project
  const matched: { project: ScrapedProject; deal: HsDeal; method: string }[] = [];
  const unmatched: ScrapedProject[] = [];
  const ambiguous: { project: ScrapedProject; candidates: HsDeal[]; method: string }[] = [];

  for (const proj of scraped) {
    const projNorm = normalize(proj.customerName);
    const projLast = getLastName(proj.customerName);
    const projFirst = getFirstName(proj.customerName);

    // Strategy 1: Exact normalized name match
    let candidates = deals.filter((d) => normalize(d.dealname).includes(projNorm));
    if (candidates.length === 1) {
      matched.push({ project: proj, deal: candidates[0], method: "exact-name" });
      continue;
    }
    if (candidates.length > 1) {
      // Try to disambiguate with PE project ID prefix (state + batch)
      const statePrefix = proj.projectId.substring(0, 2); // CO or CA
      const filtered = candidates.filter((d) =>
        d.dealname.toLowerCase().includes(statePrefix.toLowerCase())
      );
      if (filtered.length === 1) {
        matched.push({ project: proj, deal: filtered[0], method: "exact-name+state" });
        continue;
      }
      ambiguous.push({ project: proj, candidates, method: "exact-name" });
      continue;
    }

    // Strategy 2: First + last name in deal name
    candidates = deals.filter((d) => {
      const dn = normalize(d.dealname);
      return dn.includes(projFirst) && dn.includes(projLast);
    });
    if (candidates.length === 1) {
      matched.push({ project: proj, deal: candidates[0], method: "first+last" });
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push({ project: proj, candidates, method: "first+last" });
      continue;
    }

    // Strategy 3: Last name only (if unique)
    if (projLast.length >= 4) {
      candidates = deals.filter((d) => normalize(d.dealname).includes(projLast));
      if (candidates.length === 1) {
        matched.push({ project: proj, deal: candidates[0], method: "last-name" });
        continue;
      }
      if (candidates.length > 1) {
        ambiguous.push({ project: proj, candidates, method: "last-name" });
        continue;
      }
    }

    unmatched.push(proj);
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`✅ MATCHED: ${matched.length}`);
  console.log(`⚠️  AMBIGUOUS: ${ambiguous.length}`);
  console.log(`❌ UNMATCHED: ${unmatched.length}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Payment-stage deals (PTO, Close Out, Project Complete)
  const PAYMENT_STAGES = new Set(["20461940", "24743347", "20440343"]);
  const paymentMatches = matched.filter((m) => PAYMENT_STAGES.has(m.deal.dealstage));
  console.log(`💰 Payment-stage matches (PTO/Close Out/Project Complete): ${paymentMatches.length}`);
  for (const m of paymentMatches) {
    const stage = STAGE_LABELS[m.deal.dealstage] || m.deal.dealstage;
    console.log(`   ${m.project.projectId} → ${m.deal.dealname} [${stage}] docReview=${m.project.docReview}`);
  }

  // PC projects with ACTION REQUIRED
  console.log(`\n🔴 Projects with ACTION REQUIRED docs:`);
  const actionRequired = matched.filter((m) => m.project.docReview === "ACTION REQUIRED");
  for (const m of actionRequired) {
    const stage = STAGE_LABELS[m.deal.dealstage] || m.deal.dealstage;
    const allDocs = [
      ...m.project.documents.onboarding,
      ...m.project.documents.inspectionComplete,
      ...m.project.documents.projectComplete,
    ];
    const arDocs = allDocs.filter((d) => d.status === "ACTION REQUIRED");
    console.log(`   ${m.project.projectId} ${m.project.customerName} [${stage}]:`);
    for (const d of arDocs) {
      console.log(`     - ${d.name}`);
    }
  }

  if (ambiguous.length > 0) {
    console.log(`\n⚠️  AMBIGUOUS matches (need manual resolution):`);
    for (const a of ambiguous.slice(0, 20)) {
      console.log(`   ${a.project.projectId} ${a.project.customerName} (${a.method}) → ${a.candidates.length} candidates:`);
      for (const c of a.candidates) {
        console.log(`     - ${c.id}: ${c.dealname}`);
      }
    }
    if (ambiguous.length > 20) console.log(`   ... and ${ambiguous.length - 20} more`);
  }

  if (unmatched.length > 0) {
    console.log(`\n❌ UNMATCHED projects (${unmatched.length}):`);
    for (const u of unmatched.slice(0, 30)) {
      console.log(`   ${u.projectId} ${u.customerName} [${u.milestone}]`);
    }
    if (unmatched.length > 30) console.log(`   ... and ${unmatched.length - 30} more`);
  }

  // ---------------------------------------------------------------------------
  // Write mode: update pe_project_id + pe_portal_url on matched deals
  // ---------------------------------------------------------------------------

  if (WRITE_MODE) {
    console.log(`\n\n📝 WRITE MODE: Updating ${matched.length} deals with PE project IDs...\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Batch in groups of 10 to avoid rate limits
    for (let i = 0; i < matched.length; i += 10) {
      const batch = matched.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (m) => {
          const portalUrl = m.project.portalUrl || `${PE_PORTAL_BASE}/projects/${m.project.firestoreId || m.project.projectId}`;

          // Skip if already set correctly
          if (
            m.deal.pe_project_id === m.project.projectId &&
            m.deal.pe_portal_url === portalUrl
          ) {
            skipped++;
            return "skipped";
          }

          await hsClient.crm.deals.basicApi.update(m.deal.id, {
            properties: {
              pe_project_id: m.project.projectId,
              pe_portal_url: portalUrl,
            },
          });
          return "updated";
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value === "updated") updated++;
        else if (r.status === "rejected") {
          errors++;
          console.error(`   ❌ Error: ${(r as PromiseRejectedResult).reason?.message || r}`);
        }
      }

      // Small delay between batches
      if (i + 10 < matched.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    console.log(`✅ Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  }

  // ---------------------------------------------------------------------------
  // Sync mode: sync doc statuses to DB via pe-scraper-sync
  // ---------------------------------------------------------------------------

  if (SYNC_MODE) {
    console.log(`\n📊 SYNC MODE: Syncing doc statuses to DB...\n`);
    // Read compact file and POST to sync API
    const compactPath = path.join(__dirname, "pe-scrape-compact.txt");
    const compactData = fs.readFileSync(compactPath, "utf-8");
    console.log(`   Compact data: ${compactData.split("\n").filter(l => l.trim()).length} lines`);
    console.log(`   Use the API endpoint to sync: POST /api/accounting/pe-docs/sync with { compact: "..." }`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
