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

      // Match v1 and v2 employees by userUid where possible, or by name
      const v2ByUid = new Map(v2.byEmployee.map((e) => [e.userUid, e]));

      for (const v1e of v1.byEmployee) {
        // v1 doesn't track userUid on EmployeeCompliance (it's by name only), so we approximate by name
        const v2e = [...v2ByUid.values()].find((x) => x.name === v1e.name);
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
      }
      console.log(`  wrote ${v1.byEmployee.length} rows`);
    }
  }

  await prisma.$disconnect();
  console.log("\nDone. Query with: SELECT * FROM \"ComplianceScoreShadow\" ORDER BY ABS(\"v2Score\" - \"v1Score\") DESC LIMIT 30;");
}
main().catch((e) => { console.error(e); process.exit(1); });
