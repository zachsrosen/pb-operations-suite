/**
 * Enumerate distinct service_task_title values from Zuper across the last
 * 90 days, grouped by parent job_category. Output: a table the operator
 * uses to populate TASK_TITLE_CLASSIFICATION.
 *
 * Read-only (reads from DB + Zuper API). Safe to re-run.
 *
 * CLASSIFICATION (reviewed <date — populate after running script>):
 *   WORK: PV Install - Colorado, PV Install - California, Electrical Install - Colorado,
 *         Electrical Install - California, Loose Ends
 *   PAPERWORK: JHA Form, Xcel PTO, Participate Energy Photos
 *   UNKNOWN (needs human review): <any others surfaced by the enumeration>
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

async function main() {
  const apiKey = process.env.ZUPER_API_KEY;
  const baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  if (!apiKey) { console.error("ZUPER_API_KEY not set"); process.exit(1); }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Pull all Construction + Additional Visit + Service Visit + Service Revisit jobs
  // (other categories don't have service tasks worth scoring per spec §2.1)
  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      lastSyncedAt: { gte: since },
      jobCategory: { in: ["Construction", "Additional Visit", "Service Visit", "Service Revisit", "Site Survey", "Inspection"] },
    },
    select: { jobUid: true, jobCategory: true },
    take: 300, // sample, not exhaustive — enough to see all title variants
  });

  const byTitle = new Map<string, number>();
  const byCatTitle = new Map<string, Map<string, number>>();

  for (const j of jobs) {
    const url = `${baseUrl}/service_tasks?filter.module_uid=${encodeURIComponent(j.jobUid)}`;
    try {
      const r = await fetch(url, { headers: { "x-api-key": apiKey } });
      if (!r.ok) continue;
      const body = await r.json();
      const tasks = (body?.data ?? body?.service_tasks ?? body ?? []) as Array<{ service_task_title?: string }>;
      for (const t of tasks) {
        const title = (t.service_task_title ?? "(null)").trim();
        byTitle.set(title, (byTitle.get(title) ?? 0) + 1);
        if (!byCatTitle.has(j.jobCategory)) byCatTitle.set(j.jobCategory, new Map());
        const m = byCatTitle.get(j.jobCategory)!;
        m.set(title, (m.get(title) ?? 0) + 1);
      }
    } catch {
      // skip individual job failures
    }
  }

  console.log(`Sampled ${jobs.length} jobs\n`);
  console.log("=== All service task titles (overall) ===");
  for (const [title, n] of [...byTitle.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${title}`);
  }
  for (const [cat, m] of [...byCatTitle.entries()].sort()) {
    console.log(`\n=== ${cat} ===`);
    for (const [title, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${title}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
