import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  // Find ALL projects with "Scott" in the name
  const scottProjects = await prisma.scheduleRecord.findMany({
    where: {
      projectName: { contains: "scott", mode: "insensitive" },
      scheduleType: "survey",
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("=== Survey ScheduleRecords with 'Scott' in project name ===");
  console.log("Count:", scottProjects.length);
  for (const r of scottProjects) {
    console.log(JSON.stringify({
      projectId: r.projectId,
      projectName: r.projectName,
      assignedUser: r.assignedUser,
      status: r.status,
      scheduledDate: r.scheduledDate,
      zuperJobUid: r.zuperJobUid,
      createdAt: r.createdAt,
    }, null, 2));
    console.log("---");
  }

  // Find any records assigned to Sammy De Mauro
  console.log("\n=== ScheduleRecords assigned to Sammy ===");
  const sammyRecords = await prisma.scheduleRecord.findMany({
    where: { assignedUser: { contains: "sammy", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  console.log("Count:", sammyRecords.length);
  for (const r of sammyRecords) {
    console.log(JSON.stringify({
      projectId: r.projectId,
      projectName: r.projectName,
      scheduleType: r.scheduleType,
      assignedUser: r.assignedUser,
      status: r.status,
      scheduledDate: r.scheduledDate,
      zuperJobUid: r.zuperJobUid,
      createdAt: r.createdAt,
    }, null, 2));
    console.log("---");
  }

  await prisma.$disconnect();
}
main();
