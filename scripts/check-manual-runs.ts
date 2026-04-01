import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const runs = await prisma.bomPipelineRun.findMany({
    where: { trigger: "MANUAL", createdAt: { gte: new Date("2026-03-19T00:00:00Z") } },
    select: { id: true, dealId: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Found ${runs.length} MANUAL runs today:`);
  for (const r of runs) {
    console.log(`  ${r.dealId} — ${r.status} (${r.createdAt.toISOString()}) [${r.id}]`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
