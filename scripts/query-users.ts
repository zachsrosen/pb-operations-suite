import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const p = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});
async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true, name: true, role: true }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const u of users) {
    console.log(`${(u.email || "?").padEnd(45)} role=${String(u.role).padEnd(20)} name=${u.name}`);
  }
  await p.$disconnect();
}
main();
