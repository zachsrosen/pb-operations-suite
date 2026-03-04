import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const p = new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
  });
  try {
    const users = await p.user.findMany({
      where: { OR: [{ email: { contains: "zach" } }, { role: "ADMIN" }] },
      select: { email: true, name: true, role: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    console.log(JSON.stringify(users, null, 2));
  } finally {
    await p.$disconnect();
  }
}
main();
