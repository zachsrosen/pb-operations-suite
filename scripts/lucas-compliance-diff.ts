/**
 * Generates docs/superpowers/analyses/<date>-lucas-compliance-diff.md from
 * ComplianceScoreShadow rows. Pass criteria from spec §8.4.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const CA_LOCATIONS = new Set(["San Luis Obispo", "Camarillo"]);

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const since = new Date();
  since.setDate(since.getDate() - 2); // latest shadow rows
  const rows = await prisma.complianceScoreShadow.findMany({
    where: { computedAt: { gte: since } },
    orderBy: { computedAt: "desc" },
  });

  const ca = rows.filter((r) => CA_LOCATIONS.has(r.location));
  const lucas = ca.find((r) => r.userName.toLowerCase().includes("lucas"));
  const caDrops = ca.filter((r) => r.v2Score < r.v1Score - 10);
  const caConstruction = ca.filter((r) => r.category === "Construction");
  const totalCaConstructionWork = caConstruction.reduce((s, r) => s + r.v2TasksFractional, 0);
  void totalCaConstructionWork;
  const emptyRate = caConstruction.length > 0
    ? caConstruction.reduce((s, r) => s + r.emptyCreditSetJobs, 0) / Math.max(1, caConstruction.length)
    : 0;

  const criteria = [
    { id: 1, name: "Lucas's v2 ≥ v1", pass: lucas ? lucas.v2Score >= lucas.v1Score : false },
    { id: 2, name: "No CA tech drops >10 points", pass: caDrops.length === 0 },
    { id: 3, name: "CA empty-credit-set rate <20%", pass: emptyRate < 0.20 },
  ];
  const allPass = criteria.every((c) => c.pass);

  const md = [
    `# Lucas Scarpellino compliance v1 vs v2 sanity-check`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Source:** ComplianceScoreShadow (last 2 days)`,
    ``,
    `## Pass criteria (spec §8.4)`,
    ``,
    ...criteria.map((c) => `- ${c.pass ? "✅" : "❌"} Criterion ${c.id}: ${c.name}`),
    ``,
    `**Overall:** ${allPass ? "✅ UNBLOCKED for flag flip" : "❌ BLOCKED pending investigation"}`,
    ``,
    `## Lucas detail`,
    ``,
    lucas
      ? `| Location | Category | v1 | v2 | Δ | Tasks (v2) |\n|---|---|---|---|---|---|\n| ${lucas.location} | ${lucas.category} | ${lucas.v1Score} | ${lucas.v2Score} | ${(lucas.v2Score - lucas.v1Score).toFixed(1)} | ${lucas.v2TasksFractional.toFixed(1)} |`
      : `No Lucas row found in shadow table.`,
    ``,
    `## California crew >10 point drops`,
    ``,
    caDrops.length > 0
      ? caDrops.map((r) => `- ${r.userName} (${r.location}/${r.category}): ${r.v1Score} → ${r.v2Score}`).join("\n")
      : `(none)`,
    ``,
    `## Raw CA rows`,
    ``,
    `| Name | Location | Category | v1 | v2 | Tasks (v2) | Empty credit jobs |`,
    `|---|---|---|---|---|---|---|`,
    ...ca.map((r) => `| ${r.userName} | ${r.location} | ${r.category} | ${r.v1Score} | ${r.v2Score} | ${r.v2TasksFractional.toFixed(1)} | ${r.emptyCreditSetJobs} |`),
  ].join("\n");

  const outDir = path.join(process.cwd(), "docs/superpowers/analyses");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const outFile = path.join(outDir, `${today}-lucas-compliance-diff.md`);
  fs.writeFileSync(outFile, md);
  console.log(`Wrote ${outFile}`);
  console.log(`Result: ${allPass ? "PASS" : "FAIL"}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
