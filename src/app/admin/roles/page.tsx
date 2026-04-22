"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { RoleDrawerBody, scopeClass, type RoleRow } from "./_RoleDrawerBody";

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

// RoleRow type comes from _RoleDrawerBody so page + drawer share one definition.

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
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  sky: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  violet: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  rose: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  pink: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

function badgeClass(color: string) {
  return BADGE_COLOR_CLASSES[color] ?? BADGE_COLOR_CLASSES.zinc;
}

// scopeClass was moved to _RoleDrawerBody — it's only used inside the drawer.

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
