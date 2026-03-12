/**
 * Deactivate crew availability for a specific crew member.
 *
 * Usage:
 *   source .env && npm run crew:deactivate -- --name "Derek Pomar" --apply
 *   source .env && npm run crew:deactivate -- --name "Derek Pomar" --apply --deactivate-member
 *
 * Defaults to dry-run mode unless --apply is passed.
 * Use --deactivate-member to also set CrewMember.isActive = false.
 */

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";

type Options = {
  name?: string;
  apply: boolean;
  deactivateMember: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apply: false,
    deactivateMember: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--deactivate-member") {
      options.deactivateMember = true;
      continue;
    }

    if (arg === "--name") {
      options.name = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

async function main() {
  const { name, apply, deactivateMember } = parseArgs(process.argv.slice(2));

  if (!name) {
    console.error('Usage: source .env && npm run crew:deactivate -- --name "Derek Pomar" [--apply] [--deactivate-member]');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Run: source .env && npm run crew:deactivate -- --name \"Derek Pomar\" --apply");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });

  try {
    const crewMember = await prisma.crewMember.findUnique({
      where: { name },
      include: {
        availabilities: {
          orderBy: [{ location: "asc" }, { dayOfWeek: "asc" }, { startTime: "asc" }],
        },
      },
    });

    if (!crewMember) {
      console.error(`Crew member not found: ${name}`);
      process.exit(1);
    }

    const activeAvailabilities = crewMember.availabilities.filter((availability) => availability.isActive);

    console.log(`Crew member: ${crewMember.name}`);
    console.log(`Crew member active: ${crewMember.isActive}`);
    console.log(`Active availability rows: ${activeAvailabilities.length}`);

    for (const availability of activeAvailabilities) {
      console.log(
        ` - ${availability.jobType} | ${availability.location} | day=${availability.dayOfWeek} | ${availability.startTime}-${availability.endTime}`,
      );
    }

    if (!apply) {
      console.log("Dry run only. Re-run with --apply to deactivate these availability rows.");
      if (!crewMember.isActive && deactivateMember) {
        console.log("Crew member record is already inactive.");
      }
      return;
    }

    const updatedAvailabilities = await prisma.crewAvailability.updateMany({
      where: {
        crewMemberId: crewMember.id,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    let crewMemberUpdated = false;
    if (deactivateMember && crewMember.isActive) {
      await prisma.crewMember.update({
        where: { id: crewMember.id },
        data: { isActive: false },
      });
      crewMemberUpdated = true;
    }

    console.log(`Deactivated availability rows: ${updatedAvailabilities.count}`);
    console.log(`Crew member deactivated: ${crewMemberUpdated ? "yes" : "no"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to deactivate crew member:", error);
  process.exit(1);
});
