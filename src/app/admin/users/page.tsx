"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface UserPermissions {
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canSyncToZuper: boolean;
  canManageUsers: boolean;
  allowedLocations: string[];
}

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canSyncToZuper: boolean;
  canManageUsers: boolean;
  allowedLocations: string[];
}

const ROLES = ["ADMIN", "MANAGER", "OPERATIONS", "DESIGNER", "PERMITTING", "VIEWER", "SALES"];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: "Full access, can manage users",
  MANAGER: "Can schedule all types, view all data",
  OPERATIONS: "Schedule installs/inspections, manage construction",
  DESIGNER: "Design & engineering dashboard access",
  PERMITTING: "Permitting & interconnection dashboard",
  VIEWER: "Read-only access to all dashboards",
  SALES: "Only access to Site Survey Scheduler",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-red-500/20 text-red-400 border-red-500/30",
  MANAGER: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  OPERATIONS: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  DESIGNER: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  PERMITTING: "bg-green-500/20 text-green-400 border-green-500/30",
  VIEWER: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  SALES: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];

const PERMISSION_LABELS: Record<keyof Omit<UserPermissions, "allowedLocations">, { label: string; description: string }> = {
  canScheduleSurveys: { label: "Schedule Surveys", description: "Can schedule site surveys" },
  canScheduleInstalls: { label: "Schedule Installs", description: "Can schedule installations & inspections" },
  canSyncToZuper: { label: "Sync to Zuper", description: "Can sync jobs to Zuper FSM" },
  canManageUsers: { label: "Manage Users", description: "Can access admin panel & manage users" },
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

  useEffect(() => {
    fetchUsers();
    checkWorkspaceConfig();
  }, [fetchUsers, checkWorkspaceConfig]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const updateRole = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update role");
      }

      setUsers(users.map(u =>
        u.id === userId ? { ...u, role: newRole } : u
      ));
      showToast(`Role updated to ${newRole}`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUpdating(null);
    }
  };

  const openPermissionsModal = (user: User) => {
    setEditingUser(user);
    setEditPermissions({
      canScheduleSurveys: user.canScheduleSurveys,
      canScheduleInstalls: user.canScheduleInstalls,
      canSyncToZuper: user.canSyncToZuper,
      canManageUsers: user.canManageUsers,
      allowedLocations: user.allowedLocations || [],
    });
  };

  const closePermissionsModal = () => {
    setEditingUser(null);
    setEditPermissions(null);
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

      // Update local state
      setUsers(users.map(u =>
        u.id === editingUser.id
          ? { ...u, ...editPermissions }
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
    return user.canScheduleSurveys || user.canScheduleInstalls || user.canSyncToZuper || user.canManageUsers || (user.allowedLocations && user.allowedLocations.length > 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-zinc-500 text-sm mb-4">{error}</p>
          <Link href="/" className="px-4 py-2 bg-zinc-700 rounded-lg hover:bg-zinc-600">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.startsWith("Error") ? "bg-red-600" : "bg-green-600"
        }`}>
          {toast}
        </div>
      )}

      {/* Permissions Modal */}
      {editingUser && editPermissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closePermissionsModal} />
          <div className="relative bg-zinc-900 rounded-2xl border border-zinc-700 w-full max-w-lg mx-4 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold">Edit Permissions</h2>
                <p className="text-sm text-zinc-400">{editingUser.name || editingUser.email}</p>
              </div>
              <button
                onClick={closePermissionsModal}
                className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Permission Toggles */}
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Action Permissions</h3>
              {(Object.keys(PERMISSION_LABELS) as Array<keyof Omit<UserPermissions, "allowedLocations">>).map(key => (
                <label
                  key={key}
                  className="flex items-center justify-between p-3 bg-zinc-800 rounded-lg cursor-pointer hover:bg-zinc-750 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{PERMISSION_LABELS[key].label}</p>
                    <p className="text-xs text-zinc-500">{PERMISSION_LABELS[key].description}</p>
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
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Location Access</h3>
              <p className="text-xs text-zinc-500 mb-3">Empty = access to all locations</p>
              <div className="grid grid-cols-2 gap-2">
                {LOCATIONS.map(location => (
                  <label
                    key={location}
                    className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                      editPermissions.allowedLocations.includes(location)
                        ? "bg-cyan-500/20 border border-cyan-500/50"
                        : "bg-zinc-800 border border-transparent hover:bg-zinc-750"
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
                        : "border-zinc-600"
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

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={closePermissionsModal}
                className="flex-1 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={savePermissions}
                disabled={updating === editingUser.id}
                className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {updating === editingUser.id ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">User Management</h1>
              <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded">
                {users.length} users
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white px-3 py-1.5 rounded-lg bg-zinc-800">
                Users
              </span>
              <Link
                href="/admin/activity"
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
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
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Workspace Sync Info */}
        {workspaceConfigured === false && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-yellow-400">Google Workspace sync not configured</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  To enable automatic user sync, add these environment variables:
                </p>
                <ul className="text-xs text-zinc-500 mt-2 space-y-1 font-mono">
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
                <p className="text-xs text-zinc-400 mt-0.5">
                  Click &quot;Sync Google Workspace&quot; to import all users from <strong>{workspaceDomain}</strong>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Role Legend */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
          <h2 className="text-sm font-semibold mb-3 text-zinc-400">Role Permissions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {ROLES.map(role => (
              <div key={role} className="text-xs">
                <span className={`inline-block px-2 py-1 rounded border ${ROLE_COLORS[role] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"}`}>
                  {role}
                </span>
                <p className="mt-1 text-zinc-500">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Permissions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase">Last Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{user.name || "No name"}</p>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user.id, e.target.value)}
                      disabled={updating === user.id}
                      className={`px-3 py-1.5 rounded border text-sm bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500 ${ROLE_COLORS[user.role] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"} ${updating === user.id ? "opacity-50" : ""}`}
                    >
                      {ROLES.map(role => (
                        <option key={role} value={role} className="bg-zinc-900 text-white">
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openPermissionsModal(user)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
                    >
                      {hasCustomPermissions(user) ? (
                        <>
                          <span className="w-2 h-2 bg-cyan-400 rounded-full" />
                          <span className="text-cyan-400">Custom</span>
                        </>
                      ) : (
                        <>
                          <span className="text-zinc-400">Default</span>
                        </>
                      )}
                      <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Never"
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="p-8 text-center text-zinc-500">
              No users found. {workspaceConfigured ? "Click \"Sync Google Workspace\" to import users." : "Users will appear here after they log in."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
