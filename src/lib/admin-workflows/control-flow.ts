/**
 * Control-flow action metadata.
 *
 * These kinds are treated specially by the executor — they don't run
 * through the normal `step.run(handler)` pathway. `delay` uses
 * `step.sleep`; `stop-if` short-circuits the workflow.
 *
 * They still appear in the editor palette so admins can drop them in
 * like regular actions. The executor looks at `kind` and routes.
 */

import { z } from "zod";

import type { AdminFormField } from "@/lib/admin-workflows/types";

export const CONTROL_FLOW_KINDS = new Set(["delay", "stop-if"]);

export function isControlFlowKind(kind: string): boolean {
  return CONTROL_FLOW_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

export const delayInputsSchema = z.object({
  seconds: z.string().min(1),
});

export const delayPaletteEntry = {
  kind: "delay",
  name: "Delay",
  description:
    "Pause the workflow for N seconds before running the next step. Counts against Inngest execution quotas.",
  category: "Control flow",
  fields: [
    {
      key: "seconds",
      label: "Seconds to wait",
      kind: "text" as const,
      placeholder: "60",
      help: "Integer seconds. Max 24h (86400). Supports templates.",
      required: true,
    },
  ] satisfies AdminFormField[],
};

// ---------------------------------------------------------------------------
// stop-if
// ---------------------------------------------------------------------------

export const stopIfOperators = ["equals", "not-equals", "contains", "is-empty", "is-not-empty"] as const;
export type StopIfOperator = (typeof stopIfOperators)[number];

export const stopIfInputsSchema = z.object({
  left: z.string(),
  operator: z.enum(stopIfOperators),
  right: z.string().optional().default(""),
});

export const stopIfPaletteEntry = {
  kind: "stop-if",
  name: "Stop if (conditional)",
  description:
    "If the condition is true, stop the workflow successfully without running remaining steps.",
  category: "Control flow",
  fields: [
    {
      key: "left",
      label: "Value to check",
      kind: "text" as const,
      placeholder: "{{trigger.propertyValue}}",
      required: true,
    },
    {
      key: "operator",
      label: "Operator",
      kind: "text" as const,
      placeholder: "equals | not-equals | contains | is-empty | is-not-empty",
      required: true,
    },
    {
      key: "right",
      label: "Compare to",
      kind: "text" as const,
      help: "Leave blank for is-empty / is-not-empty.",
    },
  ] satisfies AdminFormField[],
};

/**
 * Evaluate a stop-if condition. Returns true if the workflow should stop.
 * Designed to be deterministic and side-effect-free.
 */
export function evaluateStopIf(inputs: z.infer<typeof stopIfInputsSchema>): boolean {
  const left = inputs.left;
  const right = inputs.right ?? "";
  switch (inputs.operator) {
    case "equals":
      return left === right;
    case "not-equals":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "is-empty":
      return left.trim().length === 0;
    case "is-not-empty":
      return left.trim().length > 0;
    default:
      return false;
  }
}

export const CONTROL_FLOW_PALETTE = [delayPaletteEntry, stopIfPaletteEntry];
