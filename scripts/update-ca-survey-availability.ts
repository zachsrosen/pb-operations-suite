/**
 * One-shot: update CA site-survey availability for Lucas + Nick Scarpellino.
 *
 * Per 2026-04-21 spec (docs/superpowers/plans/…):
 *   SLO:       Lucas Mon/Fri 08:00-10:00  (slots: 8-9, 9-10)
 *              Nick  Tue/Thu 13:00-15:00  (slots: 1-2, 2-3)
 *   Camarillo: Lucas Mon     09:00-11:00  (slots: 9-10, 10-11)
 *              Nick  Wed     09:00-12:00  (slots: 9-10, 10-11, 11-12)
 *
 * Cross-office blocking (Lucas Mondays) is handled at the availability-route level.
 *
 * Run: set -a && source .env && set +a && npx tsx scripts/update-ca-survey-availability.ts
 * Prod: same, but with .env pointing at prod DATABASE_URL and ZUPER_API_KEY.
 */
import { prisma } from "../src/lib/db";
import { ZuperClient } from "../src/lib/zuper";

const LUCAS_NAME = "Lucas Scarpellino";
const NICK_NAME = "Nick Scarpellino";
const CA_LOCATIONS = ["San Luis Obispo", "SLO", "Camarillo"];

type ShiftSpec = {
  crewName: string;
  location: "San Luis Obispo" | "Camarillo";
  dayOfWeek: number; // 0=Sun..6=Sat
  startTime: string; // HH:mm
  endTime: string; // HH:mm
};

const NEW_SHIFTS: ShiftSpec[] = [
  // Lucas — SLO Mon/Fri 8-10 (generates 8-9, 9-10)
  { crewName: LUCAS_NAME, location: "San Luis Obispo", dayOfWeek: 1, startTime: "08:00", endTime: "10:00" },
  { crewName: LUCAS_NAME, location: "San Luis Obispo", dayOfWeek: 5, startTime: "08:00", endTime: "10:00" },
  // Lucas — Camarillo Mon 9-11 (generates 9-10, 10-11)
  { crewName: LUCAS_NAME, location: "Camarillo", dayOfWeek: 1, startTime: "09:00", endTime: "11:00" },
  // Nick — SLO Tue/Thu 13-15 (generates 1-2, 2-3)
  { crewName: NICK_NAME, location: "San Luis Obispo", dayOfWeek: 2, startTime: "13:00", endTime: "15:00" },
  { crewName: NICK_NAME, location: "San Luis Obispo", dayOfWeek: 4, startTime: "13:00", endTime: "15:00" },
  // Nick — Camarillo Wed 9-12 (generates 9-10, 10-11, 11-12)
  { crewName: NICK_NAME, location: "Camarillo", dayOfWeek: 3, startTime: "09:00", endTime: "12:00" },
];

async function main() {
  if (!prisma) throw new Error("prisma not configured");
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No writes will be made.\n");

  // 1. Resolve Lucas's Zuper UID and upsert CrewMember.
  const zuper = new ZuperClient();
  const lucasResolved = await zuper.resolveUserUid(LUCAS_NAME);
  if (!lucasResolved) throw new Error(`Could not resolve Zuper UID for ${LUCAS_NAME}`);
  console.log(`Resolved ${LUCAS_NAME}: userUid=${lucasResolved.userUid} teamUid=${lucasResolved.teamUid}`);

  let lucas = await prisma.crewMember.findUnique({ where: { name: LUCAS_NAME } });
  if (!lucas) {
    console.log(`Creating CrewMember "${LUCAS_NAME}"…`);
    if (!dryRun) {
      lucas = await prisma.crewMember.create({
        data: {
          name: LUCAS_NAME,
          zuperUserUid: lucasResolved.userUid,
          zuperTeamUid: lucasResolved.teamUid ?? null,
          role: "surveyor",
          locations: ["San Luis Obispo", "Camarillo"],
          isActive: true,
          maxDailyJobs: 4,
        },
      });
    }
  } else {
    console.log(`CrewMember "${LUCAS_NAME}" exists (id=${lucas.id}). Ensuring UID + CA locations…`);
    if (!dryRun) {
      const mergedLocations = Array.from(new Set([...(lucas.locations ?? []), "San Luis Obispo", "Camarillo"]));
      lucas = await prisma.crewMember.update({
        where: { id: lucas.id },
        data: {
          zuperUserUid: lucasResolved.userUid,
          zuperTeamUid: lucasResolved.teamUid ?? lucas.zuperTeamUid,
          locations: mergedLocations,
          isActive: true,
        },
      });
    }
  }

  // 2. Confirm Nick exists (we're only replacing his rows, not creating him).
  const nick = await prisma.crewMember.findUnique({ where: { name: NICK_NAME } });
  if (!nick) throw new Error(`CrewMember "${NICK_NAME}" not found — aborting.`);
  console.log(`Found CrewMember "${NICK_NAME}" (id=${nick.id}).`);

  // 3. Wipe existing CA survey availability rows for both.
  const crewIds = [lucas!.id, nick.id];
  const existing = await prisma.crewAvailability.findMany({
    where: {
      crewMemberId: { in: crewIds },
      location: { in: CA_LOCATIONS },
      jobType: "survey",
    },
  });
  console.log(`\nExisting CA survey availability rows to delete: ${existing.length}`);
  for (const row of existing) {
    console.log(
      `  - ${row.crewMemberId === lucas!.id ? "Lucas" : "Nick"}  ${row.location}  day=${row.dayOfWeek}  ${row.startTime}-${row.endTime}`
    );
  }
  if (!dryRun && existing.length > 0) {
    const del = await prisma.crewAvailability.deleteMany({
      where: {
        crewMemberId: { in: crewIds },
        location: { in: CA_LOCATIONS },
        jobType: "survey",
      },
    });
    console.log(`Deleted ${del.count} row(s).`);
  }

  // 4. Insert new rows.
  console.log(`\nInserting ${NEW_SHIFTS.length} new shift(s):`);
  for (const s of NEW_SHIFTS) {
    const crewMemberId = s.crewName === LUCAS_NAME ? lucas!.id : nick.id;
    console.log(`  + ${s.crewName}  ${s.location}  day=${s.dayOfWeek}  ${s.startTime}-${s.endTime}`);
    if (!dryRun) {
      await prisma.crewAvailability.create({
        data: {
          crewMemberId,
          location: s.location,
          reportLocation: s.location,
          jobType: "survey",
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          timezone: "America/Los_Angeles",
          isActive: true,
        },
      });
    }
  }

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
