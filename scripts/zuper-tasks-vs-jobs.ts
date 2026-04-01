/**
 * Find Zuper jobs where all service tasks are completed but the job is NOT.
 *
 * Queries the Zuper API for:
 *  1. All service tasks (paginated)
 *  2. Groups them by parent job
 *  3. Checks if every task in a job is in a completed status
 *  4. Cross-references with the job's own status
 *  5. Reports mismatches (all tasks done, job still open)
 *
 * Run:
 *   source .env.local && npx tsx scripts/zuper-tasks-vs-jobs.ts
 */

const API_KEY = process.env.ZUPER_API_KEY;
const BASE_URL =
  process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

if (!API_KEY) {
  console.error("ZUPER_API_KEY is required");
  process.exit(1);
}

// --- Status classification ---

const JOB_COMPLETED_STATUSES = new Set([
  "completed",
  "construction complete",
  "passed",
  "partial pass",
  "failed",
]);

// Service task status values (from Zuper: COMPLETED, NEW, IN_PROGRESS, etc.)
const TASK_COMPLETED_STATUSES = new Set([
  "completed",
  "done",
  "closed",
  "passed",
  "failed",
]);

// --- API helpers ---

interface ZuperResponse<T> {
  type: string;
  data: T;
  total_records?: number;
}

