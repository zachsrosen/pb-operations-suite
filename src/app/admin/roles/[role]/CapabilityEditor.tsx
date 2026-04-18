"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Per-role capability editor. Each capability has three states:
 *   - "inherit" (null)       — follow the code default from src/lib/roles.ts
 *   - "override-true" (true) — force ON regardless of code default
 *   - "override-false" (false) — force OFF regardless of code default
 *
 * The UI renders a tri-state selector (radio buttons) for each capability so
 * admins can see and explicitly choose each state. Saving posts the entire
 * capabilities payload — null values wipe those fields, wholly-null bodies
 * delete the row (via the Reset button → DELETE).
 */

type CapabilityKey =
  | "canScheduleSurveys"
  | "canScheduleInstalls"
  | "canScheduleInspections"
  | "canSyncZuper"
  | "canManageUsers"
  | "canManageAvailability"
  | "canEditDesign"
  | "canEditPermitting"
  | "canViewAllLocations";

const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "canScheduleSurveys",
  "canScheduleInstalls",
  "canScheduleInspections",
  "canSyncZuper",
  "canManageUsers",
  "canManageAvailability",
  "canEditDesign",
  "canEditPermitting",
  "canViewAllLocations",
] as const;

const CAPABILITY_LABELS: Record<CapabilityKey, { label: string; description: string }> = {
  canScheduleSurveys: {
    label: "Schedule surveys",
    description: "Can book survey appointments and manage survey calendar.",
  },
  canScheduleInstalls: {
    label: "Schedule installations",
    description: "Can book install appointments and manage install calendar.",
  },
  canScheduleInspections: {
    label: "Schedule inspections",
    description: "Can book and reschedule inspection appointments.",
  },
  canSyncZuper: {
    label: "Sync to Zuper",
    description: "Can push jobs and status updates to the Zuper field-service system.",
  },
  canManageUsers: {
    label: "Manage users",
    description: "Can create, edit, and update roles for other users in the admin console.",
  },
  canManageAvailability: {
    label: "Manage crew availability",
    description: "Can edit crew schedules and availability overrides.",
  },
  canEditDesign: {
    label: "Edit design reviews",
    description: "Can approve, reject, and annotate design reviews.",
  },
  canEditPermitting: {
    label: "Edit permitting",
    description: "Can update permitting status, AHJ assignments, and utility details.",
  },
  canViewAllLocations: {
    label: "View all locations",
    description: "Sees data across every location instead of being scoped to their own.",
  },
};

type OverrideValue = boolean | null;

type FormState = Record<CapabilityKey, OverrideValue>;

function stateFromOverride(
  override: Partial<Record<CapabilityKey, boolean | null>> | null,
): FormState {
  const initial = {} as FormState;
  for (const key of CAPABILITY_KEYS) {
    initial[key] = (override?.[key] ?? null) as OverrideValue;
  }
  return initial;
}

export default function CapabilityEditor({
  role,
  codeDefaults,
  initialOverride,
}: {
  role: UserRole;
  codeDefaults: Record<CapabilityKey, boolean>;
  initialOverride: Partial<Record<CapabilityKey, boolean | null>> | null;
}) {
  const router = useRouter();
  const initial = useMemo(() => stateFromOverride(initialOverride), [initialOverride]);
  const [form, setForm] = useState<FormState>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(() => {
    for (const key of CAPABILITY_KEYS) {
      if (form[key] !== initial[key]) return true;
    }
    return false;
  }, [form, initial]);

  const hasAnyOverride = useMemo(
    () => CAPABILITY_KEYS.some((k) => form[k] !== null),
    [form],
  );

  async function handleSave() {
    setError(null);
    setSaved(false);
    const body = { capabilities: form };
    try {
      const res = await fetch(`/api/admin/roles/${role}/capabilities`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSaved(true);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  async function handleReset() {
    if (!confirm(`Reset all overrides for ${role}? This reverts every capability to the code default.`)) {
      return;
    }
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/roles/${role}/capabilities`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Reset failed (${res.status})`);
        return;
      }
      // Clear local form and refresh server data
      const cleared = {} as FormState;
      for (const key of CAPABILITY_KEYS) cleared[key] = null;
      setForm(cleared);
      setSaved(true);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-t-border/60 bg-surface p-4 text-sm">
        <p className="text-foreground">
          Each capability is one of three states: <strong>Inherit</strong> (follow the code default in{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">src/lib/roles.ts</code>), force{" "}
          <strong>On</strong>, or force <strong>Off</strong>. Overrides only change capabilities — route
          access is still governed by the role&apos;s allowed-routes list and cannot be changed here.
        </p>
      </div>

      <ul className="space-y-2">
        {CAPABILITY_KEYS.map((key) => {
          const codeDefault = codeDefaults[key];
          const current = form[key];
          const effective = current === null ? codeDefault : current;
          const { label, description } = CAPABILITY_LABELS[key];
          return (
            <li
              key={key}
              className="rounded-lg border border-t-border/60 bg-surface p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">{key}</span>
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        effective
                          ? "border-green-500/30 bg-green-500/10 text-green-400"
                          : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      Effective: {effective ? "On" : "Off"}
                    </span>
                    <span className="text-[10px] text-muted">
                      (code default: {codeDefault ? "On" : "Off"})
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 text-xs text-muted">{description}</p>
                </div>

                <fieldset className="flex gap-1 rounded-lg border border-t-border/60 bg-surface-2 p-1 text-xs">
                  <legend className="sr-only">{label}</legend>
                  {([
                    { value: null, label: "Inherit" },
                    { value: true, label: "On" },
                    { value: false, label: "Off" },
                  ] as const).map((opt) => {
                    const active = current === opt.value;
                    return (
                      <label
                        key={String(opt.value)}
                        className={`cursor-pointer rounded px-3 py-1 font-medium transition ${
                          active
                            ? opt.value === null
                              ? "bg-zinc-600/40 text-foreground"
                              : opt.value
                                ? "bg-green-600/30 text-green-200"
                                : "bg-red-600/30 text-red-200"
                            : "text-muted hover:bg-surface"
                        }`}
                      >
                        <input
                          type="radio"
                          name={key}
                          className="sr-only"
                          checked={active}
                          onChange={() =>
                            setForm((prev) => ({ ...prev, [key]: opt.value }))
                          }
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </fieldset>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 rounded-lg border border-t-border/60 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs">
          {error && <span className="text-red-400">{error}</span>}
          {saved && !error && <span className="text-green-400">Saved</span>}
          {!error && !saved && isDirty && (
            <span className="text-muted">Unsaved changes</span>
          )}
          {!error && !saved && !isDirty && !hasAnyOverride && (
            <span className="text-muted">No overrides — inheriting all code defaults.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending || !hasAnyOverride}
            className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save overrides"}
          </button>
        </div>
      </div>
    </div>
  );
}
