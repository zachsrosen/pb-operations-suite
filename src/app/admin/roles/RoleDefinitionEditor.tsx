"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/generated/prisma/enums";
import type { RoleDefinition } from "@/lib/roles";
import {
  type RoleDefinitionOverridePayload,
  type GuardViolation,
  type ScopeValue,
} from "@/lib/role-override-types";
import {
  BasicsCard,
  LandingCardsCard,
  RoutesCard,
  SuitesCard,
  type FormState,
} from "./_definition-editor-sections";

/**
 * Admin UI for editing a role's full definition (routes, suites, landing cards,
 * badge, label, description, scope, visibleInPicker). Mirrors the tri-state
 * inherit/override pattern from CapabilityEditor — present key in the payload
 * means "override with this value"; absent key means "inherit code default".
 *
 * Form state tracks, for each field, whether the admin has set an override.
 * On save, only fields with an active override are included in the payload.
 * Save posts to PUT /api/admin/roles/[role]/definition.
 *
 * Subcomponents (BasicsCard, SuitesCard, RoutesCard, LandingCardsCard) and
 * shared helpers (FieldViolations, OverrideToggle, SWATCH_CLASS) live in
 * ./_definition-editor-sections to keep this parent file under the 500 LOC cap.
 */

function initialFormState(
  codeDefaults: RoleDefinition,
  override: RoleDefinitionOverridePayload | null,
): FormState {
  return {
    label: {
      on: typeof override?.label === "string",
      value: override?.label ?? codeDefaults.label,
    },
    description: {
      on: typeof override?.description === "string",
      value: override?.description ?? codeDefaults.description,
    },
    visibleInPicker: {
      on: typeof override?.visibleInPicker === "boolean",
      value: override?.visibleInPicker ?? codeDefaults.visibleInPicker,
    },
    scope: {
      on: typeof override?.scope === "string",
      value: (override?.scope ?? codeDefaults.scope) as ScopeValue,
    },
    badgeColor: {
      on: typeof override?.badge?.color === "string",
      value: override?.badge?.color ?? codeDefaults.badge.color,
    },
    badgeAbbrev: {
      on: typeof override?.badge?.abbrev === "string",
      value: override?.badge?.abbrev ?? codeDefaults.badge.abbrev,
    },
    suites: {
      on: Array.isArray(override?.suites),
      value: override?.suites ?? [...codeDefaults.suites],
    },
    allowedRoutes: {
      on: Array.isArray(override?.allowedRoutes),
      value: override?.allowedRoutes ?? [...codeDefaults.allowedRoutes],
    },
    landingCards: {
      on: Array.isArray(override?.landingCards),
      value: override?.landingCards ?? [...codeDefaults.landingCards],
    },
  };
}

function buildPayload(form: FormState): RoleDefinitionOverridePayload {
  const out: RoleDefinitionOverridePayload = {};
  if (form.label.on) out.label = form.label.value;
  if (form.description.on) out.description = form.description.value;
  if (form.visibleInPicker.on) out.visibleInPicker = form.visibleInPicker.value;
  if (form.scope.on) out.scope = form.scope.value;
  if (form.badgeColor.on || form.badgeAbbrev.on) {
    out.badge = {};
    if (form.badgeColor.on) out.badge.color = form.badgeColor.value;
    if (form.badgeAbbrev.on) out.badge.abbrev = form.badgeAbbrev.value;
  }
  if (form.suites.on) out.suites = form.suites.value;
  if (form.allowedRoutes.on) out.allowedRoutes = form.allowedRoutes.value;
  if (form.landingCards.on) out.landingCards = form.landingCards.value;
  return out;
}

export default function RoleDefinitionEditor({
  role,
  codeDefaults,
  initialOverride,
  allKnownRoutes,
}: {
  role: UserRole;
  codeDefaults: RoleDefinition;
  initialOverride: RoleDefinitionOverridePayload | null;
  /** Union of routes across all canonical roles — feeds the <datalist> autocomplete. */
  allKnownRoutes: string[];
}) {
  const router = useRouter();
  const initial = useMemo(
    () => initialFormState(codeDefaults, initialOverride),
    [codeDefaults, initialOverride],
  );
  const [form, setForm] = useState<FormState>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<GuardViolation[]>([]);
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const hasAnyOverride = useMemo(() => {
    return (
      form.label.on ||
      form.description.on ||
      form.visibleInPicker.on ||
      form.scope.on ||
      form.badgeColor.on ||
      form.badgeAbbrev.on ||
      form.suites.on ||
      form.allowedRoutes.on ||
      form.landingCards.on
    );
  }, [form]);

  const handleSave = useCallback(async () => {
    setError(null);
    setViolations([]);
    setSaved(false);
    try {
      const body = { override: buildPayload(form) };
      const res = await fetch(`/api/admin/roles/${role}/definition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.violations)) setViolations(data.violations);
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [form, role, router]);

  const handleReset = useCallback(async () => {
    if (
      !confirm(
        `Reset all definition overrides for ${role}? This reverts every field to the code default.`,
      )
    ) {
      return;
    }
    setError(null);
    setViolations([]);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/roles/${role}/definition`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Reset failed (${res.status})`);
        return;
      }
      setForm(initialFormState(codeDefaults, null));
      setSaved(true);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
  }, [codeDefaults, role, router]);

  const violationsByField = useMemo(() => {
    const map = new Map<GuardViolation["field"], string[]>();
    for (const v of violations) {
      const arr = map.get(v.field) ?? [];
      arr.push(v.message);
      map.set(v.field, arr);
    }
    return map;
  }, [violations]);

  return (
    <div className="space-y-4">
      {/* ----- Basics ----- */}
      <BasicsCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        violationsByField={violationsByField}
      />

      {/* ----- Suites ----- */}
      <SuitesCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        violationsByField={violationsByField}
      />

      {/* ----- Allowed routes ----- */}
      <RoutesCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        allKnownRoutes={allKnownRoutes}
        violationsByField={violationsByField}
      />

      {/* ----- Landing cards ----- */}
      <LandingCardsCard
        form={form}
        setForm={setForm}
        codeDefaults={codeDefaults}
        allKnownRoutes={allKnownRoutes}
        violationsByField={violationsByField}
      />

      {/* ----- Save / Reset bar ----- */}
      <div className="flex flex-col gap-3 rounded-lg border border-t-border/60 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs">
          {error && <span className="text-red-400">{error}</span>}
          {saved && !error && <span className="text-green-400">Saved</span>}
          {!error && !saved && isDirty && <span className="text-muted">Unsaved changes</span>}
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
            {isPending ? "Saving..." : "Save definition"}
          </button>
        </div>
      </div>
    </div>
  );
}
