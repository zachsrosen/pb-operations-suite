/**
 * One-off: ensure User rows exist for the project managers named in
 * `Deal.projectManager` so PM Flag assignment routes correctly.
 *
 * As of 2026-04-29, only 2 of the 4 active PMs (Alexis Severson and
 * Katlyyn Arnoldi) have User records with the PROJECT_MANAGER role.
 * The other two (Kaitlyn Martinez, Natasha Wooten-Sanford) are referenced
 * by `Deal.projectManager` but have no matching User → flags fall through
 * to round-robin and land on Alexis or Katlyyn.
 *
 * This script upserts User records for the missing two with the
 * PROJECT_MANAGER role. Edit the EMAILS map below if the email addresses
 * differ from what's expected.
 *
 * Run: npx tsx scripts/seed-pm-users.ts            (dry-run by default)
 *      npx tsx scripts/seed-pm-users.ts --apply    (actually write)
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TARGETS = [
  { name: "Kaitlyn Martinez", email: "kaitlyn@photonbrothers.com" },
  { name: "Natasha Wooten-Sanford", email: "natasha@photonbrothers.com" },
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) console.log("DRY RUN — pass --apply to actually write.\n");

  for (const t of TARGETS) {
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: t.email }, { name: t.name }] },
      select: { id: true, email: true, name: true, roles: true },
    });

    if (existing) {
      const hasRole = existing.roles.includes("PROJECT_MANAGER");
      console.log(
        `Existing user matched for "${t.name}": ${existing.email} (name="${existing.name}") roles=[${existing.roles.join(",")}]`
      );
      if (hasRole) {
        console.log(`  → already has PROJECT_MANAGER, no change.`);
      } else {
        console.log(`  → would add PROJECT_MANAGER role`);
        if (apply) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { roles: { set: [...existing.roles, "PROJECT_MANAGER"] } },
          });
          console.log(`     APPLIED.`);
        }
      }
      // Also ensure name matches Deal.projectManager exactly for lookup parity.
      if (existing.name !== t.name) {
        console.log(`  → would update name from "${existing.name}" to "${t.name}" (for Deal.projectManager match)`);
        if (apply) {
          await prisma.user.update({ where: { id: existing.id }, data: { name: t.name } });
          console.log(`     APPLIED.`);
        }
      }
    } else {
      console.log(`No existing user for "${t.name}" — would CREATE with email ${t.email}`);
      if (apply) {
        await prisma.user.create({
          data: {
            email: t.email,
            name: t.name,
            roles: ["PROJECT_MANAGER"],
          },
        });
        console.log(`     APPLIED.`);
      }
    }
    console.log("");
  }

  if (!apply) console.log("Re-run with --apply to write the changes.");
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
