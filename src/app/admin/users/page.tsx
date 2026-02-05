"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = ["ADMIN", "MANAGER", "VIEWER", "SALES"];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: "Full access, can manage users",
  MANAGER: "Can schedule, view all data",
  VIEWER: "Read-only access to all dashboards",
  SALES: "Only access to Site Survey Scheduler",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "bg-red-500/20 text-red-400 border-red-500/30",
  MANAGER: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  VIEWER: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  SALES: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
      setToast(`Role updated to ${newRole}`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setTimeout(() => setToast(null), 3000);
    } finally {
      setUpdating(null);
    }
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

      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4">
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
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Role Legend */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
          <h2 className="text-sm font-semibold mb-3 text-zinc-400">Role Permissions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ROLES.map(role => (
              <div key={role} className="text-xs">
                <span className={`inline-block px-2 py-1 rounded border ${ROLE_COLORS[role]}`}>
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
                      className={`px-3 py-1.5 rounded border text-sm bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500 ${ROLE_COLORS[user.role]} ${updating === user.id ? "opacity-50" : ""}`}
                    >
                      {ROLES.map(role => (
                        <option key={role} value={role} className="bg-zinc-900 text-white">
                          {role}
                        </option>
                      ))}
                    </select>
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
              No users found. Users will appear here after they log in.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
