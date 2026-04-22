/**
 * GET /api/cron/admin-workflow-cron-dispatch
 *
 * Runs every minute. Queries ACTIVE workflows with CRON trigger,
 * evaluates each workflow's cron expression against the current minute
 * (UTC), and fires admin-workflow/run.requested events for matches.
 *
 * Uses a 60-second window [now-60s, now] so missed minutes (e.g. after
 * a deploy) don't fire stale runs. Only fires workflows whose
 * previous scheduled time falls into this window.
 *
 * Auth: CRON_SECRET bearer token.
 */

import { NextResponse, type NextRequest } from "next/server";
// cron-parser v5 ESM default shape
import { CronExpressionParser } from "cron-parser";

import { prisma } from "@/lib/db";
import {
  adminWorkflowRunRequested,
  inngest,
  isAdminWorkflowsEnabled,
} from "@/lib/inngest-client";

export const maxDuration = 30;

interface CronTriggerConfig {
  expression?: string;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ status: "disabled" });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 60_000);

  const workflows = await prisma.adminWorkflow.findMany({
    where: { status: "ACTIVE", triggerType: "CRON" },
    select: { id: true, triggerConfig: true },
  });

  let fired = 0;
  const errors: Array<{ workflowId: string; error: string }> = [];

  for (const wf of workflows) {
    const config = wf.triggerConfig as unknown as CronTriggerConfig;
    const expr = config?.expression;
    if (!expr || typeof expr !== "string") {
      errors.push({ workflowId: wf.id, error: "Invalid cron expression (missing)" });
      continue;
    }

    let previousFireAt: Date;
    try {
      // Parse from 'now', step backwards once to see when this cron last fired.
      const interval = CronExpressionParser.parse(expr, {
        currentDate: now,
        tz: "UTC",
      });
      previousFireAt = interval.prev().toDate();
    } catch (e) {
      errors.push({
        workflowId: wf.id,
        error: `Cron parse failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    if (previousFireAt < windowStart || previousFireAt > now) {
      // Didn't fire in this minute's window
      continue;
    }

    try {
      const run = await prisma.adminWorkflowRun.create({
        data: {
          workflowId: wf.id,
          status: "RUNNING",
          triggeredByEmail: "system:cron-dispatch",
          triggerContext: { firedAt: now.toISOString(), expression: expr },
        },
      });
      await inngest.send(
        adminWorkflowRunRequested.create({
          runId: run.id,
          workflowId: wf.id,
          triggeredByEmail: "system:cron-dispatch",
          triggerContext: { firedAt: now.toISOString(), expression: expr },
        }),
      );
      fired++;
    } catch (e) {
      errors.push({
        workflowId: wf.id,
        error: `Dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return NextResponse.json({
    status: "ok",
    now: now.toISOString(),
    windowStart: windowStart.toISOString(),
    checked: workflows.length,
    fired,
    errors,
  });
}
