/**
 * Grant /admin/freshservice + /api/admin/freshservice to specified users
 * via `extraAllowedRoutes`. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/_grant-freshservice-access.ts <email> [<email>...]
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const ROUTES = ["/admin/freshservice", "/api/admin/freshservice"];

async function main() {
  const emails = process.argv.slice(2).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error("Usage: tsx scripts/_grant-freshservice-access.ts <email> [<email>...]");
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        console.warn(`[skip] No user with email ${email}`);
        continue;
      }
      const existing = new Set(user.extraAllowedRoutes ?? []);
      const before = existing.size;
      for (const r of ROUTES) existing.add(r);
      if (existing.size === before) {
        console.log(`[ok] ${email} already has access — nothing to change.`);
        continue;
      }
      await prisma.user.update({
        where: { email },
        data: { extraAllowedRoutes: Array.from(existing) },
      });
      console.log(`[grant] ${email} -> ${ROUTES.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
