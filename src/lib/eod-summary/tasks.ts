// src/lib/eod-summary/tasks.ts
//
// Query HubSpot for tasks completed today by tracked leads.

import { hubspotClient } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/tasks/models/Filter";
import { getAllTrackedOwnerIds, getAllOwnerNameMap } from "./config";

// ── Types ──────────────────────────────────────────────────────────────

export interface CompletedTask {
  taskId: string;
  subject: string;
  ownerId: string;
  ownerName: string;
  completedAt: string | null;
  associatedDealId: string | null;
  associatedDealName: string | null;
}

// ── Owner lookup ───────────────────────────────────────────────────────

const OWNER_NAME_MAP = getAllOwnerNameMap();
const ALL_OWNER_IDS = getAllTrackedOwnerIds();

// ── DST-safe Denver offset helper ──────────────────────────────────────

/**
 * Returns the current GMT offset for America/Denver as a string like
 * "-07:00" or "-06:00", suitable for use in a Date constructor template literal.
 */
function getDenverGmtOffset(): string {
  // Format: "3/27/2026, GMT-06:00" — extract the GMT portion
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    timeZoneName: "longOffset",
  }).format(new Date());

  const match = formatted.match(/GMT([+-]\d{2}:\d{2})/);
  if (match) return match[1];

  // Fallback: compute offset manually
  const now = new Date();
  const denverStr = now.toLocaleString("en-US", { timeZone: "America/Denver" });
  const denverDate = new Date(denverStr);
  const offsetMs = now.getTime() - denverDate.getTime();
  const offsetHours = Math.round(offsetMs / 3_600_000);
  const sign = offsetHours <= 0 ? "+" : "-";
  const abs = Math.abs(offsetHours);
  return `${sign}${String(abs).padStart(2, "0")}:00`;
}

// ── Main export ────────────────────────────────────────────────────────

export async function queryCompletedTasks(): Promise<{
  tasks: CompletedTask[];
  error?: string;
}> {
  try {
    // ── 1. Calculate "today 6 AM Denver" in UTC ──────────────────────
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Denver",
    }); // e.g. "2026-03-27"

    const gmtOffset = getDenverGmtOffset(); // e.g. "-06:00"
    const startOfDay = new Date(`${todayStr}T06:00:00${gmtOffset}`);
    const startMs = startOfDay.getTime();

    // ── 2. Search for completed tasks by tracked owners ───────────────
    const baseFilters = [
      {
        propertyName: "hs_task_status",
        operator: FilterOperatorEnum.Eq,
        value: "COMPLETED",
      },
      {
        propertyName: "hubspot_owner_id",
        operator: FilterOperatorEnum.In,
        values: ALL_OWNER_IDS,
      },
    ];

    const TASK_PROPERTIES = [
      "hs_task_subject",
      "hubspot_owner_id",
      "hs_task_completion_date",
      "hs_lastmodifieddate",
    ];

    let rawResults: Array<{ id: string; properties: Record<string, string | null> }> = [];

    // First try: filter on hs_task_completion_date
    try {
      const primaryResp = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              ...baseFilters,
              {
                propertyName: "hs_task_completion_date",
                operator: FilterOperatorEnum.Gte,
                value: String(startMs),
              },
            ],
          },
        ],
        properties: TASK_PROPERTIES,
        limit: 200,
        sorts: [],
        after: undefined,
        query: undefined,
      });

      rawResults = (primaryResp.results ?? []) as typeof rawResults;
    } catch (err) {
      console.warn(
        "[eod-tasks] Primary task search (hs_task_completion_date) failed, will try fallback:",
        err
      );
    }

    // Fallback: filter on hs_lastmodifieddate if primary returned nothing
    if (rawResults.length === 0) {
      try {
        const fallbackResp = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                ...baseFilters,
                {
                  propertyName: "hs_lastmodifieddate",
                  operator: FilterOperatorEnum.Gte,
                  value: String(startMs),
                },
              ],
            },
          ],
          properties: TASK_PROPERTIES,
          limit: 200,
          sorts: [],
          after: undefined,
          query: undefined,
        });

        rawResults = (fallbackResp.results ?? []) as typeof rawResults;
      } catch (fallbackErr) {
        console.error("[eod-tasks] Fallback task search also failed:", fallbackErr);
        return { tasks: [], error: String(fallbackErr) };
      }
    }

    // ── 3. Build CompletedTask array ──────────────────────────────────
    const tasks: CompletedTask[] = rawResults.map((r) => {
      const p = r.properties;
      const ownerId = p.hubspot_owner_id ?? "";
      return {
        taskId: r.id,
        subject: p.hs_task_subject ?? "(no subject)",
        ownerId,
        ownerName: OWNER_NAME_MAP.get(ownerId) ?? ownerId,
        completedAt: p.hs_task_completion_date ?? p.hs_lastmodifieddate ?? null,
        associatedDealId: null,
        associatedDealName: null,
      };
    });

    if (tasks.length === 0) {
      return { tasks };
    }

    // ── 4. Batch-resolve task → deal associations (cap at 50) ─────────
    const tasksToResolve = tasks.slice(0, 50);
    const taskIdSet = new Set(tasksToResolve.map((t) => t.taskId));

    // taskId → dealId
    const taskDealMap = new Map<string, string>();

    try {
      const assocResp = await hubspotClient.crm.associations.batchApi.read(
        "tasks",
        "deals",
        { inputs: tasksToResolve.map((t) => ({ id: t.taskId })) }
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
    } catch (assocErr) {
      console.warn("[eod-tasks] Failed to resolve task→deal associations:", assocErr);
      // Non-fatal — return tasks without deal names
      return { tasks };
    }

    // ── 5. Batch-resolve deal names ───────────────────────────────────
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
          if (name) {
            dealNameMap.set(deal.id, name);
          }
        }
      } catch (dealErr) {
        console.warn("[eod-tasks] Failed to batch-read deal names:", dealErr);
        // Non-fatal — return tasks with deal IDs but no names
      }
    }

    // ── 6. Merge deal info back into tasks ────────────────────────────
    for (const task of tasks) {
      const dealId = taskDealMap.get(task.taskId) ?? null;
      task.associatedDealId = dealId;
      task.associatedDealName = dealId ? (dealNameMap.get(dealId) ?? null) : null;
    }

    return { tasks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[eod-tasks] queryCompletedTasks failed:", err);
    return { tasks: [], error: msg };
  }
}
