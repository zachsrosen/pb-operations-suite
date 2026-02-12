"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ----- Types -----

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
  image: string | null;
}

interface LoginRecord {
  id: string;
  userEmail: string | null;
  userName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface RoleChangeRecord {
  id: string;
  userEmail: string | null;
  userName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  ipAddress: string | null;
}

interface ImpersonationRecord {
  id: string;
  userEmail: string | null;
  userName: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  ipAddress: string | null;
}

interface AdminActionRecord {
  id: string;
  type: string;
  userEmail: string | null;
  userName: string | null;
  description: string;
  createdAt: string;
  ipAddress: string | null;
}

interface IpRecord {
  ip: string;
  userCount: number;
  users: string[];
}

interface SecurityAuditData {
  users: UserRecord[];
  adminUsers: UserRecord[];
  suspiciousEmails: UserRecord[];
  recentLogins: LoginRecord[];
  roleChanges: RoleChangeRecord[];
  impersonationEvents: ImpersonationRecord[];
  adminActions: AdminActionRecord[];
  ipAnalysis: IpRecord[];
  totalActivityCount: number;
  generatedAt: string;
}

// ----- Collapsible Section Component -----

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 font-mono">
            {open ? "\u25BC" : "\u25B6"}
          </span>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {count !== undefined && (
            <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </div>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ----- Main Page Component -----

export default function SecurityAuditPage() {
  const [data, setData] = useState<SecurityAuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/security");
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to fetch security audit data");
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatRelative = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDate(dateString);
  };

  // ----- Error State -----
  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-2">Error</p>
          <p className="text-gray-400 text-sm mb-4">{error}</p>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // ----- Loading State -----
  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading security audit...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-gray-900/95 backdrop-blur border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-400 hover:text-foreground">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </Link>
              <h1 className="text-xl font-bold">Security Audit</h1>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                Generated {formatRelative(data.generatedAt)}
              </span>
              <button
                onClick={fetchData}
                className="text-gray-400 hover:text-foreground p-2 rounded-lg hover:bg-gray-800 transition-colors"
                title="Refresh"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>

              {/* Nav links */}
              <Link
                href="/admin/users"
                className="text-xs text-gray-400 hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Users
              </Link>
              <Link
                href="/admin/activity"
                className="text-xs text-gray-400 hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Activity
              </Link>
              <span className="text-xs text-white px-3 py-1.5 rounded-lg bg-gray-800">
                Security
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Section 1: Alert Banner */}
        {data.suspiciousEmails.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h3 className="text-red-400 font-semibold text-sm">
                  Non-Organization Emails Detected
                </h3>
                <p className="text-red-300/80 text-xs mt-1">
                  {data.suspiciousEmails.length} user(s) with email addresses
                  outside @photonbrothers.com:
                </p>
                <ul className="mt-2 space-y-1">
                  {data.suspiciousEmails.map((u) => (
                    <li
                      key={u.id}
                      className="text-red-300 text-xs font-mono flex items-center gap-2"
                    >
                      <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                      {u.email}{" "}
                      <span className="text-red-400/60">
                        (role: {u.role})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Total Users</div>
            <div className="text-2xl font-bold text-foreground">
              {data.users.length}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Admin Users</div>
            <div className="text-2xl font-bold text-amber-400">
              {data.adminUsers.length}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">
              Logins (90 days)
            </div>
            <div className="text-2xl font-bold text-green-400">
              {data.recentLogins.length}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">
              Total Activity Logs
            </div>
            <div className="text-2xl font-bold text-cyan-400">
              {data.totalActivityCount}
            </div>
          </div>
        </div>

        {/* Section 3: Admin Users */}
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            Admin Users
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.adminUsers.map((admin) => (
              <div
                key={admin.id}
                className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4"
              >
                <div className="flex items-center gap-3">
                  {admin.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={admin.image}
                      alt=""
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-bold text-sm">
                      {(admin.name || admin.email)[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-300 truncate">
                      {admin.name || "No Name"}
                    </p>
                    <p className="text-xs text-amber-400/70 truncate">
                      {admin.email}
                    </p>
                    <p className="text-xs text-amber-400/50 mt-0.5">
                      Last login: {formatDate(admin.lastLoginAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: User Roster */}
        <CollapsibleSection
          title="User Roster"
          count={data.users.length}
          defaultOpen={true}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Email</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2">Last Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.users.map((u) => (
                  <tr
                    key={u.id}
                    className={
                      u.role === "ADMIN"
                        ? "bg-amber-500/5"
                        : "hover:bg-gray-750"
                    }
                  >
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        {u.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={u.image}
                            alt=""
                            className="w-6 h-6 rounded-full"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
                            {(u.name || u.email)[0].toUpperCase()}
                          </div>
                        )}
                        <span className="text-white">
                          {u.name || "No Name"}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-gray-400 font-mono text-xs">
                      {u.email}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          u.role === "ADMIN"
                            ? "bg-amber-500/10 text-amber-400"
                            : u.role === "MANAGER"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400 text-xs">
                      {formatDate(u.lastLoginAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* Section 4: Login History */}
        <CollapsibleSection
          title="Login History (90 days)"
          count={data.recentLogins.length}
          defaultOpen={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2 pr-4">IP Address</th>
                  <th className="pb-2">User Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.recentLogins.map((login) => (
                  <tr key={login.id} className="hover:bg-gray-750">
                    <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(login.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-white text-xs">
                      {login.userName || login.userEmail || "Unknown"}
                    </td>
                    <td className="py-2 pr-4 text-gray-400 font-mono text-xs">
                      {login.ipAddress || "N/A"}
                    </td>
                    <td className="py-2 text-gray-500 text-xs truncate max-w-xs">
                      {login.userAgent || "N/A"}
                    </td>
                  </tr>
                ))}
                {data.recentLogins.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-gray-500 text-sm"
                    >
                      No login records found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* Section 5: Role Changes */}
        <CollapsibleSection
          title="Role Changes"
          count={data.roleChanges.length}
          defaultOpen={true}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Changed By</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.roleChanges.map((rc) => (
                  <tr key={rc.id} className="hover:bg-gray-750">
                    <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(rc.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-white text-xs">
                      {rc.userName || rc.userEmail || "Unknown"}
                    </td>
                    <td className="py-2 text-gray-300 text-xs">
                      {rc.description}
                    </td>
                  </tr>
                ))}
                {data.roleChanges.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-6 text-center text-gray-500 text-sm"
                    >
                      No role changes recorded
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* Section 6: Impersonation Log */}
        <CollapsibleSection
          title="Impersonation Log"
          count={data.impersonationEvents.length}
          defaultOpen={true}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">User</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.impersonationEvents.map((evt) => (
                  <tr key={evt.id} className="hover:bg-gray-750">
                    <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(evt.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-white text-xs">
                      {evt.userName || evt.userEmail || "Unknown"}
                    </td>
                    <td className="py-2 text-gray-300 text-xs">
                      {evt.description}
                    </td>
                  </tr>
                ))}
                {data.impersonationEvents.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-6 text-center text-gray-500 text-sm"
                    >
                      No impersonation events recorded
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* Section 7: IP Analysis */}
        <CollapsibleSection
          title="IP Analysis"
          count={data.ipAnalysis.length}
          defaultOpen={true}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">IP Address</th>
                  <th className="pb-2 pr-4">User Count</th>
                  <th className="pb-2">Users</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.ipAnalysis.map((ip) => (
                  <tr
                    key={ip.ip}
                    className={
                      ip.userCount >= 3
                        ? "bg-amber-500/5"
                        : "hover:bg-gray-750"
                    }
                  >
                    <td className="py-2 pr-4 text-gray-300 font-mono text-xs">
                      {ip.ip}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          ip.userCount >= 3
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {ip.userCount}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400 text-xs">
                      {ip.users.join(", ")}
                    </td>
                  </tr>
                ))}
                {data.ipAnalysis.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-6 text-center text-gray-500 text-sm"
                    >
                      No IP data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>

        {/* Admin Actions (bonus - last 90 days) */}
        <CollapsibleSection
          title="Admin Actions (90 days)"
          count={data.adminActions.length}
          defaultOpen={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Admin</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.adminActions.map((action) => (
                  <tr key={action.id} className="hover:bg-gray-750">
                    <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">
                      {formatDate(action.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-white text-xs">
                      {action.userName || action.userEmail || "Unknown"}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">
                        {action.type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-2 text-gray-300 text-xs">
                      {action.description}
                    </td>
                  </tr>
                ))}
                {data.adminActions.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-gray-500 text-sm"
                    >
                      No admin actions recorded
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
