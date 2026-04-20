"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ROLES, type RoleDefinition, type Scope } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import {
  AdminFilterBar,
  FilterChip,
  FilterSearch,
} from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import CapabilityEditor from "./CapabilityEditor";

/**
 * Admin — Roles
 *
 * Consolidated role inspector + per-role capability editor. Roles are listed
 * in a table; clicking a row (or deep-linking via `?role=<key>`) opens a
 * drawer with the role's access detail and the capability editor inline.
 *
 * Source of truth for code defaults: src/lib/roles.ts
 * Source of truth for overrides: RoleCapabilityOverride table
 *
 * Middleware gates /admin/* to ADMIN — no local auth check needed here.
 */

type RoleRow = {
  role: UserRole;
  def: RoleDefinition;
  isLegacy: boolean;
  userCount: number | null;
};

type CapabilityKey = keyof RoleDefinition["defaultCapabilities"];

const SCOPE_OPTIONS: Array<{ value: Scope; label: string }> = [
  { value: "global", label: "Global" },
  { value: "location", label: "Location" },
  { value: "owner", label: "Owner" },
];

const BADGE_COLOR_CLASSES: Record<string, string> = {
  red: "bg-red-500/20 text-red-400 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  teal: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  zinc: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  slate: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

function badgeClass(color: string) {
  return BADGE_COLOR_CLASSES[color] ?? BADGE_COLOR_CLASSES.zinc;
}

function scopeClass(scope: Scope) {
  if (scope === "global") return "bg-green-500/10 text-green-400 border-green-500/30";
  if (scope === "location") return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}

// ── Types from /api/admin/users ──────────────────────────────────────────
interface AdminUser {
  id: string;
  email: string;
  roles?: UserRole[] | null;
}
interface AdminUsersResponse {
  users: AdminUser[];
}

/**
 * Count users per role by fetching the full user list once.
 * Admin-only, small dataset (~50 users) — simpler than adding an API endpoint.
 */
function useRoleUserCounts() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/users", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
        const data = (await res.json()) as AdminUsersResponse;
        if (cancelled) return;
        const byRole: Record<string, number> = {};
        for (const u of data.users ?? []) {
          const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : ["VIEWER"];
          for (const r of roles) byRole[r] = (byRole[r] ?? 0) + 1;
        }
        setCounts(byRole);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load user counts");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { counts, error };
}

