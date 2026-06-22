import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { writeFileSync } from "fs";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  const tabs = await prisma.sopTab.findMany({ select: { id: true, label: true, sortOrder: true } });
  const sections = await prisma.sopSection.findMany({
    select: { id: true, tabId: true, sidebarGroup: true, title: true, content: true, updatedAt: true },
    orderBy: [{ tabId: "asc" }, { sortOrder: "asc" }],
  });
  writeFileSync("data/hubspot-flows/sop-sections.json", JSON.stringify({ tabs, sections }, null, 1));
  console.log("tabs:", tabs.length, "sections:", sections.length);
  console.log("tab ids:", tabs.map((t) => t.id).join(", "));
  console.log("workflow-ish sections:", sections.filter((s) => /workflow|wf-|flow/i.test(s.id + s.sidebarGroup + s.title)).map((s) => s.id).join(", ") || "(none)");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
