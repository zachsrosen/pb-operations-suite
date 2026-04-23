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

export const CONTROL_FLOW_KINDS = new Set(["delay", "stop-if", "parallel", "for-each"]);

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

// ---------------------------------------------------------------------------
// parallel
// ---------------------------------------------------------------------------

/**
 * Parallel executes multiple child steps concurrently. Admin provides a
 * JSON array of child step descriptors: [{id, kind, inputs}, ...].
 * Each child runs as its own Inngest step.run so they parallelize.
 *
 * Child steps can't be control-flow (no nested parallel / delay / stop-if)
 * and can't reference each other's outputs (siblings run concurrently).
 * They CAN reference outer-scope previousOutputs + triggerContext.
 */
export const parallelInputsSchema = z.object({
  childrenJson: z.string().min(2), // JSON array string
});

export const parallelPaletteEntry = {
  kind: "parallel",
  name: "Parallel (run children concurrently)",
  description:
    "Run multiple actions in parallel. Inputs is a JSON array of child step descriptors. Children can't reference each other's outputs.",
  category: "Control flow",
  fields: [
    {
      key: "childrenJson",
      label: "Child steps (JSON array)",
      kind: "textarea" as const,
      placeholder:
        '[{"id":"a","kind":"send-email","inputs":{"to":"...","subject":"...","body":"..."}},{"id":"b","kind":"add-hubspot-note","inputs":{"dealId":"{{trigger.objectId}}","body":"..."}}]',
      help:
        "Each child needs id, kind (regular action kind), inputs. Children run concurrently; use stop-if before parallel if you need conditional execution.",
      required: true,
    },
  ] satisfies AdminFormField[],
};

export interface ParallelChildStep {
  id: string;
  kind: string;
  inputs: Record<string, string>;
}

/**
 * Validate + parse the childrenJson string to child step descriptors.
 * Throws with a useful message if the JSON is malformed or shapes are off.
 */
export function parseParallelChildren(childrenJson: string): ParallelChildStep[] {
  let raw: unknown;
  try {
    raw = JSON.parse(childrenJson);
  } catch (err) {
    throw new Error(
      `parallel.childrenJson is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new Error("parallel.childrenJson must be a JSON array");
  }
  const children: ParallelChildStep[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`parallel.childrenJson[${i}] must be an object`);
    }
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id) {
      throw new Error(`parallel.childrenJson[${i}].id must be a non-empty string`);
    }
    if (typeof c.kind !== "string" || !c.kind) {
      throw new Error(`parallel.childrenJson[${i}].kind must be a non-empty string`);
    }
    if (!c.inputs || typeof c.inputs !== "object" || Array.isArray(c.inputs)) {
      throw new Error(`parallel.childrenJson[${i}].inputs must be an object`);
    }
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.inputs as Record<string, unknown>)) {
      inputs[k] = v == null ? "" : String(v);
    }
    children.push({ id: c.id, kind: c.kind, inputs });
  }
  return children;
}

// ---------------------------------------------------------------------------
// for-each
// ---------------------------------------------------------------------------

/**
 * Iterate a body of child steps N times, once per item in an input array.
 *
 * Input: `arrayPath` — a template expression resolving to a JSON array
 *   (e.g. `{{previous.fetch.items}}`). MUST resolve to a JSON array
 *   string; the executor parses it. If it doesn't resolve to an array,
 *   the loop is skipped.
 *
 * Input: `childrenJson` — same shape as parallel's childrenJson.
 *   Children run SEQUENTIALLY per iteration. The loop variable is
 *   accessible in child input templates via {{loop.item}} and
 *   {{loop.index}}.
 *
 * Max iterations: 100 (safety cap). Longer loops should be broken
 * into batches or rearchitected.
 */
export const forEachInputsSchema = z.object({
  arrayPath: z.string().min(1),
  childrenJson: z.string().min(2),
});

export const forEachPaletteEntry = {
  kind: "for-each",
  name: "For each (iterate array)",
  description:
    "Run a set of actions once per item in an array. Input must resolve to a JSON array. Capped at 100 iterations for safety.",
  category: "Control flow",
  fields: [
    {
      key: "arrayPath",
      label: "Array (template expression)",
      kind: "text" as const,
      placeholder: "{{previous.fetch.lineItems}}",
      help: "Must resolve to a JSON array. Typically comes from a prior fetch/ai-compose step.",
      required: true,
    },
    {
      key: "childrenJson",
      label: "Child steps per iteration (JSON array)",
      kind: "textarea" as const,
      placeholder:
        '[{"id":"note","kind":"add-hubspot-note","inputs":{"dealId":"{{trigger.objectId}}","body":"Item: {{loop.item}}"}}]',
      help: "Children run sequentially per iteration. Use {{loop.item}} for the current item, {{loop.index}} for 0-based position.",
      required: true,
    },
  ] satisfies AdminFormField[],
};

export const FOR_EACH_MAX_ITERATIONS = 100;

export const CONTROL_FLOW_PALETTE = [
  delayPaletteEntry,
  stopIfPaletteEntry,
  parallelPaletteEntry,
  forEachPaletteEntry,
];
