/**
 * Pure function: compute the credit set for a service task.
 *
 * Credit set = union of:
 *   1. service_task.assigned_to[] user_uids (active users only)
 *   2. linked form submission's created_by.user_uid (if form exists)
 *
 * Returns the user_uid list + a best-name lookup for display.
 *
 * Spec: §2.2
 */

export interface CreditSetInputs {
  task: {
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
    }>;
    asset_inspection_submission_uid: string | null;
  };
  form: {
    created_by?: {
      user_uid?: string;
      first_name?: string;
      last_name?: string;
    };
    created_at: string;
  } | null;
}

export interface CreditSet {
  userUids: string[];
  nameByUid: Map<string, string>;
}

export function computeCreditSet(inputs: CreditSetInputs): CreditSet {
  const nameByUid = new Map<string, string>();
  const uids = new Set<string>();

  // 1. Task assignees (active only)
  for (const entry of inputs.task.assigned_to ?? []) {
    const u = entry?.user;
    if (!u?.user_uid) continue;
    if (u.is_active === false) continue;
    uids.add(u.user_uid);
    const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
    if (name) nameByUid.set(u.user_uid, name);
  }

  // 2. Form submitter — only add if not already in the task-assignee nameByUid
  //    (task-assignee name takes precedence per "prefers task-assigned name" test)
  const form = inputs.form;
  if (form?.created_by?.user_uid) {
    const uid = form.created_by.user_uid;
    uids.add(uid);
    if (!nameByUid.has(uid)) {
      const name = `${form.created_by.first_name ?? ""} ${form.created_by.last_name ?? ""}`.trim();
      if (name) nameByUid.set(uid, name);
    }
  }

  return { userUids: [...uids], nameByUid };
}
