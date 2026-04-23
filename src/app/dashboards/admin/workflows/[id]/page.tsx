"use client";

/**
 * Admin Workflows — editor page.
 *
 * Form-based editor for a single workflow: name/description, trigger
 * configuration, step list (add/remove actions and fill their inputs),
 * status control, run-now button, and recent run history.
 *
 * Visual graph editor using @inngest/workflow-kit is a Phase 3 follow-up.
 */

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import DashboardShell from "@/components/DashboardShell";

type FieldKind = "text" | "textarea" | "email" | "select" | "multiselect";

interface FieldOption {
  value: string;
  label: string;
  group?: string;
}

interface FormField {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: FieldOption[];
  optionsFrom?: string;
}

interface ActionMeta {
  kind: string;
  name: string;
  description: string;
  category: string;
  fields: FormField[];
}

interface TriggerMeta {
  kind: "MANUAL" | "HUBSPOT_PROPERTY_CHANGE" | "ZUPER_PROPERTY_CHANGE" | "CRON";
  name: string;
  description: string;
  fields: FormField[];
}

interface Palette {
  actions: ActionMeta[];
  triggers: TriggerMeta[];
}

interface Step {
  id: string;
  kind: string;
  inputs: Record<string, string>;
}

interface WorkflowRun {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  triggeredByEmail: string;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  triggerType: "MANUAL" | "HUBSPOT_PROPERTY_CHANGE" | "ZUPER_PROPERTY_CHANGE" | "CRON";
  triggerConfig: Record<string, unknown>;
  definition: { steps: Step[] };
  createdBy: { email: string; name: string | null };
  runs: WorkflowRun[];
}

const RUN_STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-blue-400",
  SUCCEEDED: "text-green-400",
  FAILED: "text-red-400",
};