async function zuperGet<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<ZuperResponse<T>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
    },
  });
  if (!res.ok) {
    throw new Error(`Zuper ${endpoint} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Fetch all service tasks (paginated) ---

interface ServiceTask {
  service_task_uid: string;
  service_task_title?: string;
  service_task_status?: string; // "COMPLETED", "NEW", "IN_PROGRESS", etc.
  module?: string; // "JOB"
  module_uid?: string; // The parent job UID
  sequence_no?: number;
  inspection_form?: { asset_form_name?: string };
  assigned_to?: { user?: { first_name?: string; last_name?: string } }[];
  [key: string]: unknown;
}

async function fetchAllServiceTasks(): Promise<ServiceTask[]> {
  const allTasks: ServiceTask[] = [];
  let page = 1;
  const perPage = 100;

  console.log("Fetching service tasks from Zuper...");

  while (true) {
    const resp = await zuperGet<ServiceTask[]>("/service_tasks", {
      page: String(page),
      count: String(perPage),
      sort: "DESC",
    });

    const tasks = Array.isArray(resp.data) ? resp.data : [];
    allTasks.push(...tasks);

    const total = resp.total_records ?? 0;
    console.log(
      `  Page ${page}: ${tasks.length} tasks (${allTasks.length}/${total} total)`
    );

    if (tasks.length < perPage || allTasks.length >= total) break;
    page++;
  }

  return allTasks;
}

// --- Fetch job details for a set of job UIDs ---

interface JobDetail {
  job_uid: string;
  job_title: string;
  current_job_status?: {
    status_name?: string;
    status_uid?: string;
  };
  job_category?: { category_name?: string };
  scheduled_start_time?: string;
  customer?: { first_name?: string; last_name?: string; company_name?: string };
  assigned_to?: { user?: { first_name?: string; last_name?: string } }[];
}

async function fetchJobDetail(jobUid: string): Promise<JobDetail | null> {
  try {
    const resp = await zuperGet<JobDetail>(`/jobs/${jobUid}`);
    return resp.data || null;
  } catch (e) {
    console.warn(`  Could not fetch job ${jobUid}: ${e}`);
    return null;
  }
}

// --- Main ---

async function main() {
  // 1. Fetch all service tasks
  const tasks = await fetchAllServiceTasks();
  console.log(`\nTotal service tasks fetched: ${tasks.length}`);

  if (tasks.length === 0) {
    console.log("No service tasks found.");
    return;
  }

  // Debug: task status distribution
  const statusCounts = new Map<string, number>();
  for (const t of tasks) {
    const s = t.service_task_status || "(no status)";
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
  }
  console.log("\n--- Task status distribution ---");
  for (const [status, count] of statusCounts) {
    console.log(`  ${status}: ${count}`);
  }

  // Debug: module distribution
  const moduleCounts = new Map<string, number>();
  for (const t of tasks) {
    const key = `${t.module || "?"}:${t.module_uid || "?"}`;
    moduleCounts.set(key, (moduleCounts.get(key) || 0) + 1);
  }
  console.log("\n--- Tasks by parent job ---");
  for (const [key, count] of moduleCounts) {
    console.log(`  ${key}: ${count} tasks`);
  }

  // 2. Group tasks by parent job (module_uid when module === "JOB")
  const tasksByJob = new Map<
    string,
    { tasks: ServiceTask[] }
  >();

  for (const task of tasks) {
    const jobUid =
      task.module === "JOB" ? task.module_uid : (task as any).job_uid;
    if (!jobUid) continue; // standalone task, not job-linked

    if (!tasksByJob.has(jobUid)) {
      tasksByJob.set(jobUid, { tasks: [] });
    }
    tasksByJob.get(jobUid)!.tasks.push(task);
  }

  console.log(`\nJobs with service tasks: ${tasksByJob.size}`);

  // 3. Find jobs where ALL tasks are completed
  const allTasksCompleted: { jobUid: string; tasks: ServiceTask[] }[] = [];

  for (const [jobUid, entry] of tasksByJob) {
    const allDone = entry.tasks.every((t) => {
      const statusName = (t.service_task_status || "").toLowerCase();
      return TASK_COMPLETED_STATUSES.has(statusName);
    });

    if (allDone) {
      allTasksCompleted.push({ jobUid, tasks: entry.tasks });
    }
  }

  console.log(`Jobs where ALL tasks are completed: ${allTasksCompleted.length}`);

  // 4. Check each of those jobs' own status
  console.log("\nChecking job statuses for mismatches...\n");
  const mismatches: {
    jobUid: string;
    jobTitle: string;
    jobStatus: string;
    category: string;
    taskCount: number;
    assignedTo: string;
    customer: string;
    scheduledStart: string;
  }[] = [];

  for (const entry of allTasksCompleted) {
    const job = await fetchJobDetail(entry.jobUid);
    if (!job) continue;

    const jobStatus = (
      job.current_job_status?.status_name || ""
    ).toLowerCase();

    if (!JOB_COMPLETED_STATUSES.has(jobStatus)) {
      const assigned = (job.assigned_to || [])
        .map((a: any) =>
          a.user
            ? `${a.user.first_name || ""} ${a.user.last_name || ""}`.trim()
            : "?"
        )
        .join(", ");
      const customer = job.customer
        ? `${job.customer.first_name || ""} ${job.customer.last_name || ""}`.trim() ||
          job.customer.company_name || ""
        : "";

      mismatches.push({
        jobUid: entry.jobUid,
        jobTitle: job.job_title || "(unknown)",
        jobStatus: job.current_job_status?.status_name || "(unknown)",
        category: (job.job_category as any)?.category_name || "",
        taskCount: entry.tasks.length,
        assignedTo: assigned || "(unassigned)",
        customer,
        scheduledStart: job.scheduled_start_time
          ? new Date(job.scheduled_start_time).toLocaleDateString()
          : "",
      });
    }

    // Rate-limit courtesy
    await new Promise((r) => setTimeout(r, 100));
  }

  // 5. Report
  console.log("=".repeat(80));
  console.log(
    `MISMATCHES: ${mismatches.length} jobs have ALL tasks completed but job NOT completed`
  );
  console.log("=".repeat(80));

  if (mismatches.length === 0) {
    console.log("\nNo mismatches found — all jobs with completed tasks are also completed.");
    return;
  }

  // Table output
  console.log(
    "\nJob Title | Job Status | Category | Tasks | Assigned | Customer | Scheduled"
  );
  console.log("-".repeat(100));
  for (const m of mismatches) {
    console.log(
      `${m.jobTitle} | ${m.jobStatus} | ${m.category} | ${m.taskCount} | ${m.assignedTo} | ${m.customer} | ${m.scheduledStart}`
    );
  }

  // Also output job URLs
  const webBase = BASE_URL.replace("/api", "");
  console.log("\n--- Zuper Links ---");
  for (const m of mismatches) {
    console.log(`${m.jobTitle}: ${webBase}/jobs/${m.jobUid}/details`);
  }

  console.log(`\nTotal mismatches: ${mismatches.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
