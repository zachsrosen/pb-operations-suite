"use client";

import { useMemo } from "react";
import type { TriggerLogic } from "@/lib/adders/types";
import type { TriageAnswerType } from "@/generated/prisma/enums";

// Re-export types used by parent for convenience.
export type { TriggerLogic };

export interface TriggerLogicBuilderProps {
  /** Current predicate value. Null when not set. */
  value: TriggerLogic | null;
  /** Invoked on any field change. Pass `null` to clear. */
  onChange: (next: TriggerLogic | null) => void;
  /** Whether the associated triage question is populated. Disables the builder when empty. */
  triageQuestion: string | null | undefined;
  /** Drives value field coercion (numeric input vs text vs boolean). */
  triageAnswerType: TriageAnswerType | null | undefined;
  /** Optional id override. */
  id?: string;
}

const OPS: Array<{ op: TriggerLogic["op"]; label: string }> = [
  { op: "lt", label: "< (less than)" },
  { op: "lte", label: "≤ (less or equal)" },
  { op: "eq", label: "= (equals)" },
  { op: "gte", label: "≥ (greater or equal)" },
  { op: "gt", label: "> (greater than)" },
  { op: "contains", label: "contains" },
  { op: "truthy", label: "is truthy (any non-empty answer)" },
];

/**
 * Pure helper: build a normalized preview JSON string from a predicate.
 * Exposed so unit tests can exercise it without rendering React.
 */
export function triggerLogicPreview(value: TriggerLogic | null): string {
  if (!value) return "null";
  // Strip undefined + keep key order stable for a human-readable preview.
  const out: Record<string, unknown> = { op: value.op };
  if (value.value !== undefined) out.value = value.value;
  if (value.qtyFrom !== undefined) out.qtyFrom = value.qtyFrom;
  if (value.qtyConstant !== undefined) out.qtyConstant = value.qtyConstant;
  return JSON.stringify(out);
}

/** Coerce a raw string input into the appropriate value type for a predicate. */
export function coerceValueInput(
  raw: string,
  answerType: TriageAnswerType | null | undefined
): TriggerLogic["value"] {
  if (raw === "") return "";
  if (answerType === "NUMERIC" || answerType === "MEASUREMENT") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (answerType === "BOOLEAN") {
    return raw === "true";
  }
  return raw;
}

export default function TriggerLogicBuilder(props: TriggerLogicBuilderProps) {
  const { value, onChange, triageQuestion, triageAnswerType } = props;

  const disabled = !triageQuestion || triageQuestion.trim() === "";
  const op: TriggerLogic["op"] = value?.op ?? "lt";
  const qtyFrom: "answer" | "constant" = value?.qtyFrom ?? "constant";
  const preview = useMemo(() => triggerLogicPreview(value), [value]);

  function patch(next: Partial<TriggerLogic>) {
    const merged: TriggerLogic = {
      op,
      ...(value ?? {}),
      ...next,
    };
    // Clear value field when op=truthy
    if (merged.op === "truthy") {
      delete (merged as Record<string, unknown>).value;
    }
    onChange(merged);
  }

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed border-t-border bg-surface-2 p-3 text-xs text-muted">
        Trigger logic is disabled until you set a Triage Question.
      </div>
    );
  }

  const showValueInput = op !== "truthy";
  const valueInputType =
    triageAnswerType === "NUMERIC" || triageAnswerType === "MEASUREMENT" ? "number" : "text";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Operator</span>
          <select
            className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40"
            value={op}
            onChange={(e) => patch({ op: e.target.value as TriggerLogic["op"] })}
          >
            {OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {showValueInput && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Value</span>
            {triageAnswerType === "BOOLEAN" ? (
              <select
                className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40"
                value={String(value?.value ?? "true")}
                onChange={(e) => patch({ value: e.target.value === "true" })}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={valueInputType}
                className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40"
                value={value?.value == null ? "" : String(value.value)}
                onChange={(e) =>
                  patch({ value: coerceValueInput(e.target.value, triageAnswerType) })
                }
                placeholder={valueInputType === "number" ? "e.g. 200" : "e.g. tile"}
              />
            )}
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Qty source</span>
          <select
            className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40"
            value={qtyFrom}
            onChange={(e) =>
              patch({ qtyFrom: e.target.value as "answer" | "constant" })
            }
          >
            <option value="constant">constant</option>
            <option value="answer">from answer</option>
          </select>
        </label>
      </div>

      {qtyFrom === "constant" && (
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-muted">Qty constant</span>
          <input
            type="number"
            className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40"
            value={value?.qtyConstant ?? 1}
            onChange={(e) => patch({ qtyConstant: Number(e.target.value) })}
            min={0}
            step="any"
          />
        </label>
      )}

      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">Preview JSON</summary>
        <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-[11px] text-foreground">{preview}</pre>
      </details>

      {value && (
        <button
          type="button"
          className="text-xs text-muted underline hover:text-foreground"
          onClick={() => onChange(null)}
        >
          Clear logic
        </button>
      )}
    </div>
  );
}