export default function AdminWorkflowEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [wfRes, palRes] = await Promise.all([
        fetch(`/api/admin/workflows/${id}`),
        fetch(`/api/admin/workflows/palette`),
      ]);
      if (!wfRes.ok) throw new Error(`Workflow load ${wfRes.status}`);
      if (!palRes.ok) throw new Error(`Palette load ${palRes.status}`);
      const wfData = await wfRes.json();
      const palData = await palRes.json();
      setWorkflow(wfData.workflow);
      setPalette(palData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <DashboardShell title="Admin Workflows" accentColor="purple">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
          <div className="mt-4">
            <Link href="/dashboards/admin/workflows" className="text-purple-400 hover:underline text-sm">
              ← Back to list
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (!workflow || !palette) {
    return (
      <DashboardShell title="Admin Workflows" accentColor="purple">
        <div className="max-w-3xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
      </DashboardShell>
    );
  }

  async function save() {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description,
          triggerConfig: workflow.triggerConfig,
          definition: workflow.definition,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      }
      setToast("Saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: Workflow["status"]) {
    if (!workflow) return;
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWorkflow((prev) => (prev ? { ...prev, status } : prev));
      setToast(`Workflow ${status.toLowerCase()}`);
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runNow() {
    if (!workflow) return;
    setRunning(true);
    setError(null);
    try {
      // For non-MANUAL triggers, allow the admin to pass test context
      let triggerContext: Record<string, unknown> = {};
      if (workflow.triggerType !== "MANUAL") {
        const raw = prompt(
          "Enter test trigger context (JSON). Example: {\"objectId\":\"123\",\"propertyName\":\"dealstage\",\"propertyValue\":\"456\"}",
          "{}",
        );
        if (raw == null) {
          setRunning(false);
          return;
        }
        try {
          triggerContext = JSON.parse(raw);
        } catch {
          setError("Invalid JSON in trigger context");
          setRunning(false);
          return;
        }
      }

      const res = await fetch(`/api/admin/workflows/${id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ triggerContext }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      setToast(`Run queued: ${body.runId}`);
      setTimeout(() => setToast(null), 3000);
      // Refresh after a short delay so the run appears in history
      setTimeout(load, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function deleteWorkflow() {
    if (!confirm("Delete this workflow permanently? This also deletes its run history.")) return;
    await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
    router.push("/dashboards/admin/workflows");
  }

  function updateStep(stepIdx: number, next: Step) {
    setWorkflow((prev) => {
      if (!prev) return prev;
      const steps = [...prev.definition.steps];
      steps[stepIdx] = next;
      return { ...prev, definition: { steps } };
    });
  }

  function removeStep(stepIdx: number) {
    setWorkflow((prev) => {
      if (!prev) return prev;
      const steps = prev.definition.steps.filter((_, i) => i !== stepIdx);
      return { ...prev, definition: { steps } };
    });
  }

  function moveStep(stepIdx: number, direction: -1 | 1) {
    setWorkflow((prev) => {
      if (!prev) return prev;
      const steps = [...prev.definition.steps];
      const target = stepIdx + direction;
      if (target < 0 || target >= steps.length) return prev;
      [steps[stepIdx], steps[target]] = [steps[target], steps[stepIdx]];
      return { ...prev, definition: { steps } };
    });
  }

  function addStep(kind: string) {
    setWorkflow((prev) => {
      if (!prev) return prev;
      const action = palette?.actions.find((a) => a.kind === kind);
      if (!action) return prev;
      const stepId = `step${prev.definition.steps.length + 1}`;
      const inputs: Record<string, string> = {};
      for (const field of action.fields) inputs[field.key] = "";
      return {
        ...prev,
        definition: {
          steps: [...prev.definition.steps, { id: stepId, kind, inputs }],
        },
      };
    });
  }

  const currentTriggerMeta = palette.triggers.find((t) => t.kind === workflow.triggerType);

  return (
    <DashboardShell title={workflow.name} accentColor="purple">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboards/admin/workflows" className="text-sm text-muted hover:text-foreground">
            ← Back to list
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-2 py-1 rounded text-xs ${
              workflow.status === "ACTIVE" ? "bg-green-500/20 text-green-300"
              : workflow.status === "DRAFT" ? "bg-zinc-500/20 text-zinc-300"
              : "bg-amber-500/20 text-amber-300"
            }`}>
              {workflow.status}
            </span>
            {workflow.status !== "ACTIVE" && (
              <button onClick={() => setStatus("ACTIVE")} className="text-green-400 hover:text-green-300 px-2 py-1">
                Activate
              </button>
            )}
            {workflow.status === "ACTIVE" && (
              <button onClick={() => setStatus("DRAFT")} className="text-zinc-400 hover:text-zinc-300 px-2 py-1">
                Pause (back to DRAFT)
              </button>
            )}
            {workflow.status !== "ARCHIVED" && (
              <button onClick={() => setStatus("ARCHIVED")} className="text-amber-400 hover:text-amber-300 px-2 py-1">
                Archive
              </button>
            )}
            <button onClick={deleteWorkflow} className="text-red-400 hover:text-red-300 px-2 py-1">
              Delete
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
        {toast && (
          <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-300">{toast}</div>
        )}

        {/* Basics */}
        <section className="rounded-md border border-t-border bg-surface p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Basics</h2>
          <div>
            <label className="block text-xs text-muted mb-1">Name</label>
            <input
              type="text"
              value={workflow.name}
              onChange={(e) => setWorkflow((w) => (w ? { ...w, name: e.target.value } : w))}
              className="w-full rounded-md bg-surface-2 border border-t-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Description</label>
            <textarea
              value={workflow.description ?? ""}
              onChange={(e) => setWorkflow((w) => (w ? { ...w, description: e.target.value || null } : w))}
              rows={2}
              className="w-full rounded-md bg-surface-2 border border-t-border px-3 py-2 text-sm"
            />
          </div>
        </section>

        {/* Trigger */}
        <section className="rounded-md border border-t-border bg-surface p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Trigger</h2>
            <span className="text-xs text-muted">{workflow.triggerType}</span>
          </div>
          {currentTriggerMeta && (
            <p className="text-xs text-muted">{currentTriggerMeta.description}</p>
          )}
          {(currentTriggerMeta?.fields ?? []).length === 0 ? (
            <p className="text-xs text-muted italic">No configuration required.</p>
          ) : (
            <div className="space-y-3">
              {currentTriggerMeta!.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={String(workflow.triggerConfig[f.key] ?? "")}
                  siblingValues={workflow.triggerConfig}
                  onChange={(v) =>
                    setWorkflow((w) => {
                      if (!w) return w;
                      return {
                        ...w,
                        triggerConfig: { ...w.triggerConfig, [f.key]: v },
                      };
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Steps */}
        <section className="rounded-md border border-t-border bg-surface p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Steps</h2>
          {workflow.definition.steps.length === 0 ? (
            <p className="text-xs text-muted italic">No steps yet. Add one below.</p>
          ) : (
            <div className="space-y-4">
              {workflow.definition.steps.map((step, idx) => {
                const action = palette.actions.find((a) => a.kind === step.kind);
                return (
                  <div key={idx} className="rounded-md border border-t-border bg-surface-2 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {idx + 1}. {action?.name ?? step.kind}
                        </p>
                        <p className="text-xs text-muted mt-0.5">{action?.description}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <button
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          className="text-muted hover:text-foreground disabled:opacity-30"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === workflow.definition.steps.length - 1}
                          className="text-muted hover:text-foreground disabled:opacity-30"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => removeStep(idx)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {action?.fields.map((f) => (
                      <FieldInput
                        key={f.key}
                        field={f}
                        value={step.inputs[f.key] ?? ""}
                        siblingValues={step.inputs}
                        onChange={(v) => {
                          const next: Step = { ...step, inputs: { ...step.inputs, [f.key]: v } };
                          updateStep(idx, next);
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add step dropdown */}
          <div className="pt-2">
            <label className="text-xs text-muted">Add step:</label>
            <select
              className="ml-2 rounded-md bg-surface-2 border border-t-border px-2 py-1 text-sm"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  addStep(e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="">Choose an action…</option>
              {Array.from(new Set(palette.actions.map((a) => a.category))).map((cat) => (
                <optgroup key={cat} label={cat}>
                  {palette.actions
                    .filter((a) => a.category === cat)
                    .map((a) => (
                      <option key={a.kind} value={a.kind}>
                        {a.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        </section>

        {/* Save / Run */}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium transition"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={runNow}
            disabled={running || workflow.status !== "ACTIVE"}
            className="rounded-md bg-green-600 hover:bg-green-500 disabled:opacity-40 px-4 py-2 text-sm text-white font-medium transition"
            title={workflow.status !== "ACTIVE" ? "Activate first" : "Trigger a manual run"}
          >
            {running ? "Queueing…" : "Run now"}
          </button>
        </div>

        {/* Recent runs */}
        <section className="rounded-md border border-t-border bg-surface p-6 space-y-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Recent runs ({workflow.runs.length})
          </h2>
          {workflow.runs.length === 0 ? (
            <p className="text-xs text-muted italic">No runs yet.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {workflow.runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/dashboards/admin/workflows/runs/${run.id}`}
                  className="flex items-center justify-between rounded-md bg-surface-2 hover:bg-surface-elevated px-3 py-2 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`font-medium ${RUN_STATUS_COLORS[run.status]}`}>{run.status}</span>
                    <span className="text-muted truncate">
                      {new Date(run.startedAt).toLocaleString()} · by {run.triggeredByEmail}
                    </span>
                    {run.errorMessage && (
                      <span className="text-red-300 truncate">· {run.errorMessage}</span>
                    )}
                  </div>
                  <span className="text-muted text-right">
                    {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

/**
 * Module-scoped cache for options loaded via `optionsFrom` URLs.
 * Keyed by the fully-resolved URL (after template substitution).
 */
const optionsCache = new Map<string, Promise<FieldOption[]>>();

function loadOptions(resolvedUrl: string): Promise<FieldOption[]> {
  const cached = optionsCache.get(resolvedUrl);
  if (cached) return cached;
  const promise = fetch(resolvedUrl)
    .then((r) => r.json())
    .then((d: { options?: FieldOption[] }) => d.options ?? [])
    .catch(() => []);
  optionsCache.set(resolvedUrl, promise);
  return promise;
}

/**
 * Resolve `{{fieldKey}}` tokens in `optionsFrom` against the current form
 * state. Returns null if any token resolves to empty — caller should skip
 * fetching (the multiselect will show "no options" and admin can still
 * type a custom value).
 */
function resolveOptionsFromUrl(
  template: string,
  values: Record<string, unknown>,
): string | null {
  let allResolved = true;
  const resolved = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = values[key];
    if (v == null || v === "") {
      allResolved = false;
      return "";
    }
    return encodeURIComponent(String(v));
  });
  return allResolved ? resolved : null;
}

function useDynamicOptions(
  field: FormField,
  siblingValues: Record<string, unknown>,
): FieldOption[] {
  const [dynamic, setDynamic] = useState<FieldOption[]>([]);
  const resolvedUrl = field.optionsFrom
    ? resolveOptionsFromUrl(field.optionsFrom, siblingValues)
    : null;

  useEffect(() => {
    if (!resolvedUrl) {
      setDynamic([]);
      return;
    }
    let cancelled = false;
    loadOptions(resolvedUrl).then((opts) => {
      if (!cancelled) setDynamic(opts);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedUrl]);

  return field.optionsFrom ? dynamic : (field.options ?? []);
}

function FieldInput({
  field,
  value,
  onChange,
  siblingValues,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  /**
   * Values of sibling fields in the same form section (trigger config OR
   * a single step's inputs). Used to resolve `{{fieldKey}}` template tokens
   * in `optionsFrom` URLs — e.g. the propertyValuesIn multiselect re-fetches
   * when objectType or propertyName change.
   */
  siblingValues?: Record<string, unknown>;
}) {
  const cls = "w-full rounded-md bg-surface-2 border border-t-border px-3 py-2 text-sm";
  const options = useDynamicOptions(field, siblingValues ?? {});

  return (
    <div>
      <label className="block text-xs text-muted mb-1">
        {field.label} {field.required ? <span className="text-red-400">*</span> : null}
      </label>

      {field.kind === "textarea" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={cls}
        />
      )}

      {field.kind === "select" && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          <option value="">{field.placeholder ?? "— choose —"}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.group ? `${o.group}: ${o.label}` : o.label}
            </option>
          ))}
        </select>
      )}

      {field.kind === "multiselect" && (
        <MultiselectInput
          value={value}
          options={options}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      )}

      {(field.kind === "text" || field.kind === "email") && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={cls}
        />
      )}

      {field.help && <p className="mt-1 text-xs text-muted">{field.help}</p>}
    </div>
  );
}

function MultiselectInput({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: FieldOption[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Value is stored as a comma-separated string to match existing schema
  // behavior. The Zod preprocess on the server splits it to array.
  const selected = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function toggle(optValue: string) {
    const set = new Set(selected);
    if (set.has(optValue)) set.delete(optValue);
    else set.add(optValue);
    onChange([...set].join(","));
  }

  const grouped: Record<string, FieldOption[]> = {};
  for (const o of options) {
    const g = o.group ?? "";
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(o);
  }
  const groupNames = Object.keys(grouped);

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      <div className="flex flex-wrap gap-1 min-h-[1.75rem]">
        {selected.length === 0 ? (
          <span className="text-xs text-muted italic">
            {placeholder ?? "None selected — fires on any value"}
          </span>
        ) : (
          selected.map((v) => {
            const opt = options.find((o) => o.value === v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded bg-purple-500/20 text-purple-200 px-2 py-0.5 text-xs"
              >
                {opt ? opt.label : v}
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  className="text-purple-300 hover:text-purple-100"
                  aria-label={`Remove ${v}`}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>

      {/* Option list */}
      {options.length === 0 ? (
        <p className="text-xs text-muted italic">Loading options…</p>
      ) : (
        <div className="rounded-md border border-t-border bg-surface-2 p-2 max-h-48 overflow-y-auto">
          {groupNames.map((g) => (
            <div key={g || "_"} className="mb-1 last:mb-0">
              {g && (
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">{g}</p>
              )}
              <div className="space-y-1">
                {grouped[g].map((o) => {
                  const checked = selected.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-surface-elevated rounded px-1 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(o.value)}
                      />
                      <span className="flex-1">{o.label}</span>
                      <span className="text-xs text-zinc-500 font-mono">{o.value}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Free-form add */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">Add custom value:</span>
        <input
          type="text"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v && !selected.includes(v)) {
                onChange([...selected, v].join(","));
                (e.target as HTMLInputElement).value = "";
              }
              e.preventDefault();
            }
          }}
          placeholder="Type ID, press Enter"
          className="flex-1 rounded bg-surface-2 border border-t-border px-2 py-1"
        />
      </div>
    </div>
  );
}
