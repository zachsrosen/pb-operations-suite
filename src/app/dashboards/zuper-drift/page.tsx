import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import ZuperDriftClient from "./ZuperDriftClient";
import type { ZuperDriftStatus } from "@/generated/prisma/enums";

/**
 * Zuper Status Drift dashboard — lives in the Project Management suite.
 *
 * Lists Zuper jobs whose status, completion date, or inspection result
 * doesn't match HubSpot, detected by /api/cron/zuper-status-reconcile.
 * Backup for the HubSpot↔Zuper sync, which silently drops events sometimes.
 *
 * Flag-only: the user clicks through to HubSpot or Zuper to fix the
 * mismatch themselves, then marks the row Resolved or Ignored here.
 */
const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"] as const;

export default async function ZuperDriftPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  const roles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  if (!session?.user) redirect("/");
  const hasAccess = roles.some((r) =>
    (ALLOWED_ROLES as readonly string[]).includes(r),
  );
  if (!hasAccess) redirect("/");

  if (!prisma) {
    return (
      <DashboardShell title="Zuper Status Drift" accentColor="cyan">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          Database not configured.
        </div>
      </DashboardShell>
    );
  }

  const { status: statusParam } = await searchParams;
  const filter: "OPEN" | "RESOLVED" | "IGNORED" | "all" =
    statusParam === "RESOLVED" || statusParam === "IGNORED" || statusParam === "all"
      ? statusParam
      : "OPEN";

  const where: { status?: ZuperDriftStatus } =
    filter === "all" ? {} : { status: filter };

  const [rows, openCount, resolvedCount, ignoredCount] = await Promise.all([
    prisma.zuperStatusDrift.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: 200,
    }),
    prisma.zuperStatusDrift.count({ where: { status: "OPEN" } }),
    prisma.zuperStatusDrift.count({ where: { status: "RESOLVED" } }),
    prisma.zuperStatusDrift.count({ where: { status: "IGNORED" } }),
  ]);

  return (
    <DashboardShell title="Zuper Status Drift" accentColor="cyan">
      <ZuperDriftClient
        initialRows={rows.map((r) => ({
          ...r,
          detectedAt: r.detectedAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          zuperCompletedAt: r.zuperCompletedAt?.toISOString() ?? null,
          hubspotCompletionAt: r.hubspotCompletionAt?.toISOString() ?? null,
          zuperFailedAt: r.zuperFailedAt?.toISOString() ?? null,
          hubspotFailAt: r.hubspotFailAt?.toISOString() ?? null,
        }))}
        currentFilter={filter}
        counts={{ open: openCount, resolved: resolvedCount, ignored: ignoredCount }}
      />
    </DashboardShell>
  );
}
