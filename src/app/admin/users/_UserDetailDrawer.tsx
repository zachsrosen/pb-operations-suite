"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import { FormToggle } from "@/components/admin-shell/AdminForm";
import { ROLES as ROLE_DEFS } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

// ── Shared types ─────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roles?: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canScheduleInspections: boolean;
  canSyncToZuper: boolean;
  canManageUsers: boolean;
  canManageAvailability: boolean;
  allowedLocations: string[];
  extraAllowedRoutes?: string[];
  extraDeniedRoutes?: string[];
}

interface ActivityLog {
  id: string;
  timestamp: string;
  type: string;
  description: string;
}

// ── Role helpers ─────────────────────────────────────────────────────────

const PICKER_ROLES: string[] = (
  Object.entries(ROLE_DEFS) as Array<[string, (typeof ROLE_DEFS)[UserRole]]>
)
  .filter(([, def]) => def.visibleInPicker)
  .map(([role]) => role);

const ROLE_BADGE_BY_COLOR: Record<string, string> = {
  red: "bg-red-500/20 text-red-400 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  teal: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  zinc: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  slate: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const roleLabel = (r: string) => ROLE_DEFS[r as UserRole]?.badge.abbrev ?? r;
const roleDesc = (r: string) => ROLE_DEFS[r as UserRole]?.description ?? "";
const roleBadgeClass = (r: string): string => {
  const color = ROLE_DEFS[r as UserRole]?.badge.color ?? "zinc";
  return ROLE_BADGE_BY_COLOR[color] ?? ROLE_BADGE_BY_COLOR.zinc;
};

const LOCATIONS = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

const PERMISSION_LABELS: Array<{
  key: Exclude<
    keyof Pick<
      AdminUser,
      | "canScheduleSurveys"
      | "canScheduleInstalls"
      | "canScheduleInspections"
      | "canSyncToZuper"
      | "canManageUsers"
      | "canManageAvailability"
    >,
    never
  >;
  label: string;
  help: string;
}> = [
  { key: "canScheduleSurveys", label: "Schedule Surveys", help: "Can schedule site surveys" },
  { key: "canScheduleInstalls", label: "Schedule Installs", help: "Can schedule installations" },
  { key: "canScheduleInspections", label: "Schedule Inspections", help: "Can schedule inspections" },
  { key: "canSyncToZuper", label: "Sync to Zuper", help: "Can sync jobs to Zuper FSM" },
  { key: "canManageUsers", label: "Manage Users", help: "Can access admin panel & manage users" },
  { key: "canManageAvailability", label: "Manage Availability", help: "Can add/edit/remove crew availability" },
];

type TabKey = "overview" | "roles" | "permissions" | "routes" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "roles", label: "Roles" },
  { key: "permissions", label: "Permissions" },
  { key: "routes", label: "Routes" },
  { key: "activity", label: "Activity" },
];

// ── Component ────────────────────────────────────────────────────────────

export interface UserDetailDrawerProps {
  user: AdminUser | null;
  canImpersonate: boolean; // false if target is self or ADMIN (to match current page)
  saving: boolean;
  onClose: () => void;
  onSaveRoles: (roles: string[]) => Promise<void>;
  onSavePermissions: (perms: {
    canScheduleSurveys: boolean;
    canScheduleInstalls: boolean;
    canScheduleInspections: boolean;
    canSyncToZuper: boolean;
    canManageUsers: boolean;
    canManageAvailability: boolean;
    allowedLocations: string[];
  }) => Promise<void>;
  onSaveRoutes: (
    extraAllowedRoutes: string[],
    extraDeniedRoutes: string[],
  ) => Promise<void>;
  onImpersonate: () => Promise<void>;
}

