"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma/enums";
import type { TriggerLogic } from "@/lib/adders/types";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import TriggerLogicBuilder from "./TriggerLogicBuilder";
import ShopOverrideGrid, {
  hydrateRows,
  normalizeOverrides,
  type ShopOverrideRow,
} from "./ShopOverrideGrid";
import AdderRevisionsDrawer from "./AdderRevisionsDrawer";
import type { SerializedAdder } from "./types";

export interface AdderEditFormProps {
  /** null/undefined → create mode; otherwise edit mode for that adder. */
  adder: SerializedAdder | null;
  open: boolean;
  onClose: () => void;
  /** Whether the current user may write (submit/retire). Read-only form if false. */
  canManage: boolean;
}

type TriageChoice = { label: string; value: string | number | boolean };

type FormState = {
  code: string;
  name: string;
  category: AdderCategory;
  type: AdderType;
  direction: AdderDirection;
  unit: AdderUnit;
  basePrice: string;
  baseCost: string;
  marginTarget: string;
  autoApply: boolean;
  appliesTo: string;
  photosRequired: boolean;
  triageQuestion: string;
  triageAnswerType: TriageAnswerType | "";
  triageChoices: TriageChoice[];
  triggerLogic: TriggerLogic | null;
  notes: string;
  active: boolean;
};

function emptyState(): FormState {
  return {
    code: "",
    name: "",
    category: "MISC",
    type: "FIXED",
    direction: "ADD",
    unit: "FLAT",
    basePrice: "0",
    baseCost: "0",
    marginTarget: "",
    autoApply: false,
    appliesTo: "",
    photosRequired: false,
    triageQuestion: "",
    triageAnswerType: "",
    triageChoices: [],
    triggerLogic: null,
    notes: "",
    active: true,
  };
}

function stateFromAdder(a: SerializedAdder): FormState {
  let choices: TriageChoice[] = [];
  if (Array.isArray(a.triageChoices)) {
    choices = (a.triageChoices as unknown[]).filter(
      (c): c is TriageChoice =>
        typeof c === "object" &&
        c != null &&
        "label" in (c as object) &&
        "value" in (c as object)
    );
  }
  return {
    code: a.code,
    name: a.name,
    category: a.category,
    type: a.type,
    direction: a.direction,
    unit: a.unit,
    basePrice: a.basePrice,
    baseCost: a.baseCost,
    marginTarget: a.marginTarget ?? "",
    autoApply: a.autoApply,
    appliesTo: a.appliesTo ?? "",
    photosRequired: a.photosRequired,
    triageQuestion: a.triageQuestion ?? "",
    triageAnswerType: a.triageAnswerType ?? "",
    triageChoices: choices,
    triggerLogic: (a.triggerLogic as TriggerLogic | null) ?? null,
    notes: a.notes ?? "",
    active: a.active,
  };
}

type Section = {
  id: string;
  label: string;
};

const SECTIONS: Section[] = [
  { id: "basics", label: "Basics" },
  { id: "scope", label: "Scope" },
  { id: "triage", label: "Triage" },
  { id: "overrides", label: "Shop Overrides" },
  { id: "notes", label: "Notes" },
];

const CATEGORY_OPTIONS = Object.values(AdderCategory) as AdderCategory[];
const UNIT_OPTIONS = Object.values(AdderUnit) as AdderUnit[];
const TYPE_OPTIONS = Object.values(AdderType) as AdderType[];
const DIRECTION_OPTIONS = Object.values(AdderDirection) as AdderDirection[];
const TRIAGE_ANSWER_OPTIONS = Object.values(TriageAnswerType) as TriageAnswerType[];

