"use client";

import { useState, useEffect, useCallback } from "react";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminLoading } from "@/components/admin-shell/AdminLoading";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";

// ── Types ─────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────

function maskIp(ip: string): string {
  if (!ip) return "N/A";
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  if (ip.length > 10) return ip.slice(0, 10) + "...";
  return ip;
}

function fmtDate(ds: string | null): string {
  if (!ds) return "Never";
  return new Date(ds).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(ds: string): string {
  const diff = Date.now() - new Date(ds).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return fmtDate(ds);
}

// ── Table column definitions ──────────────────────────────────────────────

const SUSPICIOUS_EMAIL_COLUMNS: AdminTableColumn<UserRecord>[] = [
  {
    key: "email",
    label: "Email",
    render: (r) => (
      <span className="text-xs font-mono text-foreground">{r.email}</span>
    ),
  },
  {
    key: "role",
    label: "Role",
    width: "w-32",
    render: (r) => (
      <span className="text-xs bg-surface-2 text-muted rounded px-2 py-0.5">
        {r.role.replace(/_/g, " ")}
      </span>
    ),
  },
  {
    key: "createdAt",
    label: "First seen",
    width: "w-36",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtDate(r.createdAt)}</span>
    ),
  },
  {
    key: "lastLoginAt",
    label: "Last seen",
    width: "w-36",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtDate(r.lastLoginAt)}</span>
    ),
  },
];

const IP_ANALYSIS_COLUMNS: AdminTableColumn<IpRecord>[] = [
  {
    key: "ip",
    label: "IP Address",
    render: (r) => (
      <code className="text-xs rounded bg-surface-2 px-1 py-0.5">{maskIp(r.ip)}</code>
    ),
  },
  {
    key: "userCount",
    label: "User count",
    width: "w-24",
    align: "right",
    render: (r) => (
      <span
        className={`text-xs font-medium ${r.userCount >= 3 ? "text-amber-400" : "text-muted"}`}
      >
        {r.userCount}
      </span>
    ),
  },
  {
    key: "users",
    label: "Users",
    render: (r) => (
      <span className="text-xs text-muted truncate block max-w-[280px]">
        {r.users.join(", ") || "—"}
      </span>
    ),
  },
];

const ROLE_CHANGE_COLUMNS: AdminTableColumn<RoleChangeRecord>[] = [
  {
    key: "createdAt",
    label: "Time",
    width: "w-28",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.createdAt)}</span>
    ),
  },
  {
    key: "actor",
    label: "Actor",
    width: "w-44",
    render: (r) => (
      <span className="text-xs text-foreground truncate block max-w-[160px]">
        {r.userName || r.userEmail || "Unknown"}
      </span>
    ),
  },
  {
    key: "description",
    label: "Description",
    render: (r) => (
      <span className="text-xs text-muted truncate block max-w-[320px]">{r.description}</span>
    ),
  },
  {
    key: "ipAddress",
    label: "IP",
    width: "w-28",
    render: (r) => (
      <code className="text-xs rounded bg-surface-2 px-1 py-0.5">
        {r.ipAddress ? maskIp(r.ipAddress) : "—"}
      </code>
    ),
  },
];

