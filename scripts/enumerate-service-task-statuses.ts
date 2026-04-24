/**
 * Enumerate distinct service_task_status values from Zuper, 90-day window.
 * Read-only. Output used to populate task-level status bucket sets in
 * src/lib/compliance-v2/status-buckets.ts.
 *
 * BUCKET CLASSIFICATION (reviewed <date — populate after running script>):
 *   COMPLETED: COMPLETED (add others if observed)
 *   STUCK: IN_PROGRESS, STARTED (add others)
 *   NEVER_STARTED: NEW, SCHEDULED (add others)
 *   EXCLUDED: CANCELLED, SKIPPED (add others)
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

async function main() {
  const apiKey = process.env.ZUPER_API_KEY!;
  const baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const jobs = await prisma.zuperJobCache.findMany({
    where: { lastSyncedAt: { gte: since } },
    select: { jobUid: true, jobCategory: true },
    take: 300,
  });

  const byStatus = new Map<string, number>();
  const byCatStatus = new Map<string, Map<string, number>>();
  for (const j of jobs) {
    try {
      const r = await fetch(`${baseUrl}/service_tasks?filter.module_uid=${encodeURIComponent(j.jobUid)}`, { headers: { "x-api-key": apiKey } });
      if (!r.ok) continue;
      const body = await r.json();
      const tasks = (body?.data ?? body?.service_tasks ?? body ?? []) as Array<{ service_task_status?: string }>;
      for (const t of tasks) {
        const s = (t.service_task_status ?? "(null)").trim();
        byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
        if (!byCatStatus.has(j.jobCategory)) byCatStatus.set(j.jobCategory, new Map());
        const m = byCatStatus.get(j.jobCategory)!;
        m.set(s, (m.get(s) ?? 0) + 1);
      }
    } catch { /* skip */ }
  }

  console.log(`Sampled ${jobs.length} jobs`);
  console.log("\n=== All service task statuses ===");
  for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${s}`);
  }
  for (const [cat, m] of [...byCatStatus.entries()].sort()) {
    console.log(`\n=== ${cat} ===`);
    for (const [s, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${s}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
