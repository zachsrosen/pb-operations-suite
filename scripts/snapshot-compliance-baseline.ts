/**
 * ONE-SHOT: snapshot today's v1 compliance scores to a markdown file.
 * Runs BEFORE any Chunk 1.1+ changes land, so the baseline is immutable.
 *
 * Output: docs/superpowers/analyses/<today>-compliance-baseline.md
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import { computeLocationCompliance } from "../src/lib/compliance-compute";
import fs from "node:fs";
import path from "node:path";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];
const CATEGORIES = ["Site Survey", "Construction", "Inspection"];

async function main() {
  // Ensure v1 path (should be default but be explicit)
  delete process.env.COMPLIANCE_V2_ENABLED;

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const windowDays = 30;
  const rows: string[] = [
    `# Compliance v1 baseline — ${new Date().toISOString().split("T")[0]}`,
    ``,
    `**Captured:** ${new Date().toISOString()}`,
    `**Window:** last ${windowDays} days`,
    `**Flag state:** COMPLIANCE_V2_ENABLED is off (v1 path)`,
    ``,
    `| Location | Category | Employee | Grade | Score | On-time% | Jobs | Stuck | NS |`,
    `|---|---|---|---|---|---|---|---|---|`,
  ];

  for (const location of LOCATIONS) {
    for (const category of CATEGORIES) {
      try {
        const result = await computeLocationCompliance(category, location, windowDays);
        if (!result) continue;
        for (const e of result.byEmployee) {
          rows.push(
            `| ${location} | ${category} | ${e.name} | ${e.grade} | ${e.complianceScore} | ${e.onTimePercent} | ${e.totalJobs} | ${e.stuckCount} | ${e.neverStartedCount} |`
          );
        }
      } catch (err) {
        console.error(`Failed ${location}/${category}:`, err);
      }
    }
  }

  rows.push(``, `## Raw JSON`, ``, "```json", JSON.stringify({ capturedAt: new Date().toISOString(), windowDays }, null, 2), "```");

  const outDir = path.join(process.cwd(), "docs/superpowers/analyses");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const outFile = path.join(outDir, `${today}-compliance-baseline.md`);
  fs.writeFileSync(outFile, rows.join("\n"));
  console.log(`Wrote ${outFile}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
