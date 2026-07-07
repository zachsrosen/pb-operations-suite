/**
 * One-time backfill: fill blank CrewMember.zuperUserUid by matching the
 * crew member's email against Zuper's user list.
 *
 * Why: rows with a blank UID break assignee-scoped queries — the
 * availability-conflict scan used `contains: ""` and matched every survey
 * (7/7 incident: a Colorado Springs day-off alerted on Westminster
 * surveys). The query is fixed in code; this repairs the data so conflict
 * alerts fire for the RIGHT surveys again.
 *
 * Dry-run (default):
 *     npx tsx scripts/_backfill-crew-zuper-uids.ts
 * Apply:
 *     npx tsx scripts/_backfill-crew-zuper-uids.ts --apply
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const APPLY = process.argv.includes("--apply");
const API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const API_KEY = process.env.ZUPER_API_KEY;

type ZuperUser = { user_uid: string; email?: string; first_name?: string; last_name?: string };

async function fetchAllZuperUsers(): Promise<ZuperUser[]> {
  const users: ZuperUser[] = [];
  // Zuper ignores `count` here and returns 10/page — stop only on an
  // empty page, not a short one.
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${API_URL}/user/all?page=${page}&count=50`, {
      headers: { "x-api-key": API_KEY! },
    });
    if (!res.ok) throw new Error(`Zuper /user/all HTTP ${res.status}`);
    const data = await res.json();
    const batch: ZuperUser[] = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.data?.users)
        ? data.data.users
        : [];
    if (batch.length === 0) break;
    users.push(...batch);
  }
  return users;
}

async function main() {
  if (!API_KEY) {
    console.error("ZUPER_API_KEY is not set");
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });

  const blank = (
    await prisma.crewMember.findMany({
      select: { id: true, name: true, email: true, zuperUserUid: true, isActive: true },
    })
  ).filter((c) => !(c.zuperUserUid || "").trim());

  console.log(`CrewMembers with blank zuperUserUid: ${blank.length} (${APPLY ? "APPLY" : "dry-run"})`);
  if (blank.length === 0) return;

  const zuperUsers = await fetchAllZuperUsers();
  const byEmail = new Map(
    zuperUsers.filter((u) => u.email).map((u) => [u.email!.trim().toLowerCase(), u]),
  );

  let updated = 0;
  for (const crew of blank) {
    const email = (crew.email || "").trim().toLowerCase();
    const match = email ? byEmail.get(email) : undefined;
    if (!match) {
      console.log(`  SKIP ${crew.name} (${crew.email || "no email"}) — no Zuper user match`);
      continue;
    }
    console.log(`  ${APPLY ? "SET " : "would set"} ${crew.name} → ${match.user_uid} (${match.first_name} ${match.last_name})`);
    if (APPLY) {
      await prisma.crewMember.update({
        where: { id: crew.id },
        data: { zuperUserUid: match.user_uid },
      });
      updated++;
    }
  }
  console.log(APPLY ? `Updated ${updated}/${blank.length}.` : "Dry run complete. Re-run with --apply.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
