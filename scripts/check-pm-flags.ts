/**
 * One-off diagnostic: count PM flags + show non-PII slice.
 * Run: npx tsx scripts/check-pm-flags.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const total = await prisma.pmFlag.count();
  console.log(`TOTAL FLAGS: ${total}`);

  if (total === 0) {
    console.log("(no flags raised yet)");
    return;
  }

  const byStatus = await prisma.pmFlag.groupBy({ by: ["status"], _count: { _all: true } });
  const bySource = await prisma.pmFlag.groupBy({ by: ["source"], _count: { _all: true } });
  const bySeverity = await prisma.pmFlag.groupBy({ by: ["severity"], _count: { _all: true } });
  const byType = await prisma.pmFlag.groupBy({ by: ["type"], _count: { _all: true } });

  console.log("BY STATUS:  ", byStatus.map(b => `${b.status}=${b._count._all}`).join(", "));
  console.log("BY SOURCE:  ", bySource.map(b => `${b.source}=${b._count._all}`).join(", "));
  console.log("BY SEVERITY:", bySeverity.map(b => `${b.severity}=${b._count._all}`).join(", "));
  console.log("BY TYPE:    ", byType.map(b => `${b.type}=${b._count._all}`).join(", "));

  // Per-assignee load (no name/email — IDs only)
  const byAssignee = await prisma.pmFlag.groupBy({
    by: ["assignedToUserId"],
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    _count: { _all: true },
  });
  console.log("OPEN+ACK BY ASSIGNEE:", byAssignee.map(b => `${b.assignedToUserId ?? "(unassigned)"}=${b._count._all}`).join(", "));

  // Most recent (id + timestamps + status only — NO dealName, NO reason)
  const recent = await prisma.pmFlag.findMany({
    orderBy: { raisedAt: "desc" },
    take: 5,
    select: { id: true, type: true, severity: true, status: true, source: true, raisedAt: true, assignedToUserId: true },
  });
  console.log("RECENT 5 (no PII):", recent);

  // PM pool size
  const pmCount = await prisma.user.count({ where: { roles: { has: "PROJECT_MANAGER" } } });
  console.log(`ELIGIBLE PMs (roles contains PROJECT_MANAGER): ${pmCount}`);
}

main()
  .catch(err => {
    console.error("ERROR:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
