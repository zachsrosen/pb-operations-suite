"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ROLES as ROLE_DEFS } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

interface UserPermissions {
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canScheduleInspections: boolean;
  canSyncToZuper: boolean;
  canManageUsers: boolean;
  canManageAvailability: boolean;
  allowedLocations: string[];
}

interface User {
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
  oldValue?: string;
  newValue?: string;
  description: string;
}

// Canonical picker-eligible roles (visibleInPicker === true), derived from the
// single source of truth in @/lib/roles. Order follows ROLE_DEFS insertion.
const PICKER_ROLES: string[] = (Object.entries(ROLE_DEFS) as Array<[string, (typeof ROLE_DEFS)[UserRole]]>)
  .filter(([, def]) => def.visibleInPicker)
  .map(([role]) => role);

const getRoleLabel = (role: string): string => {
  const def = ROLE_DEFS[role as UserRole];
  return def?.badge.abbrev ?? role;
};

const getRoleDescription = (role: string): string =>
  ROLE_DEFS[role as UserRole]?.description ?? "";

// Static map — Tailwind's JIT can't expand template literals.
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
};

const getRoleBadgeClasses = (role: string): string => {
  const color = ROLE_DEFS[role as UserRole]?.badge.color ?? "zinc";
  return ROLE_BADGE_BY_COLOR[color] ?? ROLE_BADGE_BY_COLOR.zinc;
};

const getUserRoles = (user: User): string[] => user.roles ?? [];

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

