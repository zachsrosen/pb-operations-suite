"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RoleDefinition, Scope } from "@/lib/roles";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import type { RoleDefinitionOverridePayload } from "@/lib/role-override-types";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import CapabilityEditor from "./CapabilityEditor";
import RoleDefinitionEditor from "./RoleDefinitionEditor";

/**
 * The body rendered inside the role-detail drawer on `/admin/roles`.
 * Split into its own file so `page.tsx` stays under the 500 LOC cap.
 *
 * - `RoleDrawerBody` shows the header + key/value summary + allowed-routes
 *   disclosure + the capability editor section.
 * - `RoleCapabilityEditorLoader` fetches the current override row for the
 *   role and feeds it into `CapabilityEditor`. Keyed by role so switching
 *   roles remounts with correct initial state.
 */

export type RoleRow = {
  role: UserRole;
  def: RoleDefinition;
  isLegacy: boolean;
  userCount: number | null;
};

type CapabilityKey = keyof RoleDefinition["defaultCapabilities"];

export function scopeClass(scope: Scope): string {
  switch (scope) {
    case "global":
      return "border-green-500/30 bg-green-500/10 text-green-400";
    case "location":
      return "border-blue-500/30 bg-blue-500/10 text-blue-400";
    case "owner":
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  }
}

