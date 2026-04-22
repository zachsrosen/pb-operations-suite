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
import { getActionByKind } from "@/lib/admin-workflows/actions";
import {
  delayInputsSchema,
  evaluateStopIf,
  isControlFlowKind,
  stopIfInputsSchema,
} from "@/lib/admin-workflows/control-flow";

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
    const { runId, workflowId, triggeredByEmail, triggerContext } = event.data;

    if (!prisma) {
      throw new Error("Database not configured");
    }

    // ── Load workflow definition ──
    const workflow = await step.run("load-workflow", async () => {
      return prisma!.adminWorkflow.findUniqueOrThrow({
        where: { id: workflowId },
        select: { id: true, name: true, status: true, definition: true },
      });
    });

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

    const previousOutputs: Record<string, unknown> = {};
    const startedAt = Date.now();
    let stoppedEarly: { byStepId: string; reason: string } | null = null;

    // ── Execute steps in order ──
    for (const stepDef of definition.steps) {
      // Resolve template expressions (needs outputs captured so far)
      const resolvedInputs = resolveInputs(stepDef.inputs, triggerContext, previousOutputs);

      // ── Control-flow kinds are handled specially ──
      if (isControlFlowKind(stepDef.kind)) {
        if (stepDef.kind === "delay") {
          const delayInputs = delayInputsSchema.parse(resolvedInputs);
          const seconds = Math.max(0, Math.min(86400, parseInt(delayInputs.seconds, 10) || 0));
          // step.sleep must be called at Inngest-step top level; it is here
          await step.sleep(`${stepDef.id}:delay`, `${seconds}s`);
          previousOutputs[stepDef.id] = { delayedSeconds: seconds };
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
            break;
          }
          previousOutputs[stepDef.id] = { stopped: false, ...stopInputs };
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

      const output = await step.run(`${stepDef.id}:${stepDef.kind}`, () =>
        action.handler({
          inputs: parsedInputs,
          context: {
            runId,
            workflowId,
            triggerContext,
            previousOutputs,
            triggeredByEmail,
          },
        }),
      );

      previousOutputs[stepDef.id] = output;
    }

    // ── Mark run succeeded ──
    const durationMs = Date.now() - startedAt;
    await step.run("mark-succeeded", async () => {
      const resultPayload: Record<string, unknown> = {
        outputs: previousOutputs,
        ...(stoppedEarly ? { stoppedEarly } : {}),
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
