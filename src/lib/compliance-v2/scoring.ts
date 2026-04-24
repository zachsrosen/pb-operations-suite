/**
 * computeLocationComplianceV2 — per-service-task compliance scoring.
 *
 * Spec: docs/superpowers/specs/2026-04-23-compliance-score-fairness-design.md
 *
 * Flow per parent job:
 *   1. Classify parent status → bucket.
 *   2. If bucket = "excluded" → skip job entirely.
 *   3. Fetch service tasks + form submissions.
 *   4. For each task whose title is a Work task:
 *      a. Compute credit set (§2.2). If empty → increment emptyCreditSetJobs and skip.
 *      b. Resolve timestamp (§2.3 earliest-of).
 *      c. For each tech in credit set, accumulate 1/N weighted metrics.
 */
import {
  computeCreditSet,
} from "./credit-set";
import { resolveTaskTimestamp } from "./task-timestamp";
import { classifyJobStatus, classifyTaskStatus } from "./status-buckets";
import { isScoredTaskTitle } from "./task-classification";
import {
  createServiceTasksFetcher,
  type ServiceTasksFetcher,
} from "./service-tasks-fetcher";
import {
  type EmployeeComplianceV2,
  type LocationComplianceV2Result,
  type TaskCreditEntry,
  MIN_TASKS_THRESHOLD,
} from "./types";
import { fetchJobsForCategory, getCompletedTimeFromHistory, getStatusName, GRACE_MS } from "@/lib/compliance-helpers";
import { JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { computeGrade } from "@/lib/compliance-helpers";

const CATEGORY_NAME_TO_UID: Record<string, string> = {
  "Site Survey": JOB_CATEGORY_UIDS.SITE_SURVEY,
  Construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
  Inspection: JOB_CATEGORY_UIDS.INSPECTION,
};

export interface ComputeV2Options {
  /** Injection point for tests — defaults to production fetcher factory. */
  createFetcher?: () => ServiceTasksFetcher;
}

interface Accumulator {
  userUid: string;
  name: string;
  tasksFractional: number;
  distinctParentJobs: Set<string>;
  onTimeCount: number;
  lateCount: number;
  stuckCount: number;
  neverStartedCount: number;
  failedCount: number;
  hasFollowUp: boolean;
  entries: TaskCreditEntry[];
}

function ensureAcc(acc: Map<string, Accumulator>, userUid: string, name: string): Accumulator {
  let a = acc.get(userUid);
  if (!a) {
    a = {
      userUid,
      name,
      tasksFractional: 0,
      distinctParentJobs: new Set(),
      onTimeCount: 0,
      lateCount: 0,
      stuckCount: 0,
      neverStartedCount: 0,
      failedCount: 0,
      hasFollowUp: false,
      entries: [],
    };
    acc.set(userUid, a);
  }
  return a;
}

export async function computeLocationComplianceV2(
  categoryName: string,
  location: string,
  days: number = 30,
  options: ComputeV2Options = {}
): Promise<LocationComplianceV2Result | null> {
  void location;
  const categoryUid = CATEGORY_NAME_TO_UID[categoryName];
  if (!categoryUid) return null;

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  const fromDateStr = fromDate.toISOString().split("T")[0];
  const toDateStr = now.toISOString().split("T")[0];

  const jobs = await fetchJobsForCategory(categoryUid, fromDateStr, toDateStr);
  if (jobs.length === 0) return null;

  const fetcher = (options.createFetcher ?? createServiceTasksFetcher)();
  const acc = new Map<string, Accumulator>();
  let emptyCreditSetJobs = 0;

  for (const job of jobs) {
    const parentStatus = getStatusName(job);
    const parentBucket = classifyJobStatus(parentStatus);
    if (parentBucket === "excluded") continue;

    const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
    const parentCompletedTime = getCompletedTimeFromHistory(job);

    const bundle = await fetcher.fetchBundle(job.job_uid);
    if (!bundle) continue;

    for (const task of bundle.tasks) {
      if (!isScoredTaskTitle(task.service_task_title)) continue;

      const form = bundle.formByTaskUid.get(task.service_task_uid) ?? null;
      const creditSet = computeCreditSet({ task, form });

      if (creditSet.userUids.length === 0) {
        emptyCreditSetJobs++;
        continue;
      }

      const timestamp = resolveTaskTimestamp({
        actualEndTime: task.actual_end_time ?? null,
        formCreatedAt: form?.created_at ?? null,
        parentCompletedTime: parentCompletedTime ? parentCompletedTime.toISOString() : null,
      });

      // Compute metrics for this task×parent combination
      const weight = 1 / creditSet.userUids.length;
      const taskBucket = classifyTaskStatus(task.service_task_status);
      const isCompleted = parentBucket === "completed-full" || parentBucket === "completed-follow-up" || parentBucket === "completed-failed" || taskBucket === "completed-full";
      const isStuck = parentBucket === "stuck" && taskBucket !== "completed-full";
      const isNeverStarted = parentBucket === "never-started" && !task.actual_start_time;
      const isFailed = parentBucket === "completed-failed";
      const isFollowUp = parentBucket === "completed-follow-up";

      let onTime: boolean | null = null;
      if (isCompleted && scheduledEnd && timestamp) {
        const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
        onTime = timestamp.getTime() <= deadline.getTime();
      } else if (isCompleted && !scheduledEnd) {
        onTime = true; // no schedule target: count as on-time (consistent with v1 behavior)
      }

      for (const uid of creditSet.userUids) {
        const name = creditSet.nameByUid.get(uid) ?? "Unknown";
        const a = ensureAcc(acc, uid, name);
        a.tasksFractional += weight;
        a.distinctParentJobs.add(job.job_uid);

        if (isCompleted && onTime === true) a.onTimeCount += weight;
        if (isCompleted && onTime === false) a.lateCount += weight;
        if (isStuck) a.stuckCount += weight;
        if (isNeverStarted) a.neverStartedCount += weight;
        if (isFailed) a.failedCount += weight;
        if (isFollowUp) a.hasFollowUp = true;

        a.entries.push({
          jobUid: job.job_uid,
          jobTitle: job.job_title ?? "",
          taskUid: task.service_task_uid,
          taskTitle: task.service_task_title,
          bucket: parentBucket,
          weight,
          timestamp: timestamp ? timestamp.toISOString() : null,
          scheduledEnd: scheduledEnd ? scheduledEnd.toISOString() : null,
          onTime,
          stuck: isStuck,
          neverStarted: isNeverStarted,
          failed: isFailed,
          followUp: isFollowUp,
        });
      }
    }
  }

  // Fold accumulators into EmployeeComplianceV2
  const byEmployee: EmployeeComplianceV2[] = [];
  for (const a of acc.values()) {
    const measurable = a.onTimeCount + a.lateCount;
    const onTimePercent = measurable > 0 ? Math.round((a.onTimeCount / measurable) * 100) : -1;
    const stuckRate = a.tasksFractional > 0 ? a.stuckCount / a.tasksFractional : 0;
    const neverStartedRate = a.tasksFractional > 0 ? a.neverStartedCount / a.tasksFractional : 0;
    const rawOnTime = onTimePercent >= 0 ? onTimePercent : 0;
    const complianceScore = Math.max(
      0,
      Math.round((rawOnTime - stuckRate * 100 - neverStartedRate * 100) * 10) / 10
    );
    // Pass rate: failed vs non-failed completions
    const allCompletions = a.onTimeCount + a.lateCount;
    const passRate = allCompletions > 0 ? Math.round(((allCompletions - a.failedCount) / allCompletions) * 100) : -1;

    const lowVolume = a.tasksFractional < MIN_TASKS_THRESHOLD;
    const grade = lowVolume ? "—" : computeGrade(complianceScore);

    byEmployee.push({
      userUid: a.userUid,
      name: a.name,
      tasksFractional: a.tasksFractional,
      distinctParentJobs: a.distinctParentJobs.size,
      onTimeCount: a.onTimeCount,
      lateCount: a.lateCount,
      measurableCount: measurable,
      onTimePercent,
      stuckCount: a.stuckCount,
      neverStartedCount: a.neverStartedCount,
      failedCount: a.failedCount,
      passRate,
      hasFollowUp: a.hasFollowUp,
      complianceScore,
      grade,
      lowVolume,
      entries: a.entries,
    });
  }

  byEmployee.sort((x, y) => x.complianceScore - y.complianceScore);

  return { byEmployee, emptyCreditSetJobs };
}
