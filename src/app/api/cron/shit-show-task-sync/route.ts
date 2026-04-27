import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Cron poller — every 15 minutes.
 *
 * For every OPEN ShitShowAssignment with a hubspotTaskId, query HubSpot
 * for the task's status. If the task is COMPLETED in HubSpot, mark our
 * row COMPLETED too. Best-effort — failures are logged but don't abort
 * the run.
 */
export async function GET() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_ACCESS_TOKEN missing" },
      { status: 500 },
    );
  }

  const open = await prisma.shitShowAssignment.findMany({
    where: { status: "OPEN", hubspotTaskId: { not: null } },
    select: { id: true, hubspotTaskId: true },
  });

  let closed = 0;
  let failed = 0;

  for (const a of open) {
    if (!a.hubspotTaskId) continue;
    try {
      const taskRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/tasks/${a.hubspotTaskId}?properties=hs_task_status`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!taskRes.ok) {
        failed += 1;
        continue;
      }
      const data = (await taskRes.json()) as {
        properties?: { hs_task_status?: string };
      };
      if (data?.properties?.hs_task_status === "COMPLETED") {
        await prisma.shitShowAssignment.update({
          where: { id: a.id },
          data: { status: "COMPLETED" },
        });
        closed += 1;
      }
    } catch (e) {
      console.error(`[cron/shit-show-task-sync] task ${a.hubspotTaskId} failed`, e);
      failed += 1;
    }
  }

  return NextResponse.json({ checked: open.length, closed, failed });
}