const ADMIN_ACTION_COLUMNS: AdminTableColumn<AdminActionRecord>[] = [
  {
    key: "createdAt",
    label: "Time",
    width: "w-28",
    render: (r) => (
      <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.createdAt)}</span>
    ),
  },
  {
    key: "actor",
    label: "Actor",
    width: "w-44",
    render: (r) => (
      <span className="text-xs text-foreground truncate block max-w-[160px]">
        {r.userName || r.userEmail || "Unknown"}
      </span>
    ),
  },
  {
    key: "type",
    label: "Action",
    width: "w-44",
    render: (r) => (
      <span className="text-xs bg-surface-2 text-muted rounded px-2 py-0.5 whitespace-nowrap">
        {r.type.replace(/_/g, " ")}
      </span>
    ),
  },
  {
    key: "description",
    label: "Entity",
    render: (r) => (
      <span className="text-xs text-muted truncate block max-w-[280px]">{r.description}</span>
    ),
  },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function SecurityAuditPage() {
  const [data, setData] = useState<SecurityAuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/security");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch security audit data");
      }
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Loading / error states ───────────────────────────────────────────

  if (loading) return <AdminLoading label="Loading security audit…" />;

  if (error) {
    return (
      <div>
        <AdminPageHeader
          title="Security"
          breadcrumb={["Admin", "Audit", "Security alerts"]}
        />
        <AdminError error={error} onRetry={fetchData} />
      </div>
    );
  }

  if (!data) return null;

  const generatedSubtitle = `Generated ${fmtRelative(data.generatedAt)}`;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div>
      <AdminPageHeader
        title="Security"
        breadcrumb={["Admin", "Audit", "Security alerts"]}
        subtitle={generatedSubtitle}
        actions={
          <button
            type="button"
            onClick={fetchData}
            aria-label="Refresh"
            title="Refresh"
            className="rounded p-1.5 text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        }
      />

      <div className="space-y-8">
        {/* Alert banner — non-org emails */}
        {data.suspiciousEmails.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-red-400 mt-0.5 shrink-0"
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
                <h3 className="text-sm font-semibold text-red-400">
                  Non-Organization Emails Detected
                </h3>
                <p className="mt-1 text-xs text-red-300/80">
                  {data.suspiciousEmails.length} user(s) with email addresses outside
                  @photonbrothers.com — see table below.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Users", value: data.users.length, color: "text-foreground" },
            { label: "Admin Users", value: data.adminUsers.length, color: "text-amber-400" },
            { label: "Logins (90d)", value: data.recentLogins.length, color: "text-green-400" },
            { label: "Total Activity", value: data.totalActivityCount.toLocaleString(), color: "text-cyan-400" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-t-border/60 bg-surface p-4"
            >
              <div className="text-xs text-muted mb-1">{stat.label}</div>
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Section 1: Suspicious emails */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Suspicious Emails
            <span className="ml-2 text-xs font-normal text-muted">
              ({data.suspiciousEmails.length})
            </span>
          </h2>
          <AdminTable<UserRecord>
            caption="Users with non-organization email addresses"
            rows={data.suspiciousEmails}
            rowKey={(r) => r.id}
            columns={SUSPICIOUS_EMAIL_COLUMNS}
            empty={
              <AdminEmpty
                label="No suspicious emails"
                description="All users have @photonbrothers.com addresses"
              />
            }
          />
        </section>

        {/* Section 2: IP analysis */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            IP Analysis
            <span className="ml-2 text-xs font-normal text-muted">
              ({data.ipAnalysis.length} IPs from last 90d logins)
            </span>
          </h2>
          <AdminTable<IpRecord>
            caption="IP address analysis from recent logins"
            rows={data.ipAnalysis}
            rowKey={(r) => r.ip}
            columns={IP_ANALYSIS_COLUMNS}
            empty={
              <AdminEmpty
                label="No IP data available"
                description="No login IP addresses recorded in the last 90 days"
              />
            }
          />
        </section>

        {/* Section 3: Role changes (risk events proxy) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Role Changes
            <span className="ml-2 text-xs font-normal text-muted">
              ({data.roleChanges.length})
            </span>
          </h2>
          <AdminTable<RoleChangeRecord>
            caption="User role change events"
            rows={data.roleChanges}
            rowKey={(r) => r.id}
            columns={ROLE_CHANGE_COLUMNS}
            empty={
              <AdminEmpty
                label="No role changes recorded"
                description="No user role modifications have been logged"
              />
            }
          />
        </section>

        {/* Section 4: Admin actions (last 90d) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Admin Actions{" "}
            <span className="ml-2 text-xs font-normal text-muted">
              (last 90d · {data.adminActions.length})
            </span>
          </h2>
          <AdminTable<AdminActionRecord>
            caption="Admin user actions in the last 90 days"
            rows={data.adminActions}
            rowKey={(r) => r.id}
            columns={ADMIN_ACTION_COLUMNS}
            empty={
              <AdminEmpty
                label="No admin actions recorded"
                description="No admin activity in the last 90 days"
              />
            }
          />
        </section>
      </div>
    </div>
  );
}
