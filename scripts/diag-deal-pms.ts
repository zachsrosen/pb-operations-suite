import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TERMINAL = ["Closed Won","Closed Lost","Cancelled","Cancelled Project","On Hold","On-Hold","PTO Complete","Project Complete"];

async function main() {
  // Active PROJECT-pipeline deals — what's in projectManager / dealOwnerName?
  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: TERMINAL } },
    select: { hubspotDealId: true, dealName: true, stage: true, projectManager: true, dealOwnerName: true, hubspotOwnerId: true },
  });
  console.log(`=== ${deals.length} active PROJECT deals ===`);
  for (const d of deals) {
    console.log(`  ${d.hubspotDealId.padEnd(14)} stage=${d.stage.padEnd(28)} PM=${(d.projectManager ?? "(null)").padEnd(20)} dealOwner=${d.dealOwnerName ?? "(null)"}`);
  }
  console.log("\n=== Distinct projectManager values ===");
  const grouped = new Map<string, number>();
  for (const d of deals) {
    const k = d.projectManager ?? "(null)";
    grouped.set(k, (grouped.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...grouped.entries()].sort((a,b) => b[1]-a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${k}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
