/**
 * Inngest function: Admin Workflow Executor.
 *
 * Receives `admin-workflow/run.requested` events and runs the configured
 * workflow. Each step is wrapped in `step.run()` for per-step retry and
 * observability in the Inngest dashboard.
 *
 * Phase 1 scope: linear pipeline only. Workflow definition shape:
 *   { steps: [{ id: string, kind: string, inputs: Record<string, string> }] }
 *
 * The editor UI (follow-up PR) will author workflows using @inngest/workflow-kit
 * and serialize into either this shape or a richer graph. The executor will
 * be extended then. For now, a hand-written definition (or a minimal editor)
 * suffices to prove the pattern.
 *
 * Template expressions: `{{trigger.foo}}` is resolved from the event's
 * triggerContext. `{{previous.<stepId>.<field>}}` references earlier step
 * outputs in the same run.
 */

import {
  adminWorkflowRunRequested,
  inngest,
} from "@/lib/inngest-client";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { getActionByKind } from "@/lib/admin-workflows/actions";
import {
  delayInputsSchema,
  evaluateStopIf,
  isControlFlowKind,
  parallelInputsSchema,
  parseParallelChildren,
  stopIfInputsSchema,
} from "@/lib/admin-workflows/control-flow";

const FAILURE_ALERT_RECIPIENT =
  process.env.ADMIN_WORKFLOWS_FAILURE_ALERT_EMAIL ?? "ops@photonbrothers.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface WorkflowDefinition {
  steps: Array<{
    id: string;
    kind: string;
    inputs: Record<string, string>;
  }>;
}

/** Resolve {{trigger.foo}} / {{previous.stepId.field}} expressions. */
function resolveTemplate(
  value: string,
  triggerContext: Record<string, unknown>,
  previousOutputs: Record<string, unknown>,
): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    const parts = expr.split(".").map((p) => p.trim());
    if (parts[0] === "trigger" && parts.length === 2) {
      const v = triggerContext[parts[1]];
      return v == null ? "" : String(v);
    }
    if (parts[0] === "previous" && parts.length >= 3) {
      const [, stepId, ...fieldPath] = parts;
      const stepOutput = previousOutputs[stepId] as Record<string, unknown> | undefined;
      if (!stepOutput) return "";
      let cur: unknown = stepOutput;
      for (const field of fieldPath) {
        if (cur && typeof cur === "object" && field in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[field];
        } else {
          return "";
        }
      }
      return cur == null ? "" : String(cur);
    }
    return "";
  });
}

function resolveInputs(
  inputs: Record<string, string>,
  triggerContext: Record<string, unknown>,
  previousOutputs: Record<string, unknown>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs)) {
    resolved[k] = resolveTemplate(v, triggerContext, previousOutputs);
  }
  return resolved;
}