const PERMISSION_LABELS: Record<keyof Omit<UserPermissions, "allowedLocations">, { label: string; description: string }> = {
  canScheduleSurveys: { label: "Schedule Surveys", description: "Can schedule site surveys" },
  canScheduleInstalls: { label: "Schedule Installs", description: "Can schedule installations" },
  canScheduleInspections: { label: "Schedule Inspections", description: "Can schedule inspections" },
  canSyncToZuper: { label: "Sync to Zuper", description: "Can sync jobs to Zuper FSM" },
  canManageUsers: { label: "Manage Users", description: "Can access admin panel & manage users" },
  canManageAvailability: { label: "Manage Availability", description: "Can add/edit/remove crew time slot schedules" },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [workspaceConfigured, setWorkspaceConfigured] = useState<boolean | null>(null);
  const [workspaceDomain, setWorkspaceDomain] = useState<string>("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPermissions, setEditPermissions] = useState<UserPermissions | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("All");
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [bulkUpdateRole, setBulkUpdateRole] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<Record<string, ActivityLog[]>>({});
  const [rolesEditorUserId, setRolesEditorUserId] = useState<string | null>(null);
  const [rolesEditorSelection, setRolesEditorSelection] = useState<string[]>([]);
  // Per-user extra route overrides (Option D). Synced with the permissions
  // modal — same target user, same open/close lifecycle. Null means not open.
  const [editExtraAllowed, setEditExtraAllowed] = useState<string[] | null>(null);
  const [editExtraDenied, setEditExtraDenied] = useState<string[] | null>(null);
  const [extraAllowedInput, setExtraAllowedInput] = useState("");
  const [extraDeniedInput, setExtraDeniedInput] = useState("");

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch users");
      }
      const data = await response.json();
      setUsers(data.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkWorkspaceConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/sync-workspace");
      if (response.ok) {
        const data = await response.json();
        setWorkspaceConfigured(data.configured);
        setWorkspaceDomain(data.domain);
      }
    } catch {
      setWorkspaceConfigured(false);
    }
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await fetch("/api/user/me");
      if (response.ok) {
        const data = await response.json();
        setCurrentUserEmail(data.user?.email || null);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    checkWorkspaceConfig();
    fetchCurrentUser();
  }, [fetchUsers, checkWorkspaceConfig, fetchCurrentUser]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const updateRoles = async (userId: string, newRoles: string[]) => {
    if (newRoles.length === 0) {
      showToast("Error: Pick at least one role");
      return;
    }
    setUpdating(userId);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roles: newRoles }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update roles");
      }

      setUsers(users.map(u =>
        u.id === userId ? { ...u, roles: newRoles, role: newRoles[0] } : u
      ));
      showToast(
        newRoles.length === 1
          ? `Role updated to ${getRoleLabel(newRoles[0])}`
          : `Roles updated: ${newRoles.map(getRoleLabel).join(", ")}`
      );
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUpdating(null);
    }
  };

  const openRolesEditor = (user: User) => {
    setRolesEditorUserId(user.id);
    setRolesEditorSelection(getUserRoles(user));
  };

  const closeRolesEditor = () => {
    setRolesEditorUserId(null);
    setRolesEditorSelection([]);
  };

  const toggleRoleInEditor = (role: string) => {
    setRolesEditorSelection((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const saveRolesEditor = async () => {
    if (!rolesEditorUserId) return;
    await updateRoles(rolesEditorUserId, rolesEditorSelection);
    closeRolesEditor();
  };

  const openPermissionsModal = (user: User) => {
    setEditingUser(user);
    setEditPermissions({
      canScheduleSurveys: user.canScheduleSurveys,
      canScheduleInstalls: user.canScheduleInstalls,
      canScheduleInspections: user.canScheduleInspections,
      canSyncToZuper: user.canSyncToZuper,
      canManageUsers: user.canManageUsers,
      canManageAvailability: user.canManageAvailability,
      allowedLocations: user.allowedLocations || [],
    });
    setEditExtraAllowed(user.extraAllowedRoutes ?? []);
    setEditExtraDenied(user.extraDeniedRoutes ?? []);
    setExtraAllowedInput("");
    setExtraDeniedInput("");
    // Fetch activity logs for this user
    fetchActivityLogs(user.id);
  };

  const fetchActivityLogs = useCallback(async (userId: string) => {
    try {
      const response = await fetch(`/api/admin/activity?type=USER_ROLE_CHANGED&userId=${userId}&limit=3`);
      if (response.ok) {
        const data = await response.json();
        setActivityLogs(prev => ({
          ...prev,
          [userId]: data.logs || [],
        }));
      }
    } catch {
      // Silently fail, activity logs are optional
    }
  }, []);

  const closePermissionsModal = () => {
    setEditingUser(null);
    setEditPermissions(null);
    setEditExtraAllowed(null);
    setEditExtraDenied(null);
    setExtraAllowedInput("");
    setExtraDeniedInput("");
  };

  const savePermissions = async () => {
    if (!editingUser || !editPermissions) return;

    setUpdating(editingUser.id);
    try {
      const response = await fetch("/api/admin/users/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          permissions: editPermissions,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update permissions");
      }

      // Also save per-user extra routes if they've been edited in this modal
      // session (state is seeded on open from the user row, so a no-op save
      // still sends the current state — server is idempotent).
      if (editExtraAllowed !== null && editExtraDenied !== null) {
        const extraRes = await fetch(
          `/api/admin/users/${editingUser.id}/extra-routes`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              extraAllowedRoutes: editExtraAllowed,
              extraDeniedRoutes: editExtraDenied,
            }),
          },
        );
        if (!extraRes.ok) {
          const data = await extraRes.json().catch(() => ({}));
          throw new Error(data.error || "Failed to update extra routes");
        }
      }

      // Update local state
      setUsers(users.map(u =>
        u.id === editingUser.id
          ? {
              ...u,
              ...editPermissions,
              extraAllowedRoutes: editExtraAllowed ?? u.extraAllowedRoutes,
              extraDeniedRoutes: editExtraDenied ?? u.extraDeniedRoutes,
            }
          : u
      ));
      showToast("Permissions updated successfully");
      closePermissionsModal();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUpdating(null);
    }
  };

  const togglePermission = (key: keyof Omit<UserPermissions, "allowedLocations">) => {
    if (!editPermissions) return;
    setEditPermissions({
      ...editPermissions,
      [key]: !editPermissions[key],
    });
  };

  const toggleLocation = (location: string) => {
    if (!editPermissions) return;
    const current = editPermissions.allowedLocations;
    const updated = current.includes(location)
      ? current.filter(l => l !== location)
      : [...current, location];
    setEditPermissions({
      ...editPermissions,
      allowedLocations: updated,
    });
  };

  const syncWorkspace = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/admin/sync-workspace", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync");
      }

      showToast(`Synced: ${data.results.created} new, ${data.results.updated} updated`);
      await fetchUsers();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  };

  const hasCustomPermissions = (user: User) => {
    return user.canScheduleSurveys || user.canScheduleInstalls || user.canScheduleInspections || user.canSyncToZuper || user.canManageUsers || (user.allowedLocations && user.allowedLocations.length > 0);
  };

  const getLastActiveIndicator = (lastLoginAt: string | null): { color: string; label: string; time: string } => {
    if (!lastLoginAt) {
      return { color: "bg-red-500", label: "Never", time: "Never logged in" };
    }

    const now = new Date();
    const lastLogin = new Date(lastLoginAt);
    const diffMs = now.getTime() - lastLogin.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffDays < 1) {
      const hours = Math.floor(diffHours);
      return { color: "bg-green-500", label: `${hours}h ago`, time: `${hours}h` };
    } else if (diffDays < 7) {
      const days = Math.floor(diffDays);
      return { color: "bg-yellow-500", label: `${days}d ago`, time: `${days}d` };
    } else {
      return { color: "bg-red-500", label: `${Math.floor(diffDays)}d ago`, time: `${Math.floor(diffDays)}d` };
    }
  };

  const filterUsers = () => {
    return users.filter(user => {
      const matchesSearch = searchQuery === "" ||
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRole =
        selectedRole === "All" || getUserRoles(user).includes(selectedRole);

      return matchesSearch && matchesRole;
    });
  };

  const getActiveCount = () => {
    const now = new Date();
    return users.filter(user => {
      if (!user.lastLoginAt) return false;
      const lastLogin = new Date(user.lastLoginAt);
      const diffDays = (now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays < 7;
    }).length;
  };

  const getAdminCount = () => {
    return users.filter(user => getUserRoles(user).includes("ADMIN")).length;
  };

  const handleSelectUser = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleSelectAll = () => {
    const filtered = filterUsers();
    if (selectedUsers.size === filtered.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filtered.map(u => u.id)));
    }
  };

  const handleBulkRoleUpdate = async () => {
    if (!bulkUpdateRole || selectedUsers.size === 0) return;

    setUpdating("bulk");
    try {
      const response = await fetch("/api/admin/users/bulk-role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: Array.from(selectedUsers),
          role: bulkUpdateRole,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update roles");
      }

      // Update local state — bulk assignment sets a single role for each user.
      setUsers(users.map(u =>
        selectedUsers.has(u.id) ? { ...u, role: bulkUpdateRole, roles: [bulkUpdateRole] } : u
      ));
      showToast(`Updated ${selectedUsers.size} users to ${getRoleLabel(bulkUpdateRole)}`);
      setSelectedUsers(new Set());
      setBulkUpdateRole(null);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUpdating(null);
    }
  };

  const startImpersonation = async (user: User) => {
    // Don't allow impersonating yourself
    if (user.email === currentUserEmail) {
      showToast("Error: Cannot impersonate yourself");
      return;
    }

    setImpersonating(user.id);
    try {
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: user.id,
          reason: "Admin review via User Management",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to start impersonation");
      }

      showToast(`Now viewing as ${user.name || user.email}`);
      // Reload the page to reset all UI state
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImpersonating(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-muted text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-surface-2 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.startsWith("Error") ? "bg-red-600" : "bg-green-600"
        }`}>
          {toast}
        </div>
      )}

      {/* Roles Editor Modal */}
      {rolesEditorUserId && (() => {
        const targetUser = users.find((u) => u.id === rolesEditorUserId);
        if (!targetUser) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeRolesEditor} />
            <div className="relative bg-surface rounded-2xl border border-t-border w-full max-w-md mx-4 p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">Edit Roles</h2>
                  <p className="text-sm text-muted">{targetUser.name || targetUser.email}</p>
                </div>
                <button
                  onClick={closeRolesEditor}
                  className="p-2 hover:bg-surface-2 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-xs text-muted mb-3">
                Select one or more roles. The user&apos;s effective access is the union of every selected role.
              </p>

              <div className="space-y-2 mb-6">
                {PICKER_ROLES.map((role) => {
                  const checked = rolesEditorSelection.includes(role);
                  return (
                    <label
                      key={role}
                      className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors border ${
                        checked
                          ? "bg-cyan-500/10 border-cyan-500/40"
                          : "bg-surface-2 border-transparent hover:bg-surface-elevated"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRoleInEditor(role)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block px-2 py-0.5 rounded border text-xs ${getRoleBadgeClasses(role)}`}>
                            {getRoleLabel(role)}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1">{getRoleDescription(role)}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={closeRolesEditor}
                  className="flex-1 px-4 py-2.5 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveRolesEditor}
                  disabled={updating === rolesEditorUserId || rolesEditorSelection.length === 0}
                  className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {updating === rolesEditorUserId ? "Saving..." : "Save Roles"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Permissions Modal */}
      {editingUser && editPermissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closePermissionsModal} />
          <div className="relative bg-surface rounded-2xl border border-t-border w-full max-w-lg mx-4 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6 sticky top-0 bg-surface">
              <div>
                <h2 className="text-lg font-bold">Edit Permissions</h2>
                <p className="text-sm text-muted">{editingUser.name || editingUser.email}</p>
              </div>
              <button
                onClick={closePermissionsModal}
                className="p-2 hover:bg-surface-2 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Permission Toggles */}
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-medium text-muted mb-2">Action Permissions</h3>
              {(Object.keys(PERMISSION_LABELS) as Array<keyof Omit<UserPermissions, "allowedLocations">>).map(key => (
                <label
                  key={key}
                  className="flex items-center justify-between p-3 bg-surface-2 rounded-lg cursor-pointer hover:bg-surface-elevated transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{PERMISSION_LABELS[key].label}</p>
                    <p className="text-xs text-muted">{PERMISSION_LABELS[key].description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePermission(key)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      editPermissions[key] ? "bg-cyan-500" : "bg-zinc-600"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        editPermissions[key] ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </label>
              ))}
            </div>

            {/* Location Restrictions */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-muted mb-2">Location Access</h3>
              <p className="text-xs text-muted mb-3">Empty = access to all locations</p>
              <div className="grid grid-cols-2 gap-2">
                {LOCATIONS.map(location => (
                  <label
                    key={location}
                    className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                      editPermissions.allowedLocations.includes(location)
                        ? "bg-cyan-500/20 border border-cyan-500/50"
                        : "bg-surface-2 border border-transparent hover:bg-surface-elevated"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={editPermissions.allowedLocations.includes(location)}
                      onChange={() => toggleLocation(location)}
                      className="sr-only"
                    />
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                      editPermissions.allowedLocations.includes(location)
                        ? "border-cyan-500 bg-cyan-500"
                        : "border-t-border"
                    }`}>
                      {editPermissions.allowedLocations.includes(location) && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm">{location}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Per-user Extra Routes (Option D) */}
            {editExtraAllowed !== null && editExtraDenied !== null && (
              <div className="mb-6 pb-6 border-t border-t-border pt-4">
                <h3 className="text-sm font-medium text-foreground mb-1">Per-user extra routes</h3>
                <p className="text-xs text-muted mb-4">
                  Grant or revoke specific paths without changing the role. Paths start with
                  &quot;/&quot;. Denials win over grants and even override an ADMIN wildcard.
                  Changes apply on the user&apos;s next sign-in (JWT refresh ≤ 5 min).
                </p>

                {/* Allow list */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Extra allowed ({editExtraAllowed.length})
                    </span>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={extraAllowedInput}
                      onChange={(e) => setExtraAllowedInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const path = extraAllowedInput.trim();
                          if (path && path.startsWith("/") && !editExtraAllowed.includes(path)) {
                            setEditExtraAllowed([...editExtraAllowed, path]);
                          }
                          setExtraAllowedInput("");
                        }
                      }}
                      placeholder="/dashboards/executive"
                      className="flex-1 px-3 py-2 bg-skeleton border border-t-border rounded-lg text-sm text-foreground placeholder-muted focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const path = extraAllowedInput.trim();
                        if (path && path.startsWith("/") && !editExtraAllowed.includes(path)) {
                          setEditExtraAllowed([...editExtraAllowed, path]);
                        }
                        setExtraAllowedInput("");
                      }}
                      disabled={
                        !extraAllowedInput.trim().startsWith("/") ||
                        editExtraAllowed.includes(extraAllowedInput.trim())
                      }
                      className="px-3 py-2 bg-surface-2 hover:bg-surface-elevated rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add
                    </button>
                  </div>
                  {editExtraAllowed.length === 0 ? (
                    <p className="text-xs text-muted italic">No extra allowed paths.</p>
                  ) : (
                    <ul className="space-y-1">
                      {editExtraAllowed.map((path) => (
                        <li
                          key={path}
                          className="flex items-center justify-between rounded border border-t-border bg-skeleton px-2 py-1 text-xs"
                        >
                          <code className="text-foreground">{path}</code>
                          <button
                            type="button"
                            onClick={() =>
                              setEditExtraAllowed(editExtraAllowed.filter((p) => p !== path))
                            }
                            className="text-muted hover:text-foreground"
                            aria-label={`Remove ${path}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Deny list */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Extra denied ({editExtraDenied.length})
                    </span>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={extraDeniedInput}
                      onChange={(e) => setExtraDeniedInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const path = extraDeniedInput.trim();
                          if (path && path.startsWith("/") && !editExtraDenied.includes(path)) {
                            setEditExtraDenied([...editExtraDenied, path]);
                          }
                          setExtraDeniedInput("");
                        }
                      }}
                      placeholder="/dashboards/sensitive-thing"
                      className="flex-1 px-3 py-2 bg-skeleton border border-t-border rounded-lg text-sm text-foreground placeholder-muted focus:outline-none focus:border-red-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const path = extraDeniedInput.trim();
                        if (path && path.startsWith("/") && !editExtraDenied.includes(path)) {
                          setEditExtraDenied([...editExtraDenied, path]);
                        }
                        setExtraDeniedInput("");
                      }}
                      disabled={
                        !extraDeniedInput.trim().startsWith("/") ||
                        editExtraDenied.includes(extraDeniedInput.trim())
                      }
                      className="px-3 py-2 bg-surface-2 hover:bg-surface-elevated rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add
                    </button>
                  </div>
                  {editExtraDenied.length === 0 ? (
                    <p className="text-xs text-muted italic">No explicitly denied paths.</p>
                  ) : (
                    <ul className="space-y-1">
                      {editExtraDenied.map((path) => (
                        <li
                          key={path}
                          className="flex items-center justify-between rounded border border-t-border bg-skeleton px-2 py-1 text-xs"
                        >
                          <code className="text-foreground">{path}</code>
                          <button
                            type="button"
                            onClick={() =>
                              setEditExtraDenied(editExtraDenied.filter((p) => p !== path))
                            }
                            className="text-muted hover:text-foreground"
                            aria-label={`Remove ${path}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Recent Changes */}
            {activityLogs[editingUser.id] && activityLogs[editingUser.id].length > 0 && (
              <div className="mb-6 pb-6 border-t border-t-border pt-4">
                <h3 className="text-sm font-medium text-muted mb-3">Recent Changes</h3>
                <div className="space-y-2">
                  {activityLogs[editingUser.id].map(log => (
                    <div key={log.id} className="p-2 bg-skeleton rounded text-xs">
                      <p className="text-foreground/80">{log.description}</p>
                      <p className="text-muted/70 text-xs mt-0.5">
                        {new Date(log.timestamp).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 sticky bottom-0 bg-surface pt-4 border-t border-t-border">
              <button
                onClick={closePermissionsModal}
                className="flex-1 px-4 py-2.5 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={savePermissions}
                disabled={updating === editingUser.id}
                className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {updating === editingUser.id ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-t-border">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-muted hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">User Management</h1>
              <span className="text-xs text-muted bg-surface-2 px-2 py-1 rounded">
                {users.length} users
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white px-3 py-1.5 rounded-lg bg-surface-2">
                Users
              </span>
              <Link
                href="/admin/crew-availability"
                className="text-xs text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                Crew Availability
              </Link>
              <Link
                href="/admin/activity"
                className="text-xs text-muted hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
              >
                Activity
              </Link>
              {/* Sync Button */}
              {workspaceConfigured && (
              <button
                onClick={syncWorkspace}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {syncing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sync Google Workspace
                  </>
                )}
              </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Workspace Sync Info */}
        {workspaceConfigured === false && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-yellow-400">Google Workspace sync not configured</h3>
                <p className="text-xs text-muted mt-1">
                  To enable automatic user sync, add these environment variables:
                </p>
                <ul className="text-xs text-muted mt-2 space-y-1 font-mono">
                  <li>GOOGLE_SERVICE_ACCOUNT_EMAIL</li>
                  <li>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</li>
                  <li>GOOGLE_ADMIN_EMAIL</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {workspaceConfigured && (
          <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-blue-400">Google Workspace connected</h3>
                <p className="text-xs text-muted mt-0.5">
                  Click &quot;Sync Google Workspace&quot; to import all users from <strong>{workspaceDomain}</strong>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* User Count Summary */}
        {users.length > 0 && (
          <div className="mb-6 p-4 bg-surface rounded-xl border border-t-border">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-foreground/80 font-medium">{users.length} users total</span>
              <span className="text-muted/70">•</span>
              <span className="text-foreground/80">{getAdminCount()} admins</span>
              <span className="text-muted/70">•</span>
              <span className="text-foreground/80">{getActiveCount()} active in last 7 days</span>
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div className="mb-6 space-y-4">
          {/* Search Input */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-surface-2 border border-t-border rounded-lg text-white placeholder-muted focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
          </div>

          {/* Role Filters */}
          <div className="flex flex-wrap gap-2">
            {["All", ...PICKER_ROLES].map(role => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedRole === role
                    ? "bg-cyan-600 text-white"
                    : "bg-surface-2 text-foreground/80 hover:bg-surface-2"
                }`}
              >
                {role === "All" ? "All" : getRoleLabel(role)}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk Update Section */}
        {selectedUsers.size > 0 && (
          <div className="mb-6 p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-cyan-300 font-medium">{selectedUsers.size} user{selectedUsers.size !== 1 ? 's' : ''} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={bulkUpdateRole || ""}
                onChange={(e) => setBulkUpdateRole(e.target.value || null)}
                className="px-3 py-1.5 bg-surface-2 border border-t-border rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">Select role...</option>
                {PICKER_ROLES.map(role => (
                  <option key={role} value={role}>
                    {getRoleLabel(role)}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBulkRoleUpdate}
                disabled={!bulkUpdateRole || updating === "bulk"}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                {updating === "bulk" ? "Updating..." : "Update Roles"}
              </button>
            </div>
          </div>
        )}

        {/* Role Legend */}
        <div className="mb-6 p-4 bg-surface rounded-xl border border-t-border">
          <h2 className="text-sm font-semibold mb-3 text-muted">Role Permissions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {PICKER_ROLES.map(role => (
              <div key={role} className="text-xs">
                <span className={`inline-block px-2 py-1 rounded border ${getRoleBadgeClasses(role)}`}>
                  {getRoleLabel(role)}
                </span>
                <p className="mt-1 text-muted">{getRoleDescription(role)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-surface rounded-xl border border-t-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-3 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selectedUsers.size > 0 && selectedUsers.size === filterUsers().length && filterUsers().length > 0}
                    onChange={handleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Permissions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-t-border">
              {filterUsers().map(user => {
                const indicator = getLastActiveIndicator(user.lastLoginAt);
                return (
                  <tr key={user.id} className="hover:bg-skeleton">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(user.id)}
                        onChange={() => handleSelectUser(user.id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{user.name || "No name"}</p>
                        <p className="text-xs text-muted">{user.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1 flex-wrap">
                          {getUserRoles(user).map((role) => (
                            <span
                              key={`${user.id}-${role}`}
                              className={`inline-block px-2 py-0.5 rounded border text-xs ${getRoleBadgeClasses(role)}`}
                            >
                              {getRoleLabel(role)}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openRolesEditor(user)}
                          disabled={updating === user.id}
                          className={`px-2 py-0.5 text-xs rounded border border-t-border hover:bg-surface-2 transition-colors ${updating === user.id ? "opacity-50" : ""}`}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${indicator.color}`} title={indicator.time} />
                        <span className="text-xs text-muted">{indicator.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openPermissionsModal(user)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-2 rounded-lg text-sm transition-colors"
                      >
                        {hasCustomPermissions(user) ? (
                          <>
                            <span className="w-2 h-2 bg-cyan-400 rounded-full" />
                            <span className="text-cyan-400">Custom</span>
                          </>
                        ) : (
                          <>
                            <span className="text-muted">Default</span>
                          </>
                        )}
                        <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {user.email !== currentUserEmail && !getUserRoles(user).includes("ADMIN") && (
                        <button
                          onClick={() => startImpersonation(user)}
                          disabled={impersonating === user.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-sm transition-colors disabled:opacity-50"
                          title={`View as ${user.name || user.email}`}
                        >
                          {impersonating === user.id ? (
                            <>
                              <div className="w-3 h-3 border-2 border-amber-400/50 border-t-amber-400 rounded-full animate-spin" />
                              <span>Starting...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              <span>View As</span>
                            </>
                          )}
                        </button>
                      )}
                      {getUserRoles(user).includes("ADMIN") && user.email !== currentUserEmail && (
                        <span className="text-xs text-muted/70">Cannot impersonate admins</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filterUsers().length === 0 && (
            <div className="p-8 text-center text-muted">
              {users.length === 0
                ? (workspaceConfigured ? "Click \"Sync Google Workspace\" to import users." : "Users will appear here after they log in.")
                : "No users match your filters."
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
