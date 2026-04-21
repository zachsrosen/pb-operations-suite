"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ROLES as ROLE_DEFS } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminLoading } from "@/components/admin-shell/AdminLoading";
import { AdminError } from "@/components/admin-shell/AdminError";
import {
  AdminFilterBar,
  FilterSearch,
} from "@/components/admin-shell/AdminFilterBar";
import {
  AdminTable,
  type AdminTableColumn,
} from "@/components/admin-shell/AdminTable";
import { AdminBulkActionBar } from "@/components/admin-shell/AdminBulkActionBar";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import UserDetailDrawer, { type AdminUser } from "./_UserDetailDrawer";

/**
 * Admin — Users
 *
 * Single source for user administration. Rewrite consolidates three modals
 * (roles editor, permissions, extra routes) into one tabbed drawer using the
 * admin-shell primitives.
 *
 * Preserved features (Phase 1 + 2):
 *  - Role editing (PUT /api/admin/users)              — Roles tab
 *  - Per-user permissions + locations                  — Permissions tab
 *  - Per-user extra routes (Option D)                  — Routes tab
 *  - Impersonation (POST /api/admin/impersonate)       — drawer footer
 *  - Google Workspace sync                             — header action
 *  - Bulk role update (PUT /api/admin/users/bulk-role) — bulk action bar
 *  - ?userId= deep-link + scrollIntoView
 *  - ?role= preload from /admin/roles "Users with this role →"
 *  - Activity preview (last 10)                        — Activity tab
 *
 * Middleware gates /admin/* to ADMIN — no local auth check needed here.
 */

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
const roleBadgeClass = (r: string): string => {
  const color = ROLE_DEFS[r as UserRole]?.badge.color ?? "zinc";
  return ROLE_BADGE_BY_COLOR[color] ?? ROLE_BADGE_BY_COLOR.zinc;
};

