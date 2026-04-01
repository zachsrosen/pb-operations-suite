/**
 * Audit users for location backfill readiness.
 * Cross-references OPERATIONS users against compliance team overrides.
 * Run: source .env.local && DATABASE_URL="$DATABASE_URL" npx tsx scripts/_user-audit.ts
 */
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

async function main() {
  const users = await p.user.findMany({
    select: { name: true, email: true, role: true, allowedLocations: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  console.log("Role | Name | Locations");
  console.log("---|---|---");
  users.forEach((u) =>
    console.log(
      `${u.role} | ${u.name || "?"} | ${u.allowedLocations.length ? u.allowedLocations.join(", ") : "(none)"}`
    )
  );
  console.log("---");
  console.log("Total users:", users.length);

  const scoped = users.filter(
    (u) => u.role === "OPERATIONS" || u.role === "VIEWER" || u.role === "SALES"
  );
  console.log("\nScoped roles (OPERATIONS/VIEWER/SALES):", scoped.length);
  const noLoc = scoped.filter((u) => u.allowedLocations.length === 0);
  console.log("  Without locations:", noLoc.length);
  if (noLoc.length > 0) {
    console.log("\n  Need backfill:");
    noLoc.forEach((u) => console.log(`    ${u.role} | ${u.name || "?"} | ${u.email}`));
  }

  await p.$disconnect();
}

main();
