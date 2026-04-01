/**
 * Standalone script: look up the current HubSpot deal stage for every
 * project number in the Zuper/HubSpot status-comparison CSV.
 *
 * Usage:  npx tsx scripts/_mismatch-deal-stages.ts
 */

import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error("Missing HUBSPOT_ACCESS_TOKEN in .env");
  process.exit(1);
}

const CSV_PATH = path.resolve(
  process.env.HOME!,
  "Downloads/zuper-status-comparison (3).csv"
);

// ---------------------------------------------------------------------------
// 1. Read CSV → unique project numbers
// ---------------------------------------------------------------------------
function readProjectNumbers(): string[] {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n").slice(1); // skip header
  const numbers: string[] = [];
  for (const line of lines) {
    const first = line.split(",")[0]?.trim();
    if (first && /^PROJ-\d+$/.test(first)) {
      numbers.push(first);
    }
  }
  return [...new Set(numbers)];
}

// ---------------------------------------------------------------------------
// 2. HubSpot helpers
// ---------------------------------------------------------------------------
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function hubspotFetch(url: string, body?: object): Promise<any> {
  const opts: RequestInit = {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      console.log(`  Rate limited, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot ${res.status}: ${text}`);
    }
    return res.json();
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// 3. Fetch all pipeline stages → { pipelineId → { stageId → label } }
//    Also build pipelineId → pipelineName
// ---------------------------------------------------------------------------
interface StageInfo {
  stageMap: Record<string, Record<string, string>>; // pipelineId → stageId → label
  pipelineNames: Record<string, string>; // pipelineId → pipeline label
}

async function fetchAllPipelineStages(): Promise<StageInfo> {
  const data = await hubspotFetch(
    "https://api.hubapi.com/crm/v3/pipelines/deals"
  );
  const stageMap: Record<string, Record<string, string>> = {};
  const pipelineNames: Record<string, string> = {};

  for (const pipeline of data.results || []) {
    pipelineNames[pipeline.id] = pipeline.label;
    const stages: Record<string, string> = {};
    for (const stage of pipeline.stages || []) {
      stages[stage.id] = stage.label;
    }
    stageMap[pipeline.id] = stages;
  }
  return { stageMap, pipelineNames };
}

// ---------------------------------------------------------------------------
// 4. Search deals by project_number (batch of up to 3 at a time with IN)
// ---------------------------------------------------------------------------
interface DealResult {
  projectNumber: string;
  dealId: string;
  dealName: string;
  pipeline: string;
  pipelineName: string;
  dealstage: string;
  stageName: string;
}

async function searchDealsByProjectNumbers(
  projectNumbers: string[],
  stageInfo: StageInfo
): Promise<Map<string, DealResult>> {
  const results = new Map<string, DealResult>();

  // HubSpot search supports up to 3 values in an IN filter per call,
  // but it's more reliable to search one at a time for EQ.
  // We'll batch with individual EQ searches — 10 per second is the limit.
  // Use batches of 5 with a small delay between.
  const batchSize = 5;

  for (let i = 0; i < projectNumbers.length; i += batchSize) {
    const batch = projectNumbers.slice(i, i + batchSize);

    const promises = batch.map(async (projNum) => {
      const body = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "project_number",
                operator: "EQ",
                value: projNum,
              },
            ],
          },
        ],
        properties: ["dealname", "dealstage", "pipeline", "project_number"],
        limit: 1,
      };

      try {
        const data = await hubspotFetch(
          "https://api.hubapi.com/crm/v3/objects/deals/search",
          body
        );
        if (data.results && data.results.length > 0) {
          const deal = data.results[0];
          const pipelineId = deal.properties.pipeline || "";
          const stageId = deal.properties.dealstage || "";
          const pipelineName =
            stageInfo.pipelineNames[pipelineId] || pipelineId;
          const stageName =
            stageInfo.stageMap[pipelineId]?.[stageId] || stageId;

          results.set(projNum, {
            projectNumber: projNum,
            dealId: deal.id,
            dealName: deal.properties.dealname || "",
            pipeline: pipelineId,
            pipelineName,
            dealstage: stageId,
            stageName,
          });
        }
      } catch (err) {
        console.error(`  Error searching for ${projNum}:`, err);
      }
    });

    await Promise.all(promises);

    // Small delay between batches to respect rate limits
    if (i + batchSize < projectNumbers.length) {
      await sleep(300);
    }

    // Progress indicator
    const done = Math.min(i + batchSize, projectNumbers.length);
    process.stdout.write(`\r  Searched ${done}/${projectNumbers.length} deals`);
  }
  console.log(); // newline after progress

  return results;
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("Reading CSV...");
  const projectNumbers = readProjectNumbers();
  console.log(`  Found ${projectNumbers.length} unique project numbers\n`);

  console.log("Fetching pipeline stages from HubSpot...");
  const stageInfo = await fetchAllPipelineStages();
  const pipelineCount = Object.keys(stageInfo.pipelineNames).length;
  console.log(`  Loaded ${pipelineCount} pipelines\n`);

  console.log("Searching HubSpot for deals...");
  const dealMap = await searchDealsByProjectNumbers(projectNumbers, stageInfo);

  // Build output table
  console.log(
    `\nResults: ${dealMap.size} found, ${projectNumbers.length - dealMap.size} not found\n`
  );

  // Header
  const colW = { proj: 12, stage: 38, pipeline: 22 };
  const header = [
    "Project #".padEnd(colW.proj),
    "Deal Stage".padEnd(colW.stage),
    "Pipeline".padEnd(colW.pipeline),
  ].join(" | ");
  const sep = [
    "-".repeat(colW.proj),
    "-".repeat(colW.stage),
    "-".repeat(colW.pipeline),
  ].join("-+-");

  console.log(header);
  console.log(sep);

  // Print found deals
  for (const projNum of projectNumbers) {
    const deal = dealMap.get(projNum);
    if (deal) {
      console.log(
        [
          deal.projectNumber.padEnd(colW.proj),
          deal.stageName.padEnd(colW.stage),
          deal.pipelineName.padEnd(colW.pipeline),
        ].join(" | ")
      );
    } else {
      console.log(
        [
          projNum.padEnd(colW.proj),
          "(not found in HubSpot)".padEnd(colW.stage),
          "-".padEnd(colW.pipeline),
        ].join(" | ")
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
