import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

async function main() {
  await prisma.sopSuggestion.deleteMany();
  await prisma.sopRevision.deleteMany();
  await prisma.sopSection.deleteMany();
  await prisma.sopTab.deleteMany();
  console.log("Cleared all SOP tables");
  await prisma.$disconnect();
}
main();
