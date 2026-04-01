import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

prisma.projectReview.findMany({
  where: { skill: 'site-survey-readiness' },
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: { id: true, dealId: true, skill: true, status: true, error: true, createdAt: true, passed: true, errorCount: true, warningCount: true }
}).then(rows => {
  console.log(JSON.stringify(rows, null, 2));
  return prisma.$disconnect();
}).catch(e => { console.error(e); prisma.$disconnect(); });
