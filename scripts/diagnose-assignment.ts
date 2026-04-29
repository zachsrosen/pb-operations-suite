/**
 * Diagnose why flags are being assigned to the wrong PM.
 *
 * For each active OPEN/ACK flag (source=ADMIN_WORKFLOW), prints:
 *  - hubspotDealId
 *  - Deal.projectManager (raw from HubSpot mirror)
 *  - Deal.hubspotOwnerId
 *  - Resolved User from Deal.projectManager → User.name lookup
 *  - Currently-assigned User on the flag
 *  - Whether they match
 *
 * Run: npx tsx scripts/diagnose-assignment.ts [partialDealId]
 *   - Optional partial dealId to filter (substring match)
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const filter = process.argv[2]?.toLowerCase() ?? null;

  // Build user name → id map.
  const users = await prisma.user.findMany({
    where: { name: { not: null } },
    select: { id: true, name: true, email: true, roles: true, hubspotOwnerId: true },
  });
  const usersByName = new Map(users.map(u => [normalize(u.name ?? ""), u]));
  const usersById = new Map(users.map(u => [u.id, u]));
  console.log(`Indexed ${users.length} users with names.`);
  console.log(`Users with PROJECT_MANAGER role: ${users.filter(u => u.roles.includes("PROJECT_MANAGER")).length}`);
  console.log("PM list:");
  for (const u of users.filter(u => u.roles.includes("PROJECT_MANAGER"))) {
    console.log(`  ${u.name?.padEnd(30)} ${u.email}`);
  }
  console.log("");

  // Pull active flags.
  const flags = await prisma.pmFlag.findMany({
    where: {
      source: "ADMIN_WORKFLOW",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      ...(filter ? { hubspotDealId: { contains: filter } } : {}),
    },
    select: {
      id: true,
      hubspotDealId: true,
      type: true,
      assignedToUserId: true,
      raisedAt: true,
    },
    orderBy: { raisedAt: "desc" },
  });

  if (flags.length === 0) {
    console.log("No active ADMIN_WORKFLOW flags found.");
    await prisma.$disconnect();
    return;
  }

  // Look up deals.
  const dealIds = [...new Set(flags.map(f => f.hubspotDealId))];
  const deals = await prisma.deal.findMany({
    where: { hubspotDealId: { in: dealIds } },
    select: {
      hubspotDealId: true,
      dealName: true,
      projectManager: true,
      hubspotOwnerId: true,
      dealOwnerName: true,
      stage: true,
    },
  });
  const dealsById = new Map(deals.map(d => [d.hubspotDealId, d]));

  console.log(`=== ${flags.length} active flags ===`);
  console.log("");

  // Group by deal for clarity.
  const flagsByDeal = new Map<string, typeof flags>();
  for (const f of flags) {
    const arr = flagsByDeal.get(f.hubspotDealId) ?? [];
    arr.push(f);
    flagsByDeal.set(f.hubspotDealId, arr);
  }

  for (const [dealId, dealFlags] of flagsByDeal) {
    const d = dealsById.get(dealId);
    if (!d) {
      console.log(`Deal ${dealId} — NOT IN MIRROR (flags: ${dealFlags.length})`);
      continue;
    }

    const pmName = d.projectManager;
    const pmNorm = pmName ? normalize(pmName) : null;
    const resolvedUser = pmNorm ? usersByName.get(pmNorm) : null;

    console.log(`Deal ${dealId} — "${d.dealName}" — stage="${d.stage}"`);
    console.log(`  Deal.projectManager: ${JSON.stringify(pmName)}`);
    console.log(`  Deal.dealOwnerName:  ${JSON.stringify(d.dealOwnerName)}`);
    console.log(`  Deal.hubspotOwnerId: ${JSON.stringify(d.hubspotOwnerId)}`);
    if (pmName) {
      console.log(`  → resolved User:    ${resolvedUser ? `${resolvedUser.name} (${resolvedUser.email})` : "NO MATCH"}`);
    } else {
      console.log(`  → resolved User:    (no PM set on deal)`);
    }

    for (const f of dealFlags) {
      const assignee = f.assignedToUserId ? usersById.get(f.assignedToUserId) : null;
      const correct =
        resolvedUser?.id === f.assignedToUserId
          ? "✓ MATCHES"
          : (resolvedUser ? "✗ MISMATCH" : "(round-robin)");
      console.log(
        `    flag ${f.id.slice(-8)} type=${f.type.padEnd(20)} → ${(assignee?.name ?? "(unassigned)").padEnd(28)} ${correct}`
      );
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
