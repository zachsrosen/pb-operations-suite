// src/lib/task-digest/fetch-hs-tasks.ts
//
// Query open HubSpot tasks assigned to a single owner, with task→deal
// associations resolved for context in the digest email.

import { hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/tasks/models/Filter";

export interface OpenHsTask {
  taskId: string;
  subject: string;
  body: string | null;
  status: string;
  priority: string | null;
  type: string | null;
  dueAtMs: number | null;
  associatedDealId: string | null;
  associatedDealName: string | null;
}

const TASK_PROPERTIES = [
  "hs_task_subject",
  "hs_task_body",
  "hs_task_status",
  "hs_task_priority",
  "hs_task_type",
  "hs_timestamp",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
];

const OPEN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"];

export async function fetchOpenHsTasksForOwner(
  ownerId: string
): Promise<{ tasks: OpenHsTask[]; error?: string }> {
  try {
    const resp = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hubspot_owner_id",
              operator: FilterOperatorEnum.Eq,
              value: ownerId,
            },
            {
              propertyName: "hs_task_status",
              operator: FilterOperatorEnum.In,
              values: OPEN_STATUSES,
            },
          ],
        },
      ],
      properties: TASK_PROPERTIES,
      limit: 100,
      sorts: [],
      after: undefined,
      query: undefined,
    });

    const raw = (resp.results ?? []) as Array<{
      id: string;
      properties: Record<string, string | null>;
    }>;

    const tasks: OpenHsTask[] = raw.map((r) => {
      const p = r.properties;
      const dueRaw = p.hs_timestamp;
      const dueAtMs = dueRaw ? Number(dueRaw) : null;
      return {
        taskId: r.id,
        subject: p.hs_task_subject ?? "(no subject)",
        body: p.hs_task_body ?? null,
        status: p.hs_task_status ?? "UNKNOWN",
        priority: p.hs_task_priority ?? null,
        type: p.hs_task_type ?? null,
        dueAtMs: Number.isFinite(dueAtMs) ? dueAtMs : null,
        associatedDealId: null,
        associatedDealName: null,
      };
    });

    if (tasks.length === 0) {
      return { tasks };
    }

    // Resolve task → deal associations
    const taskIdSet = new Set(tasks.map((t) => t.taskId));
    const taskDealMap = new Map<string, string>();

    try {
      const assocResp = await hubspotClient.crm.associations.batchApi.read(
        "tasks",
        "deals",
        { inputs: tasks.map((t) => ({ id: t.taskId })) }
      );

      for (const result of assocResp.results ?? []) {
        const fromId: string =
          (result as unknown as { _from?: { id: string } })._from?.id ?? "";
        const toArr: Array<{ id: string }> =
          (result as unknown as { to?: Array<{ id: string }> }).to ?? [];
        if (fromId && taskIdSet.has(fromId) && toArr.length > 0) {
          taskDealMap.set(fromId, toArr[0].id);
        }
      }
    } catch (err) {
      console.warn("[task-digest] task→deal association fetch failed:", err);
    }

    const uniqueDealIds = [...new Set(taskDealMap.values())];
    const dealNameMap = new Map<string, string>();

    if (uniqueDealIds.length > 0) {
      try {
        const dealResp = await hubspotClient.crm.deals.batchApi.read({
          inputs: uniqueDealIds.map((id) => ({ id })),
          properties: ["dealname"],
          propertiesWithHistory: [],
        });
        for (const deal of dealResp.results ?? []) {
          const name = deal.properties?.dealname ?? null;
          if (name) dealNameMap.set(deal.id, name);
        }
      } catch (err) {
        console.warn("[task-digest] deal name batch-read failed:", err);
      }
    }

    for (const task of tasks) {
      const dealId = taskDealMap.get(task.taskId) ?? null;
      task.associatedDealId = dealId;
      task.associatedDealName = dealId ? (dealNameMap.get(dealId) ?? null) : null;
    }

    // Sort: overdue first (by oldest due date), then upcoming, then no due date
    const now = Date.now();
    tasks.sort((a, b) => {
      const aOver = a.dueAtMs !== null && a.dueAtMs < now;
      const bOver = b.dueAtMs !== null && b.dueAtMs < now;
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (a.dueAtMs === null && b.dueAtMs === null) return 0;
      if (a.dueAtMs === null) return 1;
      if (b.dueAtMs === null) return -1;
      return a.dueAtMs - b.dueAtMs;
    });

    return { tasks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[task-digest] fetchOpenHsTasksForOwner failed:", err);
    return { tasks: [], error: msg };
  }
}
