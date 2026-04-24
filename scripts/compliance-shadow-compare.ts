/**
 * One-shot: compute v1 and v2 compliance scores for the last 30 days,
 * write both into ComplianceScoreShadow. Diffs are analyzed manually
 * from the DB (or via lucas-compliance-diff.ts).
 *
 * Run via: npx tsx scripts/compliance-shadow-compare.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import { computeLocationCompliance } from "../src/lib/compliance-compute";
import { computeLocationComplianceV2 } from "../src/lib/compliance-v2/scoring";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];
const CATEGORIES = ["Site Survey", "Construction", "Inspection"];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  const windowDays = 30;

  for (const location of LOCATIONS) {
    for (const category of CATEGORIES) {
      console.log(`\nComputing ${location} / ${category}...`);

      // Force v1 (explicitly set the env var)
      const origFlag = process.env.COMPLIANCE_V2_ENABLED;
      delete process.env.COMPLIANCE_V2_ENABLED;
      const v1 = await computeLocationCompliance(category, location, windowDays);
      if (origFlag !== undefined) process.env.COMPLIANCE_V2_ENABLED = origFlag;

      // v2 (bypass flag by calling directly)
      const v2 = await computeLocationComplianceV2(category, location, windowDays);

      if (!v1 || !v2) {
        console.log(`  skipping (no data)`);
        continue;
      }

      // Match v1 and v2 employees — prefer userUid (only present on v1 rows
      // that came through the v2 adapter), fall back to name match. Also
      // flush v2-only employees so we capture techs who appear in v2 but
      // not v1 (e.g. form-filer-only).
      const v2ByUid = new Map(v2.byEmployee.map((e) => [e.userUid, e]));
      const v2ByName = new Map(v2.byEmployee.map((e) => [e.name, e]));
      const writtenUids = new Set<string>();

      let written = 0;

      // 1. v1 × v2 matches
      for (const v1e of v1.byEmployee) {
        const v2e =
          (v1e.userUid && v2ByUid.get(v1e.userUid)) ||
          v2ByName.get(v1e.name);
        if (!v2e) continue;

        await prisma.complianceScoreShadow.create({
          data: {
            userUid: v2e.userUid,
            userName: v1e.name,
            location,
            category,
            windowDays,
            v1Score: v1e.complianceScore,
            v1Grade: v1e.grade,
            v2Score: v2e.complianceScore,
            v2Grade: v2e.grade,
            v1TotalJobs: v1e.totalJobs,
            v2TasksFractional: v2e.tasksFractional,
            v2DistinctParentJobs: v2e.distinctParentJobs,
            emptyCreditSetJobs: v2.emptyCreditSetJobs,
          },
        });
        written++;
        writtenUids.add(v2e.userUid);
      }

      // 2. v2-only employees (v1 had 0 for this person — likely form-filer-only)
      for (const v2e of v2.byEmployee) {
        if (writtenUids.has(v2e.userUid)) continue;
        await prisma.complianceScoreShadow.create({
          data: {
            userUid: v2e.userUid,
            userName: v2e.name,
            location,
            category,
            windowDays,
            v1Score: 0,
            v1Grade: "—",
            v2Score: v2e.complianceScore,
            v2Grade: v2e.grade,
            v1TotalJobs: 0,
            v2TasksFractional: v2e.tasksFractional,
            v2DistinctParentJobs: v2e.distinctParentJobs,
            emptyCreditSetJobs: v2.emptyCreditSetJobs,
          },
        });
        written++;
      }

      console.log(`  wrote ${written} rows (v1: ${v1.byEmployee.length}, v2: ${v2.byEmployee.length})`);
    }
  }

  await prisma.$disconnect();
  console.log("\nDone. Query with: SELECT * FROM \"ComplianceScoreShadow\" ORDER BY ABS(\"v2Score\" - \"v1Score\") DESC LIMIT 30;");
}
main().catch((e) => { console.error(e); process.exit(1); });