export default function AdderEditForm({
  adder,
  open,
  onClose,
  canManage,
}: AdderEditFormProps) {
  const isEdit = !!adder;
  const qc = useQueryClient();
  const [state, setState] = useState<FormState>(() =>
    adder ? stateFromAdder(adder) : emptyState()
  );
  const [overrideRows, setOverrideRows] = useState<ShopOverrideRow[]>(() =>
    hydrateRows(adder?.overrides ?? [])
  );
  const [changeNote, setChangeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("basics");

  // Reset state when the adder prop changes (different row edited).
  useEffect(() => {
    if (!open) return;
    setState(adder ? stateFromAdder(adder) : emptyState());
    setOverrideRows(hydrateRows(adder?.overrides ?? []));
    setChangeNote("");
    setError(null);
    setActiveSection("basics");
  }, [adder, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const payload = buildPayload(state, overrideRows, isEdit, changeNote);
      const url = isEdit ? `/api/adders/${adder!.id}` : `/api/adders`;
      const method = isEdit ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const body = (await r.json()) as { error?: string; issues?: unknown };
          if (body.error) msg = body.error;
          if (body.issues) msg += `: ${JSON.stringify(body.issues)}`;
        } catch {
          // ignore parse failure
        }
        throw new Error(msg);
      }
      return (await r.json()) as { adder: SerializedAdder };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adders"] });
      if (isEdit && adder)
        qc.invalidateQueries({ queryKey: ["adder-revisions", adder.id] });
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Save failed");
    },
  });

  const retireMutation = useMutation({
    mutationFn: async () => {
      if (!adder) return;
      const r = await fetch(`/api/adders/${adder.id}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adders"] });
      setConfirmRetire(false);
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Retire failed");
    },
  });

  const readOnly = !canManage;

  const triageChoicesJsonPreview = useMemo(
    () => JSON.stringify(state.triageChoices, null, 2),
    [state.triageChoices]
  );

  if (!open) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    if (isEdit && !changeNote.trim()) {
      setError("A change note is required when editing an existing adder.");
      return;
    }
    saveMutation.mutate();
  }

  function scrollSection(id: string) {
    setActiveSection(id);
    document
      .getElementById(`section-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col bg-surface shadow-card-lg">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-t-border bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? `Edit adder: ${adder?.code}` : "New adder"}
            </h2>
            {isEdit && adder && (
              <p className="text-xs text-muted">
                Last updated {new Date(adder.updatedAt).toLocaleString()} by {adder.updatedBy}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                History
              </button>
            )}
            <button
              onClick={onClose}
              className="text-lg leading-none text-muted transition-colors hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Section nav */}
        <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-t-border bg-surface px-3 py-2">
          {SECTIONS.filter((s) => isEdit || s.id !== "overrides").map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollSection(s.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeSection === s.id
                  ? "bg-green-500/15 text-green-500 ring-1 ring-green-500/30"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
            {readOnly && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
                Read-only view. Contact an admin to edit adders.
              </div>
            )}

            {/* Basics */}
            <section id="section-basics" className="space-y-3">
              <SectionHeading title="Basics" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Code (UPPER_SNAKE)" hint={isEdit ? "Code is immutable after creation." : "e.g. MPU_200A"}>
                  <input
                    type="text"
                    required
                    disabled={isEdit || readOnly}
                    value={state.code}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
                      }))
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Name">
                  <input
                    type="text"
                    required
                    disabled={readOnly}
                    value={state.name}
                    onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Category">
                  <select
                    disabled={readOnly}
                    value={state.category}
                    onChange={(e) =>
                      setState((s) => ({ ...s, category: e.target.value as AdderCategory }))
                    }
                    className={inputCls}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select
                    disabled={readOnly}
                    value={state.type}
                    onChange={(e) =>
                      setState((s) => ({ ...s, type: e.target.value as AdderType }))
                    }
                    className={inputCls}
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Direction">
                  <select
                    disabled={readOnly}
                    value={state.direction}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        direction: e.target.value as AdderDirection,
                      }))
                    }
                    className={inputCls}
                  >
                    {DIRECTION_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d === "ADD" ? "+ ADD" : "− DISCOUNT"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Unit">
                  <select
                    disabled={readOnly}
                    value={state.unit}
                    onChange={(e) =>
                      setState((s) => ({ ...s, unit: e.target.value as AdderUnit }))
                    }
                    className={inputCls}
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={state.type === "PERCENTAGE" ? "Base rate (%)" : "Base price ($)"}
                >
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    disabled={readOnly}
                    value={state.basePrice}
                    onChange={(e) =>
                      setState((s) => ({ ...s, basePrice: e.target.value }))
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Base cost ($)">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    disabled={readOnly}
                    value={state.baseCost}
                    onChange={(e) =>
                      setState((s) => ({ ...s, baseCost: e.target.value }))
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Margin target (%)" hint="Optional">
                  <input
                    type="number"
                    step="any"
                    disabled={readOnly}
                    value={state.marginTarget}
                    onChange={(e) =>
                      setState((s) => ({ ...s, marginTarget: e.target.value }))
                    }
                    className={inputCls}
                  />
                </Field>
                {isEdit && (
                  <Field label="Active">
                    <label className="mt-2 inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={state.active}
                        onChange={(e) =>
                          setState((s) => ({ ...s, active: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-t-border text-green-600 focus:ring-green-500/40"
                      />
                      Adder is active
                    </label>
                  </Field>
                )}
              </div>
            </section>

            {/* Scope */}
            <section id="section-scope" className="space-y-3">
              <SectionHeading title="Scope" />
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={state.autoApply}
                  onChange={(e) =>
                    setState((s) => ({ ...s, autoApply: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-t-border text-green-600 focus:ring-green-500/40"
                />
                Auto-apply (adder applies automatically when condition matches)
              </label>
              <Field
                label="Applies-to predicate"
                hint="Syntax examples: shop == 'DTC' | deal.dealType == 'PE' | deal.valueCents > 50000. Leave empty for no auto-apply scoping."
              >
                <input
                  type="text"
                  disabled={readOnly}
                  value={state.appliesTo}
                  onChange={(e) =>
                    setState((s) => ({ ...s, appliesTo: e.target.value }))
                  }
                  className={inputCls}
                  placeholder="shop == 'DTC'"
                />
              </Field>
            </section>

            {/* Triage */}
            <section id="section-triage" className="space-y-3">
              <SectionHeading title="Triage" />
              <Field label="Triage question">
                <textarea
                  disabled={readOnly}
                  rows={2}
                  value={state.triageQuestion}
                  onChange={(e) =>
                    setState((s) => ({ ...s, triageQuestion: e.target.value }))
                  }
                  className={inputCls}
                  placeholder="Is the main panel less than 200A?"
                />
              </Field>
              <Field label="Answer type">
                <select
                  disabled={readOnly}
                  value={state.triageAnswerType}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      triageAnswerType: (e.target.value as TriageAnswerType) || "",
                    }))
                  }
                  className={inputCls}
                >
                  <option value="">(none)</option>
                  {TRIAGE_ANSWER_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              {state.triageAnswerType === "CHOICE" && (
                <Field
                  label="Choices"
                  hint="One per row; label and value (string, number, or boolean)."
                >
                  <div className="space-y-2">
                    {state.triageChoices.map((c, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          disabled={readOnly}
                          placeholder="Label"
                          value={c.label}
                          onChange={(e) =>
                            setState((s) => ({
                              ...s,
                              triageChoices: s.triageChoices.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x
                              ),
                            }))
                          }
                          className={inputCls}
                        />
                        <input
                          type="text"
                          disabled={readOnly}
                          placeholder="Value"
                          value={String(c.value)}
                          onChange={(e) =>
                            setState((s) => ({
                              ...s,
                              triageChoices: s.triageChoices.map((x, j) =>
                                j === i ? { ...x, value: e.target.value } : x
                              ),
                            }))
                          }
                          className={inputCls}
                        />
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() =>
                              setState((s) => ({
                                ...s,
                                triageChoices: s.triageChoices.filter((_, j) => j !== i),
                              }))
                            }
                            className="rounded-md border border-t-border bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() =>
                          setState((s) => ({
                            ...s,
                            triageChoices: [...s.triageChoices, { label: "", value: "" }],
                          }))
                        }
                        className="rounded-md border border-dashed border-t-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                      >
                        + Add choice
                      </button>
                    )}
                    <details className="text-xs text-muted">
                      <summary className="cursor-pointer select-none">JSON preview</summary>
                      <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-[11px] text-foreground">
                        {triageChoicesJsonPreview}
                      </pre>
                    </details>
                  </div>
                </Field>
              )}

              <Field label="Trigger logic">
                <TriggerLogicBuilder
                  value={state.triggerLogic}
                  onChange={(tl) =>
                    setState((s) => ({ ...s, triggerLogic: tl }))
                  }
                  triageQuestion={state.triageQuestion}
                  triageAnswerType={state.triageAnswerType || null}
                />
              </Field>

              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={state.photosRequired}
                  onChange={(e) =>
                    setState((s) => ({ ...s, photosRequired: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-t-border text-green-600 focus:ring-green-500/40"
                />
                Require photo when this adder is triggered
              </label>
            </section>

            {/* Overrides */}
            {isEdit && (
              <section id="section-overrides" className="space-y-3">
                <SectionHeading title="Shop Overrides" />
                <ShopOverrideGrid
                  value={overrideRows}
                  onChange={setOverrideRows}
                  disabled={readOnly}
                />
              </section>
            )}

            {/* Notes */}
            <section id="section-notes" className="space-y-3">
              <SectionHeading title="Notes" />
              <textarea
                disabled={readOnly}
                rows={4}
                value={state.notes}
                onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
                className={inputCls}
                placeholder="Internal notes about this adder…"
              />
            </section>

            {isEdit && !readOnly && (
              <Field
                label="Change note (required)"
                hint="What's changing and why — shows up in the revision history."
              >
                <input
                  type="text"
                  required
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. DTC pricing delta adjusted after April review"
                />
              </Field>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-t-border bg-surface-2 px-5 py-3">
            <div>
              {isEdit && canManage && state.active && (
                <button
                  type="button"
                  onClick={() => setConfirmRetire(true)}
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Retire adder
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              {canManage && (
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white shadow-card transition-colors hover:bg-green-500 disabled:opacity-60"
                >
                  {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create adder"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {isEdit && (
        <AdderRevisionsDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          adderId={adder?.id ?? null}
          adderCode={adder?.code}
        />
      )}

      <ConfirmDialog
        open={confirmRetire}
        title={`Retire ${adder?.code ?? "adder"}?`}
        message="Retiring sets the adder inactive. It won't appear in triage or auto-apply until reactivated. You can reactivate it later from the edit form."
        confirmLabel={retireMutation.isPending ? "Retiring…" : "Retire"}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => retireMutation.mutate()}
        onCancel={() => setConfirmRetire(false)}
      />
    </>
  );
}

// --- helpers ---------------------------------------------------------------

const inputCls =
  "w-full rounded-md border border-t-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-60";

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
      {title}
    </h3>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </label>
  );
}

/**
 * Assemble the API payload from form state. Exported for unit testing.
 */
export function buildPayload(
  state: FormState,
  overrideRows: ShopOverrideRow[],
  isEdit: boolean,
  changeNote: string
): Record<string, unknown> {
  const basePrice = Number(state.basePrice);
  const baseCost = Number(state.baseCost);
  const marginTarget =
    state.marginTarget.trim() === "" ? null : Number(state.marginTarget);

  const base: Record<string, unknown> = {
    code: state.code,
    name: state.name,
    category: state.category,
    type: state.type,
    direction: state.direction,
    unit: state.unit,
    basePrice,
    baseCost,
    marginTarget,
    autoApply: state.autoApply,
    appliesTo: state.appliesTo.trim() === "" ? null : state.appliesTo,
    photosRequired: state.photosRequired,
    triageQuestion:
      state.triageQuestion.trim() === "" ? null : state.triageQuestion,
    triageAnswerType: state.triageAnswerType || null,
    triageChoices:
      state.triageChoices.length > 0 ? state.triageChoices : null,
    triggerLogic: state.triggerLogic ?? null,
    notes: state.notes.trim() === "" ? null : state.notes,
  };

  if (isEdit) {
    base.active = state.active;
    base.changeNote = changeNote;
    base.overrides = normalizeOverrides(overrideRows);
  }

  return base;
}
