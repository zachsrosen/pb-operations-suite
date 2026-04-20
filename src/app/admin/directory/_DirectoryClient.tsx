"use client";

import { useState, useMemo } from "react";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, FilterSearch } from "@/components/admin-shell/AdminFilterBar";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

// ── Types ─────────────────────────────────────────────────────────────────

export interface DirectoryRow {
  path: string;
  section: string;
  notes: string;
  allowedRoles: UserRole[];
}

// ── Static badge map (Tailwind JIT needs literal strings) ─────────────────

const BADGE_CLASSES_BY_COLOR: Record<string, string> = {
  red: "bg-red-500/20 text-red-300 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  indigo: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  teal: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  yellow: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  cyan: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  zinc: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

function badgeClasses(role: UserRole): string {
  const color = ROLES[role]?.badge.color ?? "zinc";
  return BADGE_CLASSES_BY_COLOR[color] ?? BADGE_CLASSES_BY_COLOR.zinc;
}

// ── Role filter options (visible-in-picker roles only) ────────────────────

const PICKER_ROLES = (Object.entries(ROLES) as Array<[UserRole, (typeof ROLES)[UserRole]]>)
  .filter(([, def]) => def.visibleInPicker)
  .map(([role]) => role);

const ROLE_FILTER_OPTIONS = PICKER_ROLES.map((r) => ({
  value: r,
  label: ROLES[r].badge.abbrev,
}));

// ── Table columns ─────────────────────────────────────────────────────────

const COLUMNS: AdminTableColumn<DirectoryRow>[] = [
  {
    key: "path",
    label: "Route",
    render: (r) => (
      <a
        href={`https://www.pbtechops.com${r.path}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-blue-300 hover:text-blue-200 hover:underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {r.path}
      </a>
    ),
  },
  {
    key: "section",
    label: "Section",
    width: "w-28",
    render: (r) => <span className="text-xs text-muted">{r.section}</span>,
  },
  {
    key: "allowedRoles",
    label: "Roles with access",
    render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.allowedRoles.map((role) => (
          <span
            key={role}
            className={`text-[10px] font-medium px-2 py-0.5 rounded border ${badgeClasses(role)}`}
          >
            {ROLES[role].badge.abbrev}
          </span>
        ))}
      </div>
    ),
  },
  {
    key: "notes",
    label: "Notes",
    render: (r) => <span className="text-xs text-muted">{r.notes || "—"}</span>,
  },
];

// ── Component ─────────────────────────────────────────────────────────────

export function DirectoryClient({ rows }: { rows: DirectoryRow[] }) {
  const [pathQuery, setPathQuery] = useState("");
  const [roleFilters, setRoleFilters] = useState<string[]>([]);

  const visibleRows = useMemo(() => {
    let result = rows;
    if (pathQuery.trim()) {
      const q = pathQuery.toLowerCase();
      result = result.filter((r) => r.path.toLowerCase().includes(q));
    }
    if (roleFilters.length > 0) {
      result = result.filter((r) =>
        roleFilters.every((role) => r.allowedRoles.includes(role as UserRole))
      );
    }
    return result;
  }, [rows, pathQuery, roleFilters]);

  const hasActiveFilters = !!pathQuery || roleFilters.length > 0;
  const clearAll = () => { setPathQuery(""); setRoleFilters([]); };

  return (
    <>
      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <FilterSearch
            value={pathQuery}
            onChange={setPathQuery}
            placeholder="Filter by route path…"
            widthClass="w-56"
          />
          <MultiSelectFilter
            label="Role"
            options={ROLE_FILTER_OPTIONS}
            selected={roleFilters}
            onChange={setRoleFilters}
            placeholder="All Roles"
            accentColor="indigo"
          />
        </AdminFilterBar>
      </div>

      <AdminTable
        caption="App page directory with per-role access"
        rows={visibleRows}
        rowKey={(r) => r.path}
        columns={COLUMNS}
        empty={
          <AdminEmpty
            label="No routes match your filters"
            description="Try adjusting your search or role filter."
          />
        }
      />

      {!hasActiveFilters && (
        <p className="mt-3 text-center text-xs text-muted">
          {rows.length} routes listed
        </p>
      )}
    </>
  );
}
