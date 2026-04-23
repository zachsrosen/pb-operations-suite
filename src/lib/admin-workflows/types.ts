/**
 * Admin Workflow Builder — shared types for actions, triggers, and runs.
 *
 * See docs/superpowers/specs/2026-04-22-admin-workflow-builder.md
 */

import type { z } from "zod";
import type { AdminWorkflowTriggerType } from "@/generated/prisma/enums";

/**
 * Inngest event name used by the executor. All triggers (manual + webhook
 * fan-out) emit this event; the executor is the single entry point.
 */
export const ADMIN_WORKFLOW_RUN_EVENT = "admin-workflow/run.requested" as const;

/**
 * Payload shape for the executor event. `triggerContext` carries the
 * trigger-specific payload (deal properties, job properties, manual input).
 */
export interface AdminWorkflowRunEventData {
  runId: string;
  workflowId: string;
  triggeredByEmail: string;
  triggerContext: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Context passed to every action handler. `triggerContext` is whatever the
 * trigger produced (e.g. {dealId, propertyName, propertyValue}). `previousOutputs`
 * gives access to outputs from earlier steps (keyed by step name).
 */
export interface AdminActionHandlerContext {
  runId: string;
  workflowId: string;
  triggerContext: Record<string, unknown>;
  previousOutputs: Record<string, unknown>;
  triggeredByEmail: string;
}

/** Form field descriptor for the editor UI. */
export interface AdminFormField {
  key: string;
  label: string;
  /**
   * Field UI kind:
   * - "text" / "textarea" / "email": free text input
   * - "select": single-choice dropdown; requires `options` OR `optionsFrom`
   * - "multiselect": multi-choice dropdown; value stored as comma-separated
   *   string or array. Supports known options + free-form additions.
   */
  kind: "text" | "textarea" | "email" | "select" | "multiselect";
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Static options (for select/multiselect). */
  options?: Array<{ value: string; label: string; group?: string }>;
  /**
   * URL to fetch options from at editor-load time. Response shape:
   *   { options: Array<{ value: string; label: string; group?: string }> }
   */
  optionsFrom?: string;
}

export interface AdminWorkflowAction<TInput = unknown, TOutput = unknown> {
  /** Stable identifier; maps to workflow-kit `action.kind`. */
  kind: string;
  /** Human label shown in the editor palette. */
  name: string;
  /** One-line description shown under the name. */
  description: string;
  /** Category for grouping in the palette (e.g. "Messaging", "HubSpot"). */
  category: string;
  /** Form fields the admin fills in for this action. */
  fields: AdminFormField[];
  /** Zod schema for the action's user-configurable inputs. */
  inputsSchema: z.ZodSchema<TInput>;
  /** Handler run inside an Inngest step. Must be idempotent where possible. */
  handler: (args: {
    inputs: TInput;
    context: AdminActionHandlerContext;
  }) => Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * A trigger definition knows how to (a) render a config form in the editor,
 * and (b) translate a raw event payload into a `triggerContext` object for
 * action handlers.
 */
export interface AdminWorkflowTrigger<TConfig = unknown> {
  kind: AdminWorkflowTriggerType;
  name: string;
  description: string;
  /** Form fields the admin fills in when configuring this trigger. */
  fields: AdminFormField[];
  /** Zod schema for trigger config stored on the workflow. */
  configSchema: z.ZodSchema<TConfig>;
  /**
   * Given an incoming raw webhook/event payload, decide whether this
   * workflow should run and produce the `triggerContext`.
   * Returns `null` to skip.
   */
  match: (args: {
    config: TConfig;
    rawEvent: Record<string, unknown>;
  }) => Record<string, unknown> | null;
}