export default function UserDetailDrawer({
  user,
  canImpersonate,
  saving,
  onClose,
  onSaveRoles,
  onSavePermissions,
  onSaveRoutes,
  onImpersonate,
}: UserDetailDrawerProps) {
  const [tab, setTab] = useState<TabKey>("overview");

  // Local edit state — reseeded whenever `user.id` changes.
  const [rolesSel, setRolesSel] = useState<string[]>([]);
  const [perms, setPerms] = useState({
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncToZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    allowedLocations: [] as string[],
  });
  const [extraAllowed, setExtraAllowed] = useState<string[]>([]);
  const [extraDenied, setExtraDenied] = useState<string[]>([]);
  const [allowInput, setAllowInput] = useState("");
  const [denyInput, setDenyInput] = useState("");
  const [activity, setActivity] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    if (!user) return;
    setTab("overview");
    setRolesSel(user.roles ?? []);
    setPerms({
      canScheduleSurveys: user.canScheduleSurveys,
      canScheduleInstalls: user.canScheduleInstalls,
      canScheduleInspections: user.canScheduleInspections,
      canSyncToZuper: user.canSyncToZuper,
      canManageUsers: user.canManageUsers,
      canManageAvailability: user.canManageAvailability,
      allowedLocations: user.allowedLocations ?? [],
    });
    setExtraAllowed(user.extraAllowedRoutes ?? []);
    setExtraDenied(user.extraDeniedRoutes ?? []);
    setAllowInput("");
    setDenyInput("");
    setActivity(null);
  }, [user]);

  const loadActivity = useCallback(async (userId: string) => {
    try {
      const res = await fetch(
        `/api/admin/activity?userId=${encodeURIComponent(userId)}&limit=10`,
      );
      if (!res.ok) {
        setActivity([]);
        return;
      }
      const data = await res.json();
      setActivity(data.logs ?? []);
    } catch {
      setActivity([]);
    }
  }, []);

  // Lazy-load activity when Activity tab opens.
  useEffect(() => {
    if (!user) return;
    if (tab !== "activity") return;
    if (activity !== null) return;
    loadActivity(user.id);
  }, [tab, user, activity, loadActivity]);

  const open = !!user;
  if (!open || !user) {
    return <AdminDetailDrawer open={false} onClose={onClose} title="" wide>{null}</AdminDetailDrawer>;
  }

  const toggleRole = (role: string) =>
    setRolesSel((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );

  const toggleLocation = (loc: string) =>
    setPerms((p) => ({
      ...p,
      allowedLocations: p.allowedLocations.includes(loc)
        ? p.allowedLocations.filter((l) => l !== loc)
        : [...p.allowedLocations, loc],
    }));

  const addPath = (
    value: string,
    list: string[],
    setList: (next: string[]) => void,
    setInput: (v: string) => void,
  ) => {
    const path = value.trim();
    if (!path || !path.startsWith("/") || list.includes(path)) return;
    setList([...list, path]);
    setInput("");
  };

  const footer = (
    <div className="flex items-center justify-between gap-2">
      {canImpersonate ? (
        <button
          type="button"
          onClick={onImpersonate}
          disabled={saving}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          Impersonate this user
        </button>
      ) : (
        <span className="text-xs text-muted">Impersonation disabled</span>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
        >
          Close
        </button>
        {tab === "roles" && (
          <button
            type="button"
            onClick={() => onSaveRoles(rolesSel)}
            disabled={saving || rolesSel.length === 0}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save roles"}
          </button>
        )}
        {tab === "permissions" && (
          <button
            type="button"
            onClick={() => onSavePermissions(perms)}
            disabled={saving}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save permissions"}
          </button>
        )}
        {tab === "routes" && (
          <button
            type="button"
            onClick={() => onSaveRoutes(extraAllowed, extraDenied)}
            disabled={saving}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save routes"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <AdminDetailDrawer
      open
      onClose={onClose}
      wide
      title={
        <AdminDetailHeader
          title={user.name || user.email}
          subtitle={user.name ? user.email : undefined}
        />
      }
      footer={footer}
    >
      {/* Tab strip */}
      <div className="mb-4 flex gap-1 border-b border-t-border/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-cyan-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          <AdminKeyValueGrid
            items={[
              { label: "Email", value: user.email, mono: true },
              { label: "Name", value: user.name ?? "—" },
              {
                label: "Created",
                value: new Date(user.createdAt).toLocaleString(),
              },
              {
                label: "Last login",
                value: user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString()
                  : "Never",
              },
              {
                label: "Roles",
                value: (
                  <div className="flex flex-wrap gap-1">
                    {(user.roles ?? []).length === 0 ? (
                      <span className="text-xs text-muted">None</span>
                    ) : (
                      (user.roles ?? []).map((r) => (
                        <span
                          key={r}
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(r)}`}
                        >
                          {roleLabel(r)}
                        </span>
                      ))
                    )}
                  </div>
                ),
              },
              {
                label: "Locations",
                value:
                  user.allowedLocations.length === 0
                    ? "All locations"
                    : user.allowedLocations.join(", "),
              },
            ]}
          />
        </div>
      )}

      {/* Roles */}
      {tab === "roles" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Select one or more roles. The user&apos;s effective access is the
            union of every selected role.
          </p>
          {PICKER_ROLES.map((role) => {
            const checked = rolesSel.includes(role);
            return (
              <label
                key={role}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                  checked
                    ? "border-cyan-500/40 bg-cyan-500/10"
                    : "border-t-border/60 bg-surface-2 hover:bg-surface-elevated"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRole(role)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(role)}`}
                  >
                    {roleLabel(role)}
                  </span>
                  <p className="mt-1 text-xs text-muted">{roleDesc(role)}</p>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* Permissions */}
      {tab === "permissions" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Action Permissions
            </h3>
            {PERMISSION_LABELS.map(({ key, label, help }) => (
              <FormToggle
                key={key}
                label={label}
                help={help}
                checked={perms[key]}
                onChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
              />
            ))}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Location Access
            </h3>
            <p className="mb-2 text-xs text-muted">
              Empty = access to all locations
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LOCATIONS.map((loc) => {
                const active = perms.allowedLocations.includes(loc);
                return (
                  <label
                    key={loc}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-cyan-500/50 bg-cyan-500/10"
                        : "border-t-border/60 bg-surface-2 hover:bg-surface-elevated"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleLocation(loc)}
                    />
                    {loc}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Routes (Option D) */}
      {tab === "routes" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Grant or revoke specific paths without changing the role. Paths
            start with &quot;/&quot;. Denials win over grants and override an
            ADMIN wildcard. Changes apply on next sign-in (JWT refresh ≤ 5 min).
          </p>

          <RoutesList
            title={`Extra allowed (${extraAllowed.length})`}
            input={allowInput}
            setInput={setAllowInput}
            placeholder="/dashboards/executive"
            list={extraAllowed}
            onAdd={() =>
              addPath(allowInput, extraAllowed, setExtraAllowed, setAllowInput)
            }
            onRemove={(p) => setExtraAllowed(extraAllowed.filter((x) => x !== p))}
            accent="cyan"
          />

          <RoutesList
            title={`Extra denied (${extraDenied.length})`}
            input={denyInput}
            setInput={setDenyInput}
            placeholder="/dashboards/sensitive-thing"
            list={extraDenied}
            onAdd={() =>
              addPath(denyInput, extraDenied, setExtraDenied, setDenyInput)
            }
            onRemove={(p) => setExtraDenied(extraDenied.filter((x) => x !== p))}
            accent="red"
          />
        </div>
      )}

      {/* Activity */}
      {tab === "activity" && (
        <div className="space-y-3">
          {activity === null ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-xs text-muted italic">No recent activity.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((log) => (
                <li
                  key={log.id}
                  className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-2 text-xs"
                >
                  <p className="text-foreground/90">{log.description}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
                    {log.type} · {new Date(log.timestamp).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/admin/activity?userId=${encodeURIComponent(user.id)}`}
            className="text-xs text-cyan-400 hover:underline"
          >
            View all →
          </Link>
        </div>
      )}
    </AdminDetailDrawer>
  );
}

// ── Routes list sub-component ────────────────────────────────────────────

interface RoutesListProps {
  title: string;
  input: string;
  setInput: (v: string) => void;
  placeholder: string;
  list: string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
  accent: "cyan" | "red";
}

function RoutesList({
  title,
  input,
  setInput,
  placeholder,
  list,
  onAdd,
  onRemove,
  accent,
}: RoutesListProps) {
  const focusRing =
    accent === "cyan" ? "focus:border-cyan-500" : "focus:border-red-500";
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className={`flex-1 rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none ${focusRing}`}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!input.trim().startsWith("/") || list.includes(input.trim())}
          className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs italic text-muted">None.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((path) => (
            <li
              key={path}
              className="flex items-center justify-between rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs"
            >
              <code className="text-foreground">{path}</code>
              <button
                type="button"
                onClick={() => onRemove(path)}
                aria-label={`Remove ${path}`}
                className="text-muted hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