export function RoleDrawerBody({ row }: { row: RoleRow }) {
  const { role, def } = row;
  const isLegacy = def.normalizesTo !== role;
  if (isLegacy) {
    return <LegacyRoleBanner role={role} canonical={def.normalizesTo} />;
  }
  return (
    <div className="space-y-5">
      <AdminDetailHeader
        title={def.label}
        subtitle={def.description}
        actions={
          <Link
            href={`/admin/users?role=${encodeURIComponent(role)}`}
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
          >
            Users with this role
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-3 w-3"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        }
      />

      <AdminKeyValueGrid
        items={[
          {
            label: "Scope",
            value: (
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${scopeClass(def.scope)}`}
              >
                {def.scope}
              </span>
            ),
          },
          {
            label: "Normalizes to",
            value: <span className="font-mono text-xs">{def.normalizesTo}</span>,
          },
          {
            label: "Assignable",
            value: (
              <span className={def.visibleInPicker ? "text-green-400" : "text-muted"}>
                {def.visibleInPicker ? "Yes (in admin picker)" : "No (legacy)"}
              </span>
            ),
          },
          {
            label: `Suites (${def.suites.length})`,
            value:
              def.suites.length === 0 ? (
                <span className="text-muted">none</span>
              ) : (
                <ul className="space-y-0.5">
                  {def.suites.map((s) => (
                    <li key={s} className="font-mono text-xs text-muted">
                      {s}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            label: `Landing cards (${def.landingCards.length})`,
            value:
              def.landingCards.length === 0 ? (
                <span className="text-muted">none</span>
              ) : (
                <ul className="space-y-1">
                  {def.landingCards.map((card) => (
                    <li key={card.href} className="text-xs">
                      <span className="font-medium text-foreground">{card.title}</span>
                      <span className="text-muted"> — </span>
                      <code className="text-muted">{card.href}</code>
                    </li>
                  ))}
                </ul>
              ),
          },
        ]}
      />

      <details className="group rounded border border-t-border/60 bg-surface-2 p-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-foreground">
          Allowed routes ({def.allowedRoutes.length})
          <span className="ml-1 text-muted group-open:hidden">— click to expand</span>
        </summary>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          {def.allowedRoutes.map((r) => (
            <li key={r} className="text-muted">
              {r}
            </li>
          ))}
        </ul>
      </details>

      <section aria-labelledby={`caps-heading-${role}`} className="space-y-2">
        <h3
          id={`caps-heading-${role}`}
          className="text-[10px] font-semibold uppercase tracking-wider text-muted"
        >
          Capabilities
        </h3>
        <RoleCapabilityEditorLoader role={role} def={def} />
      </section>

      {/* NEW: Full definition editor */}
      <section aria-labelledby={`def-heading-${role}`} className="space-y-2">
        <h3
          id={`def-heading-${role}`}
          className="text-[10px] font-semibold uppercase tracking-wider text-muted"
        >
          Definition overrides
        </h3>
        <RoleDefinitionEditorLoader role={role} def={def} />
      </section>
    </div>
  );
}

/**
 * Loads the current override for a role from the API and renders the
 * CapabilityEditor. Keyed by `role` so switching roles in the drawer
 * remounts the editor with the correct initial state.
 */
function RoleCapabilityEditorLoader({ role, def }: { role: UserRole; def: RoleDefinition }) {
  const [override, setOverride] = useState<
    Partial<Record<CapabilityKey, boolean | null>> | null | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverride(undefined);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/roles/${encodeURIComponent(role)}/capabilities`,
          { credentials: "same-origin" },
        );
        if (!res.ok) throw new Error(`Failed to load overrides (${res.status})`);
        const data = (await res.json()) as {
          override: Partial<Record<CapabilityKey, boolean | null>> | null;
        };
        if (!cancelled) setOverride(data.override ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load overrides");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        {error}
      </div>
    );
  }
  if (override === undefined) {
    return <div className="text-xs text-muted">Loading capabilities…</div>;
  }

  return (
    <CapabilityEditor
      key={role}
      role={role}
      codeDefaults={def.defaultCapabilities}
      initialOverride={override}
    />
  );
}

/**
 * Banner shown when the selected role is legacy (normalizesTo !== role).
 * Legacy roles don't have their own override rows; their access resolves
 * from the canonical target at request time. Editing them would silently
 * no-op at the resolver layer.
 */
function LegacyRoleBanner({ role, canonical }: { role: UserRole; canonical: UserRole }) {
  return (
    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-foreground">
      <p className="font-medium">This role is legacy.</p>
      <p className="mt-2 text-muted">
        <span className="font-mono text-foreground">{role}</span> normalizes to{" "}
        <span className="font-mono text-foreground">{canonical}</span>. Its access is
        resolved from the canonical target at request time, so overrides on this role
        would have no effect.
      </p>
      <p className="mt-3">
        <Link
          href={`/admin/roles?role=${encodeURIComponent(canonical)}`}
          className="inline-flex items-center gap-1 text-cyan-400 hover:underline"
        >
          Edit {canonical} instead →
        </Link>
      </p>
    </div>
  );
}

/**
 * Loads the current definition override row for a role + the known-routes
 * union, then renders RoleDefinitionEditor. Keyed by role so switching
 * roles remounts with correct initial state.
 */
function RoleDefinitionEditorLoader({ role, def }: { role: UserRole; def: RoleDefinition }) {
  const [override, setOverride] = useState<RoleDefinitionOverridePayload | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverride(undefined);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/roles/${encodeURIComponent(role)}/definition`,
          { credentials: "same-origin" },
        );
        if (!res.ok) throw new Error(`Failed to load override (${res.status})`);
        const data = (await res.json()) as {
          override: RoleDefinitionOverridePayload | null;
        };
        if (!cancelled) setOverride(data.override ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load override");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const allKnownRoutes = useMemo(() => {
    const seen = new Set<string>();
    for (const r of Object.values(ROLES)) {
      for (const route of r.allowedRoutes) {
        if (typeof route === "string") seen.add(route);
      }
    }
    return Array.from(seen).sort();
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
        {error}
      </div>
    );
  }
  if (override === undefined) {
    return <div className="text-xs text-muted">Loading definition…</div>;
  }

  return (
    <RoleDefinitionEditor
      key={role}
      role={role}
      codeDefaults={def}
      initialOverride={override}
      allKnownRoutes={allKnownRoutes}
    />
  );
}