export const adminWorkflowExecutor = inngest.createFunction(
  {
    id: "admin-workflow-executor",
    name: "Admin Workflow Executor",
    triggers: [adminWorkflowRunRequested],
    concurrency: {
      // One run per workflow at a time. Prevents a stuck workflow from
      // stampeding if many events arrive in a burst.
      key: "event.data.workflowId",
      limit: 5,
    },
    retries: 1,
  },
  async ({ event, step }) => {
    const { runId, workflowId, triggeredByEmail, triggerContext, dryRun } = event.data;
    const isDryRun = dryRun === true;

    if (!prisma) {
      throw new Error("Database not configured");
    }

    // ── Load workflow definition ──
    const workflow = await step.run("load-workflow", async () => {
      return prisma!.adminWorkflow.findUniqueOrThrow({
        where: { id: workflowId },
        select: { id: true, name: true, status: true, definition: true, maxRunsPerHour: true },
      });
    });

    // ── Rate limit check ──
    // maxRunsPerHour = 0 → unlimited. Otherwise skip if too many runs in the
    // last hour. Dry-runs are always allowed (they exist for testing).
    if (!isDryRun && workflow.maxRunsPerHour > 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentRuns = await step.run("check-rate-limit", async () => {
        return prisma!.adminWorkflowRun.count({
          where: {
            workflowId,
            startedAt: { gte: oneHourAgo },
            // Exclude the current run row (created before event dispatch).
            id: { not: runId },
          },
        });
      });
      if (recentRuns >= workflow.maxRunsPerHour) {
        await step.run("mark-rate-limited", async () => {
          return prisma!.adminWorkflowRun.update({
            where: { id: runId },
            data: {
              status: "FAILED",
              errorMessage: `Rate limit hit: ${recentRuns} runs in the last hour (limit ${workflow.maxRunsPerHour}). Raise maxRunsPerHour or set 0 to disable.`,
              completedAt: new Date(),
            },
          });
        });
        return { status: "rate-limited", workflowId, recentRuns, limit: workflow.maxRunsPerHour };
      }
    }

    // ── Load existing run state for idempotent resume ──
    // If this function has been invoked for the same runId before (e.g. the
    // previous invocation crashed after succeeding a few steps), we restore
    // the outputs captured so far and skip those steps on this pass.
    // Inngest's own step.run cache handles retries within a single
    // invocation; this checkpoint handles cross-invocation re-entry.
    const existingRun = await step.run("load-existing-state", async () => {
      return prisma!.adminWorkflowRun.findUnique({
        where: { id: runId },
        select: { status: true, result: true },
      });
    });
    const resumedOutputs: Record<string, unknown> =
      existingRun?.result && typeof existingRun.result === "object" && !Array.isArray(existingRun.result)
        ? ((existingRun.result as { outputs?: Record<string, unknown> }).outputs ?? {})
        : {};
    const resumedStepIds = new Set(Object.keys(resumedOutputs));

    // If the run was already marked SUCCEEDED or FAILED by a previous
    // invocation, don't re-execute — just acknowledge.
    if (existingRun?.status === "SUCCEEDED" || existingRun?.status === "FAILED") {
      return {
        status: "already-terminal",
        runId,
        priorStatus: existingRun.status,
      };
    }

    if (workflow.status !== "ACTIVE") {
      // Workflow was archived or moved to draft between trigger emit and
      // execution — mark the run as failed with a clear reason.
      await step.run("mark-inactive", async () => {
        return prisma!.adminWorkflowRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            errorMessage: `Workflow is in ${workflow.status} state; skipping`,
            completedAt: new Date(),
          },
        });
      });
      return { status: "skipped", reason: `workflow ${workflow.status}` };
    }

    const definition = workflow.definition as unknown as WorkflowDefinition;
    if (!definition?.steps?.length) {
      throw new Error(`Workflow ${workflowId} has no steps`);
    }

    const previousOutputs: Record<string, unknown> = { ...resumedOutputs };
    const startedAt = Date.now();
    let stoppedEarly: { byStepId: string; reason: string } | null = null;

    /** Persist current state so a later invocation can resume from here. */
    const checkpoint = async (checkpointId: string) => {
      await step.run(`checkpoint:${checkpointId}`, async () => {
        return prisma!.adminWorkflowRun.update({
          where: { id: runId },
          data: {
            result: { outputs: previousOutputs, ...(isDryRun ? { dryRun: true } : {}) } as object,
          },
        });
      });
    };
    let failedStep: string | null = null;
    let failureError: string | null = null;

    // ── Execute steps in order ──
    // Wrap the loop so step failures mark the run FAILED + fire an alert
    // before the exception bubbles up to Inngest for retry/final-fail.
    try {
    for (const stepDef of definition.steps) {
      // Skip steps already completed by a previous invocation for this runId.
      // Their output is already in previousOutputs via resumedOutputs.
      if (resumedStepIds.has(stepDef.id)) {
        continue;
      }

      // Resolve template expressions (needs outputs captured so far)
      const resolvedInputs = resolveInputs(stepDef.inputs, triggerContext, previousOutputs);
      failedStep = stepDef.id;

      // ── Control-flow kinds are handled specially ──
      if (isControlFlowKind(stepDef.kind)) {
        if (stepDef.kind === "delay") {
          const delayInputs = delayInputsSchema.parse(resolvedInputs);
          const seconds = Math.max(0, Math.min(86400, parseInt(delayInputs.seconds, 10) || 0));
          if (isDryRun) {
            // Skip the actual sleep in dry-run — admins don't want to
            // wait hours for a test run.
            previousOutputs[stepDef.id] = { delayedSeconds: seconds, __dryRun: true };
            continue;
          }
          // step.sleep must be called at Inngest-step top level; it is here
          await step.sleep(`${stepDef.id}:delay`, `${seconds}s`);
          previousOutputs[stepDef.id] = { delayedSeconds: seconds };
          await checkpoint(stepDef.id);
          continue;
        }
        if (stepDef.kind === "parallel") {
          const parallelInputs = parallelInputsSchema.parse(resolvedInputs);
          const children = parseParallelChildren(parallelInputs.childrenJson);

          // Validate all child kinds up front so we fail fast
          for (const c of children) {
            if (isControlFlowKind(c.kind)) {
              throw new Error(`parallel: child ${c.id} cannot be a control-flow kind`);
            }
            if (!getActionByKind(c.kind)) {
              throw new Error(`parallel: unknown action kind in child ${c.id}: ${c.kind}`);
            }
          }

          if (isDryRun) {
            const childOutputs: Record<string, unknown> = {};
            for (const c of children) {
              const resolved = resolveInputs(c.inputs, triggerContext, previousOutputs);
              childOutputs[c.id] = { __dryRun: true, kind: c.kind, resolvedInputs: resolved };
            }
            previousOutputs[stepDef.id] = { __dryRun: true, children: childOutputs };
            await checkpoint(stepDef.id);
            continue;
          }

          // Run children concurrently. Each is its own step.run so
          // Inngest caches + retries them independently.
          const results = await Promise.all(
            children.map(async (c) => {
              const action = getActionByKind(c.kind)!;
              const resolved = resolveInputs(c.inputs, triggerContext, previousOutputs);
              const parsed = action.inputsSchema.parse(resolved);
              const out = await step.run(`${stepDef.id}:parallel:${c.id}:${c.kind}`, () =>
                action.handler({
                  inputs: parsed,
                  context: {
                    runId,
                    workflowId,
                    stepId: `${stepDef.id}:${c.id}`,
                    triggerContext,
                    previousOutputs,
                    triggeredByEmail,
                  },
                }),
              );
              return [c.id, out] as const;
            }),
          );
          const childOutputs: Record<string, unknown> = {};
          for (const [id, out] of results) childOutputs[id] = out;
          previousOutputs[stepDef.id] = { children: childOutputs };
          await checkpoint(stepDef.id);
          continue;
        }
        if (stepDef.kind === "stop-if") {
          const stopInputs = stopIfInputsSchema.parse(resolvedInputs);
          const shouldStop = await step.run(`${stepDef.id}:stop-if`, async () =>
            evaluateStopIf(stopInputs),
          );
          if (shouldStop) {
            stoppedEarly = {
              byStepId: stepDef.id,
              reason: `stop-if matched: ${stopInputs.left} ${stopInputs.operator} ${stopInputs.right ?? ""}`,
            };
            previousOutputs[stepDef.id] = { stopped: true, ...stopInputs };
            await checkpoint(stepDef.id);
            break;
          }
          previousOutputs[stepDef.id] = { stopped: false, ...stopInputs };
          await checkpoint(stepDef.id);
          continue;
        }
        throw new Error(`Unhandled control-flow kind: ${stepDef.kind}`);
      }

      // ── Regular actions ──
      const action = getActionByKind(stepDef.kind);
      if (!action) {
        throw new Error(`Unknown action kind: ${stepDef.kind}`);
      }
      const parsedInputs = action.inputsSchema.parse(resolvedInputs);

      if (isDryRun) {
        // Record resolved inputs + a stub output; do NOT invoke handler.
        // This gives admins a safe preview of what would run without any
        // external side effects (emails, HubSpot writes, Zuper writes, etc.).
        const stub = {
          __dryRun: true,
          kind: stepDef.kind,
          resolvedInputs: parsedInputs as Record<string, unknown>,
        };
        await step.run(`${stepDef.id}:${stepDef.kind}:dryrun`, async () => stub);
        previousOutputs[stepDef.id] = stub;
        continue;
      }

      const output = await step.run(`${stepDef.id}:${stepDef.kind}`, () =>
        action.handler({
          inputs: parsedInputs,
          context: {
            runId,
            workflowId,
            stepId: stepDef.id,
            triggerContext,
            previousOutputs,
            triggeredByEmail,
          },
        }),
      );

      previousOutputs[stepDef.id] = output;
      // Checkpoint after each step so a re-invocation can resume from here.
      await checkpoint(stepDef.id);
    }
    failedStep = null;
    } catch (err) {
      failureError = err instanceof Error ? err.message : String(err);

      // Persist failure immediately so the run page reflects it even if
      // Inngest retries (next attempt will overwrite on success or re-fail).
      await step.run("mark-failed", async () => {
        return prisma!.adminWorkflowRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            errorMessage: `Step ${failedStep ?? "?"}: ${failureError}`.slice(0, 2000),
            durationMs: Date.now() - startedAt,
            completedAt: new Date(),
            result: { outputs: previousOutputs, failedStep, failureError } as object,
          },
        });
      });

      // Fire a failure alert (best-effort). We deliberately do NOT gate on
      // attempt count — getting one email per attempt is acceptable and
      // simpler than juggling Inngest's retry state here. Admins can mute
      // by setting ADMIN_WORKFLOWS_FAILURE_ALERT_EMAIL="" to disable.
      // Skip alerts entirely on dry-runs.
      if (FAILURE_ALERT_RECIPIENT && !isDryRun) {
        await step.run("send-failure-alert", async () => {
          const subject = `[Admin Workflow] ${workflow.name} failed at step ${failedStep ?? "?"}`;
          const body = [
            `<p><strong>${workflow.name}</strong> failed.</p>`,
            `<ul>`,
            `<li>Run: <code>${runId}</code></li>`,
            `<li>Failed step: <code>${failedStep ?? "?"}</code></li>`,
            `<li>Triggered by: ${triggeredByEmail}</li>`,
            `</ul>`,
            `<p><strong>Error:</strong></p>`,
            `<pre style="background:#f5f5f5;padding:8px;border-radius:4px;">${escapeHtml(failureError ?? "")}</pre>`,
            `<p>Run detail: https://www.pbtechops.com/dashboards/admin/workflows/runs/${runId}</p>`,
          ].join("\n");
          try {
            await sendEmailMessage({
              to: FAILURE_ALERT_RECIPIENT,
              subject,
              html: body,
              text: `${workflow.name} failed at step ${failedStep}: ${failureError}`,
              debugFallbackTitle: `AdminWorkflow ${workflowId} failure`,
              debugFallbackBody: `Run ${runId} failed`,
            });
          } catch (alertErr) {
            console.error("[admin-workflow-executor] Alert send failed:", alertErr);
          }
          return { alerted: true };
        });
      }

      throw err; // let Inngest handle retry / final-fail
    }

    // ── Mark run succeeded ──
    const durationMs = Date.now() - startedAt;
    await step.run("mark-succeeded", async () => {
      const resultPayload: Record<string, unknown> = {
        outputs: previousOutputs,
        ...(stoppedEarly ? { stoppedEarly } : {}),
        ...(isDryRun ? { dryRun: true } : {}),
      };
      return prisma!.adminWorkflowRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          result: resultPayload as object,
          durationMs,
          completedAt: new Date(),
        },
      });
    });

    return {
      status: stoppedEarly ? "stopped-early" : "succeeded",
      workflowId,
      workflowName: workflow.name,
      runId,
      stepCount: definition.steps.length,
      durationMs,
      ...(stoppedEarly ? { stoppedEarly } : {}),
    };
  },
);
