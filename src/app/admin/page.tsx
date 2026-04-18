// src/app/admin/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import SyncStatusCard from "@/components/admin-shell/SyncStatusCard";
import type { ActivityType } from "@/generated/prisma/enums";

/**
 * Dashboards that belong to admins but live outside /admin/* (they're at
 * /dashboards/*). Surfacing them here gives admins a single entry point.
 */
const ADMIN_DASHBOARDS: Array<{ href: string; title: string; description: string; icon: string }> = [
  {
    href: "/dashboards/zuper-status-comparison",
    title: "Zuper Status Comparison",
    description: "Compare Zuper job statuses against HubSpot.",
    icon: "🔄",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams.",
    icon: "📱",
  },
  {
    href: "/dashboards/availability-approvals",
    title: "Availability Approvals",
    description: "Approve or reject crew availability change requests.",
    icon: "✅",
  },
];

/**
 * Reference links — docs, prototypes, API shortcuts. Low-priority but kept
 * accessible from the admin landing so nothing from the old /suites/admin
 * is orphaned.
 */
const REFERENCE_LINKS: Array<{ href: string; label: string }> = [
  { href: "/updates", label: "Updates" },
  { href: "/guide", label: "Guide" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/handbook", label: "Handbook" },
  { href: "/sop", label: "SOPs" },
  { href: "/prototypes/home-refresh", label: "Home prototypes" },
  { href: "/prototypes/layout-refresh", label: "Layout prototypes" },
  { href: "/prototypes/solar-checkout", label: "Solar checkout proto" },
  { href: "/api/projects?stats=true", label: "Projects+Stats API" },
  { href: "/api/projects?context=pe", label: "PE Projects API" },
  { href: "/api/projects?context=scheduling", label: "Scheduling API" },
];

const ADMIN_ACTIVITY_TYPES: ActivityType[] = [
  "USER_ROLE_CHANGED",
  "USER_PERMISSIONS_CHANGED",
  "USER_CREATED",
  "USER_DELETED",
  "ROLE_CAPABILITIES_CHANGED",
  "ROLE_CAPABILITIES_RESET",
  "USER_EXTRA_ROUTES_CHANGED",
  "SETTINGS_CHANGED",
];

async function loadOverview() {
  if (!prisma) {
    return {
      usersTotal: null as number | null,
      usersActive7d: null as number | null,
      riskEvents7d: null as number | null,
      lastRiskAt: null as Date | null,
      openTickets: null as number | null,
      activity: [] as Array<{
        id: string;
        type: string;
        description: string;
        userEmail: string | null;
        createdAt: Date;
        entityType: string | null;
        entityId: string | null;
        entityName: string | null;
      }>,
      errors: { users: true, risk: true, tickets: true, activity: true },
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    usersTotal,
    usersActive7d,
    riskEvents7d,
    lastRiskRow,
    openTickets,
    activity,
  ] = await Promise.all([
    prisma.user.count().catch(() => null),
    prisma.user.count({ where: { lastLoginAt: { gt: sevenDaysAgo } } }).catch(() => null),
    prisma.activityLog
      .count({
        where: {
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          createdAt: { gt: sevenDaysAgo },
        },
      })
      .catch(() => null),
    prisma.activityLog
      .findFirst({
        where: {
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          createdAt: { gt: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      .catch(() => null),
    prisma.bugReport
      .count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } })
      .catch(() => null),
    prisma.activityLog
      .findMany({
        where: { type: { in: ADMIN_ACTIVITY_TYPES } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          description: true,
          userEmail: true,
          createdAt: true,
          entityType: true,
          entityId: true,
          entityName: true,
        },
      })
      .catch(() => [] as never[]),
  ]);

  return {
    usersTotal,
    usersActive7d,
    riskEvents7d,
    lastRiskAt: lastRiskRow?.createdAt ?? null,
    openTickets,
    activity,
    errors: {
      users: usersTotal === null,
      risk: riskEvents7d === null,
      tickets: openTickets === null,
      activity: false,
    },
  };
}

function formatRelative(date: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  if (entityType === "user") return `/admin/users?userId=${encodeURIComponent(entityId)}`;
  if (entityType === "role") return `/admin/roles/${encodeURIComponent(entityId)}`;
  return null;
}

export default async function AdminLandingPage() {
  const data = await loadOverview();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin"
        breadcrumb={["Admin"]}
        subtitle="Overview of admin-relevant activity across the system."
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Users"
          primary={data.usersTotal !== null ? String(data.usersTotal) : "—"}
          detail={
            data.usersActive7d !== null
              ? `${data.usersActive7d} active in last 7d`
              : "Data unavailable"
          }
          errored={data.errors.users}
        />
        <KpiTile
          label="Risk events (7d)"
          primary={data.riskEvents7d !== null ? String(data.riskEvents7d) : "—"}
          detail={
            data.lastRiskAt
              ? `HIGH · last: ${formatRelative(data.lastRiskAt)}`
              : data.errors.risk
                ? "Data unavailable"
                : "None in last 7d"
          }
          errored={data.errors.risk}
          accent="risk"
        />
        <KpiTile
          label="Open bug tickets"
          primary={data.openTickets !== null ? String(data.openTickets) : "—"}
          detail={data.errors.tickets ? "Data unavailable" : "0 flagged urgent"}
          errored={data.errors.tickets}
        />
      </div>

      {/* Pipeline sync status — ported from the old /suites/admin hero */}
      <SyncStatusCard />

      {/* Admin-gated dashboards that live outside /admin/* */}
      <section>
        <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Dashboards</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ADMIN_DASHBOARDS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-lg border border-t-border/60 bg-surface p-4 transition-colors hover:bg-surface-elevated"
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true">{d.icon}</span>
                <span className="text-sm font-medium text-foreground">{d.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{d.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent admin activity */}
      <section className="rounded-lg border border-t-border/60 bg-surface">
        <header className="flex items-center justify-between border-b border-t-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recent admin activity</h2>
          <Link href="/admin/activity" className="text-xs text-muted hover:text-foreground">
            View all →
          </Link>
        </header>
        {data.activity.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted">No admin activity yet.</p>
        ) : (
          <ul className="divide-y divide-t-border/60">
            {data.activity.map((a) => {
              const href = entityHref(a.entityType, a.entityId);
              return (
                <li key={a.id} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-foreground">{a.description}</span>
                    <span className="shrink-0 text-muted">{formatRelative(a.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <span className="font-mono">{a.type}</span>
                    {a.userEmail && <span>· by {a.userEmail}</span>}
                    {href && a.entityName && (
                      <Link href={href} className="text-foreground/80 hover:text-foreground">
                        · {a.entityName}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Reference — docs, prototypes, API shortcuts. Compact chips. */}
      <section>
        <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Reference</h2>
        <div className="flex flex-wrap gap-2">
          {REFERENCE_LINKS.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="rounded-full border border-t-border/60 bg-surface-2 px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              {r.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiTile({
  label,
  primary,
  detail,
  errored,
  accent,
}: {
  label: string;
  primary: string;
  detail: string;
  errored: boolean;
  accent?: "risk";
}) {
  return (
    <div className="rounded-lg border border-t-border/60 bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          accent === "risk" && !errored && primary !== "0" && primary !== "—"
            ? "text-orange-400"
            : "text-foreground"
        }`}
      >
        {primary}
      </p>
      <p className={`mt-1 text-xs ${errored ? "text-red-400" : "text-muted"}`}>{detail}</p>
    </div>
  );
}