export default function AdminRolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedRole = searchParams.get("role");

  const { counts, error: countsError } = useRoleUserCounts();

  // Filters
  const [scopes, setScopes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);

  // All roles, sorted canonical-first
  const allRows: RoleRow[] = useMemo(() => {
    const entries = Object.entries(ROLES) as Array<[UserRole, RoleDefinition]>;
    return entries.map(([role, def]) => ({
      role,
      def,
      isLegacy: !def.visibleInPicker,
      userCount: counts ? (counts[role] ?? 0) : null,
    }));
  }, [counts]);

  // Filtered view
  const rows: RoleRow[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows
      .filter((r) => (showLegacy ? true : !r.isLegacy))
      .filter((r) => (scopes.length === 0 ? true : scopes.includes(r.def.scope)))
      .filter((r) => {
        if (!q) return true;
        return (
          r.role.toLowerCase().includes(q) ||
          r.def.label.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Canonical first, then alpha by role key
        if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
        return a.role.localeCompare(b.role);
      });
  }, [allRows, scopes, query, showLegacy]);

  // Derive the selected row from the URL (source of truth).
  const selected: RoleRow | null = useMemo(() => {
    if (!deepLinkedRole) return null;
    return allRows.find((r) => r.role === deepLinkedRole) ?? null;
  }, [allRows, deepLinkedRole]);

  // Auto-show legacy if deep-linked row is legacy (so its selection makes sense)
  useEffect(() => {
    if (selected?.isLegacy && !showLegacy) setShowLegacy(true);
  }, [selected, showLegacy]);

  const openRole = useCallback(
    (role: UserRole) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("role", role);
      router.push(`/admin/roles?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const closeDrawer = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("role");
    const qs = sp.toString();
    router.push(qs ? `/admin/roles?${qs}` : "/admin/roles", { scroll: false });
  }, [router, searchParams]);

  const hasActiveFilters = scopes.length > 0 || !!query || showLegacy;
  const clearAll = () => {
    setScopes([]);
    setQuery("");
    setShowLegacy(false);
  };

  const columns: AdminTableColumn<RoleRow>[] = useMemo(
    () => [
      {
        key: "role",
        label: "Role",
        render: (r) => (
          <span className="font-mono text-xs font-semibold text-foreground">{r.role}</span>
        ),
      },
      {
        key: "label",
        label: "Label",
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{r.def.label}</p>
            {r.isLegacy && (
              <span className="mt-0.5 inline-flex rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-yellow-400">
                Legacy → {r.def.normalizesTo}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "scope",
        label: "Scope",
        width: "w-28",
        render: (r) => (
          <span
            className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${scopeClass(r.def.scope)}`}
          >
            {r.def.scope}
          </span>
        ),
      },
      {
        key: "badge",
        label: "Badge",
        width: "w-24",
        render: (r) => (
          <span
            className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass(r.def.badge.color)}`}
          >
            {r.def.badge.abbrev}
          </span>
        ),
      },
      {
        key: "userCount",
        label: "Users",
        width: "w-20",
        align: "right",
        render: (r) =>
          r.userCount === null ? (
            <span className="text-xs text-muted">…</span>
          ) : r.userCount === 0 ? (
            <span className="text-xs text-muted">0</span>
          ) : (
            <span className="text-xs font-medium text-foreground">{r.userCount}</span>
          ),
      },
    ],
    [],
  );

  return (
    <div>
      <AdminPageHeader
        title="Roles"
        breadcrumb={["Admin", "People", "Roles"]}
        subtitle="Snapshot of every role's access. Source of truth: src/lib/roles.ts"
      />

      {countsError && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          User counts unavailable: {countsError}
        </div>
      )}

      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <MultiSelectFilter
            label="Scope"
            options={SCOPE_OPTIONS}
            selected={scopes}
            onChange={setScopes}
            placeholder="All Scopes"
            accentColor="blue"
          />
          <FilterSearch
            value={query}
            onChange={setQuery}
            placeholder="Filter by role key or label…"
            widthClass="w-56"
          />
          <FilterChip
            active={showLegacy}
            onClick={() => setShowLegacy((v) => !v)}
            label="Toggle legacy roles"
          >
            Show legacy
          </FilterChip>
        </AdminFilterBar>
      </div>

      <AdminTable<RoleRow>
        caption="Roles"
        rows={rows}
        rowKey={(r) => r.role}
        columns={columns}
        onRowClick={(r) => openRole(r.role)}
        empty={
          <AdminEmpty
            label="No roles match your filters"
            description={
              hasActiveFilters
                ? "Try clearing a filter or enabling legacy roles."
                : "No roles defined."
            }
          />
        }
      />

      <AdminDetailDrawer
        open={selected !== null}
        onClose={closeDrawer}
        wide
        title={
          selected ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-foreground">
                {selected.role}
              </span>
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass(selected.def.badge.color)}`}
              >
                {selected.def.badge.abbrev}
              </span>
              {selected.isLegacy && (
                <span className="inline-flex rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-400">
                  Legacy → {selected.def.normalizesTo}
                </span>
              )}
            </div>
          ) : (
            ""
          )
        }
      >
        {selected && <RoleDrawerBody row={selected} />}
      </AdminDetailDrawer>
    </div>
  );
}

function RoleDrawerBody({ row }: { row: RoleRow }) {
  const { role, def } = row;
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
    </div>
  );
}

/**
 * Loads the current override for a role from the API and renders the
 * CapabilityEditor. Keyed by `role` so switching roles in the drawer
 * remounts the editor with the correct initial state.
 */
function RoleCapabilityEditorLoader({ role, def }: { role: UserRole; def: RoleDefinition }) {
  const [override, setOverride] = useState<Partial<Record<CapabilityKey, boolean | null>> | null | undefined>(
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
