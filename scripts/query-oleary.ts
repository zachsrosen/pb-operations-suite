import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const count = await prisma.zuperJobCache.count();
  console.log('Total cached jobs:', count);

  const byName = await prisma.zuperJobCache.findMany({
    where: { projectName: { contains: 'oleary', mode: 'insensitive' } },
  });
  console.log('\nJobs matching "oleary" by projectName:', byName.length);
  for (const j of byName) {
    console.log(JSON.stringify({
      uid: j.jobUid, title: j.jobTitle, dealId: j.hubspotDealId,
      status: j.jobStatus, category: j.jobCategory, project: j.projectName,
    }));
  }

  // Also check by customer address containing oleary
  const byAddr = await prisma.zuperJobCache.findMany({
    where: { customerAddress: { path: ['street'], string_contains: 'oleary' } },
  });
  console.log('\nJobs matching "oleary" in address:', byAddr.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
