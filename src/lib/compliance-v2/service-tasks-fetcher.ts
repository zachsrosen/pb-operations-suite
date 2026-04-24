/**
 * Fetches service tasks + linked form submissions for a set of parent jobs.
 *
 * Memoizes per-batch so the same job isn't queried twice in one
 * computeLocationComplianceV2 call. Caller is responsible for constructing
 * a fresh fetcher per request (no cross-request leakage).
 */
import { zuper } from "@/lib/zuper";

export interface ServiceTaskRaw {
  service_task_uid: string;
  service_task_title: string;
  service_task_status: string;
  assigned_to: Array<{
    user?: {
      user_uid?: string;
      first_name?: string;
      last_name?: string;
      is_active?: boolean;
    };
    /** Zuper-native team metadata on the per-assignment entry. Used for location attribution. */
    team?: {
      team_uid?: string;
      team_name?: string;
    };
  }>;
  asset_inspection_submission_uid: string | null;
  actual_end_time?: string | null;
  actual_start_time?: string | null;
}

export interface FormSubmissionRaw {
  created_by?: {
    user_uid?: string;
    first_name?: string;
    last_name?: string;
  };
  created_at: string;
}

export interface ServiceTasksBundle {
  tasks: ServiceTaskRaw[];
  formByTaskUid: Map<string, FormSubmissionRaw | null>;
}

export function createServiceTasksFetcher() {
  const bundleCache = new Map<string, Promise<ServiceTasksBundle | null>>();

  async function fetchBundle(jobUid: string): Promise<ServiceTasksBundle | null> {
    const existing = bundleCache.get(jobUid);
    if (existing) return existing;

    const promise = (async () => {
      const tasksResult = await zuper.getJobServiceTasks(jobUid);
      if (tasksResult.type !== "success") return null;
      const raw = tasksResult.data;
      const tasksArr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.service_tasks ?? []);
      const tasks: ServiceTaskRaw[] = Array.isArray(tasksArr) ? tasksArr : [];

      const formByTaskUid = new Map<string, FormSubmissionRaw | null>();

      // Fetch form submissions in parallel (bounded — typically ≤6 per job)
      await Promise.all(
        tasks.map(async (t) => {
          const uid = t.asset_inspection_submission_uid;
          if (!uid) {
            formByTaskUid.set(t.service_task_uid, null);
            return;
          }
          const r = await zuper.getFormSubmission(uid);
          if (r.type !== "success") {
            formByTaskUid.set(t.service_task_uid, null);
            return;
          }
          const body = r.data;
          const form = (body?.data ?? body) as FormSubmissionRaw | null;
          formByTaskUid.set(t.service_task_uid, form);
        })
      );

      return { tasks, formByTaskUid };
    })();

    bundleCache.set(jobUid, promise);
    return promise;
  }

  return { fetchBundle };
}

export type ServiceTasksFetcher = ReturnType<typeof createServiceTasksFetcher>;
