import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import DaDriftClient from "./DaDriftClient";
import type { DaDriftStatus } from "@/generated/prisma/enums";

/**
 * DA Drift dashboard — lives in the Project Management suite.
 *
 * Lists mismatches between PandaDoc DA status and HubSpot `layout_status`
 * detected by /api/cron/pandadoc-da-reconcile. Backup for the native
 * HubSpot↔PandaDoc connector, which silently drops events sometimes.
 *
 * Flag-only: the user clicks through to HubSpot to fix `layout_status`
 * themselves, then marks the row Resolved or Ignored here.
 */
const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"] as const;

export default async function DaDriftPage({
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
      <DashboardShell title="DA Status Drift" accentColor="orange">
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

  const where: { status?: DaDriftStatus } =
    filter === "all" ? {} : { status: filter };

  const [rows, openCount, resolvedCount, ignoredCount] = await Promise.all([
    prisma.daStatusDrift.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: 200,
    }),
    prisma.daStatusDrift.count({ where: { status: "OPEN" } }),
    prisma.daStatusDrift.count({ where: { status: "RESOLVED" } }),
    prisma.daStatusDrift.count({ where: { status: "IGNORED" } }),
  ]);

  return (
    <DashboardShell title="DA Status Drift" accentColor="orange">
      <DaDriftClient
        initialRows={rows.map((r) => ({
          ...r,
          detectedAt: r.detectedAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          pandaDocSentAt: r.pandaDocSentAt?.toISOString() ?? null,
          pandaDocCompleted: r.pandaDocCompleted?.toISOString() ?? null,
        }))}
        currentFilter={filter}
        counts={{ open: openCount, resolved: resolvedCount, ignored: ignoredCount }}
      />
    </DashboardShell>
  );
}