function getLastActiveLabel(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "Never";
  const diffMs = Date.now() - new Date(lastLoginAt).getTime();
  const diffDays = diffMs / 86_400_000;
  if (diffDays < 1) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffDays)}d ago`;
}

function getLastActiveColor(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "bg-red-500";
  const diffDays = (Date.now() - new Date(lastLoginAt).getTime()) / 86_400_000;
  if (diffDays < 1) return "bg-green-500";
  if (diffDays < 7) return "bg-yellow-500";
  return "bg-red-500";
}

interface WorkspaceState {
  configured: boolean | null;
  domain: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkedUserId = searchParams.get("userId");
  const deepLinkedRole = searchParams.get("role");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    configured: null,
    domain: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<string>("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilters, setRoleFilters] = useState<string[]>(
    deepLinkedRole ? [deepLinkedRole] : [],
  );

  // ── Data loaders ─────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load users (${res.status})`);
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    (async () => {
      try {
        const res = await fetch("/api/admin/sync-workspace");
        if (res.ok) {
          const d = await res.json();
          setWorkspace({ configured: d.configured, domain: d.domain ?? "" });
        }
      } catch {
        setWorkspace({ configured: false, domain: "" });
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/user/me");
        if (res.ok) {
          const d = await res.json();
          setCurrentUserEmail(d.user?.email ?? null);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [fetchUsers]);

  // Deep-link: scroll to row when ?userId= matches a loaded user.
  useEffect(() => {
    if (!deepLinkedUserId || users.length === 0) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-user-id="${deepLinkedUserId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [deepLinkedUserId, users]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── URL state helpers ───────────────────────────────────────────────────

  const openDrawer = useCallback(
    (userId: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("userId", userId);
      router.push(`/admin/users?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const closeDrawer = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("userId");
    const qs = sp.toString();
    router.push(qs ? `/admin/users?${qs}` : "/admin/users", { scroll: false });
  }, [router, searchParams]);

  // ── Filters ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (q) {
        const hay = `${u.name ?? ""} ${u.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilters.length > 0) {
        const userRoles = u.roles ?? [];
        if (!roleFilters.some((r) => userRoles.includes(r))) return false;
      }
      return true;
    });
  }, [users, searchQuery, roleFilters]);

  const hasActiveFilters = searchQuery !== "" || roleFilters.length > 0;
  const clearAll = () => {
    setSearchQuery("");
    setRoleFilters([]);
  };

  // ── Selection ───────────────────────────────────────────────────────────

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () => {
    setSelected((prev) =>
      prev.size === filtered.length
        ? new Set()
        : new Set(filtered.map((u) => u.id)),
    );
  };

  // ── Actions ─────────────────────────────────────────────────────────────

  const syncWorkspace = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/sync-workspace", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync");
      showToast(
        `Synced: ${data.results?.created ?? 0} new, ${data.results?.updated ?? 0} updated`,
      );
      await fetchUsers();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkRoleUpdate = async () => {
    if (!bulkRole || selected.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users/bulk-role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selected),
          role: bulkRole,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update roles");
      }
      setUsers((prev) =>
        prev.map((u) =>
          selected.has(u.id) ? { ...u, role: bulkRole, roles: [bulkRole] } : u,
        ),
      );
      showToast(`Updated ${selected.size} users to ${roleLabel(bulkRole)}`);
      setSelected(new Set());
      setBulkRole("");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const drawerUser = useMemo(
    () => users.find((u) => u.id === deepLinkedUserId) ?? null,
    [users, deepLinkedUserId],
  );

  const saveRoles = async (newRoles: string[]) => {
    if (!drawerUser) return;
    if (newRoles.length === 0) {
      showToast("Error: Pick at least one role");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: drawerUser.id, roles: newRoles }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update roles");
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === drawerUser.id
            ? { ...u, roles: newRoles, role: newRoles[0] }
            : u,
        ),
      );
      showToast(
        newRoles.length === 1
          ? `Role updated to ${roleLabel(newRoles[0])}`
          : `Roles updated: ${newRoles.map(roleLabel).join(", ")}`,
      );
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async (perms: {
    canScheduleSurveys: boolean;
    canScheduleInstalls: boolean;
    canScheduleInspections: boolean;
    canSyncToZuper: boolean;
    canManageUsers: boolean;
    canManageAvailability: boolean;
    allowedLocations: string[];
  }) => {
    if (!drawerUser) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: drawerUser.id,
          permissions: perms,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update permissions");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === drawerUser.id ? { ...u, ...perms } : u)),
      );
      showToast("Permissions updated");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRoutes = async (
    extraAllowedRoutes: string[],
    extraDeniedRoutes: string[],
  ) => {
    if (!drawerUser) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/users/${drawerUser.id}/extra-routes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extraAllowedRoutes, extraDeniedRoutes }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update extra routes");
      }
      setUsers((prev) =>
        prev.map((u) =>
          u.id === drawerUser.id
            ? { ...u, extraAllowedRoutes, extraDeniedRoutes }
            : u,
        ),
      );
      showToast("Extra routes updated");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const saveHubspotOwner = async (hubspotOwnerId: string | null) => {
    if (!drawerUser) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/users/${drawerUser.id}/hubspot-owner`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubspotOwnerId }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to update HubSpot link");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === drawerUser.id ? { ...u, hubspotOwnerId } : u)),
      );
      showToast("HubSpot link updated");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  const startImpersonation = async () => {
    if (!drawerUser) return;
    if (drawerUser.email === currentUserEmail) {
      showToast("Error: Cannot impersonate yourself");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: drawerUser.id,
          reason: "Admin review via User Management",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to start impersonation");
      }
      showToast(`Now viewing as ${drawerUser.name || drawerUser.email}`);
      setTimeout(() => {
        window.location.href = "/";
      }, 800);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Table columns ───────────────────────────────────────────────────────

  const columns: AdminTableColumn<AdminUser>[] = useMemo(
    () => [
      {
        key: "user",
        label: "User",
        render: (u) => (
          <div data-user-id={u.id}>
            <p className="font-medium text-foreground">{u.name || "No name"}</p>
            <p className="text-xs text-muted">{u.email}</p>
          </div>
        ),
      },
      {
        key: "roles",
        label: "Roles",
        render: (u) => {
          const rs = u.roles ?? [];
          return (
            <div className="flex flex-wrap items-center gap-1">
              {rs.length === 0 ? (
                <span className="text-xs text-muted">—</span>
              ) : (
                rs.map((r) => (
                  <span
                    key={r}
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(r)}`}
                  >
                    {roleLabel(r)}
                  </span>
                ))
              )}
            </div>
          );
        },
      },
      {
        key: "lastLogin",
        label: "Last login",
        width: "w-32",
        render: (u) => (
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${getLastActiveColor(u.lastLoginAt)}`}
            />
            <span className="text-xs text-muted">
              {getLastActiveLabel(u.lastLoginAt)}
            </span>
          </div>
        ),
      },
      {
        key: "actions",
        label: "Actions",
        width: "w-32",
        render: (u) => (
          <div className="flex items-center gap-3 text-xs">
            <Link
              href={`/admin/activity?userId=${encodeURIComponent(u.id)}`}
              onClick={(e) => e.stopPropagation()}
              className="text-cyan-400 hover:underline"
            >
              Activity
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const roleOptions = useMemo(
    () => PICKER_ROLES.map((r) => ({ value: r, label: roleLabel(r) })),
    [],
  );

  return (
    <>
      {toast && (
        <div
          role="status"
          className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            toast.startsWith("Error") ? "bg-red-600" : "bg-green-600"
          }`}
        >
          {toast}
        </div>
      )}

      <AdminPageHeader
        title="Users"
        breadcrumb={["Admin", "People", "Users"]}
        actions={
          workspace.configured ? (
            <button
              type="button"
              onClick={syncWorkspace}
              disabled={syncing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync Google Workspace"}
            </button>
          ) : undefined
        }
      />

      {workspace.configured === false && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-400">
          Google Workspace sync not configured. Add
          <code className="mx-1">GOOGLE_SERVICE_ACCOUNT_EMAIL</code>,
          <code className="mx-1">GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code>, and
          <code className="mx-1">GOOGLE_ADMIN_EMAIL</code> to enable it.
        </div>
      )}

      {workspace.configured && workspace.domain && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs text-blue-300">
          Connected to <strong>{workspace.domain}</strong>. Click &quot;Sync
          Google Workspace&quot; above to import users.
        </div>
      )}

      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <MultiSelectFilter
            label="Role"
            options={roleOptions}
            selected={roleFilters}
            onChange={setRoleFilters}
            placeholder="All roles"
            accentColor="cyan"
          />
          <FilterSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search name or email…"
            widthClass="w-64"
          />
        </AdminFilterBar>
      </div>

      {loading ? (
        <AdminLoading label="Loading users…" />
      ) : error ? (
        <AdminError error={error} onRetry={fetchUsers} />
      ) : (
        <AdminTable<AdminUser>
          caption="Users"
          rows={filtered}
          rowKey={(u) => u.id}
          columns={columns}
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onRowClick={(u) => openDrawer(u.id)}
          empty={
            <AdminEmpty
              label={
                users.length === 0
                  ? workspace.configured
                    ? "No users yet"
                    : "No users"
                  : "No users match your filters"
              }
              description={
                users.length === 0
                  ? workspace.configured
                    ? 'Click "Sync Google Workspace" to import users.'
                    : "Users will appear here after they log in."
                  : "Try clearing a filter."
              }
            />
          }
        />
      )}

      <AdminBulkActionBar
        visible={selected.size > 0}
        count={selected.size}
        onCancel={() => {
          setSelected(new Set());
          setBulkRole("");
        }}
      >
        <select
          value={bulkRole}
          onChange={(e) => setBulkRole(e.target.value)}
          className="rounded-md border border-t-border/60 bg-surface-2 px-2 py-1.5 text-xs text-foreground focus:outline-none"
          aria-label="Bulk update role"
        >
          <option value="">Select role…</option>
          {PICKER_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleBulkRoleUpdate}
          disabled={!bulkRole || saving}
          className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {saving ? "Updating…" : "Update role"}
        </button>
      </AdminBulkActionBar>

      <UserDetailDrawer
        user={drawerUser}
        canImpersonate={
          !!drawerUser &&
          drawerUser.email !== currentUserEmail &&
          !(drawerUser.roles ?? []).includes("ADMIN")
        }
        saving={saving}
        onClose={closeDrawer}
        onSaveRoles={saveRoles}
        onSavePermissions={savePermissions}
        onSaveRoutes={saveRoutes}
        onSaveHubspotOwner={saveHubspotOwner}
        onImpersonate={startImpersonation}
      />
    </>
  );
}
