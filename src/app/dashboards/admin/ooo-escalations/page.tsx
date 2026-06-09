import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import OooEscalationsClient from "./OooEscalationsClient";

/**
 * Admin OOO Bot Escalations dashboard.
 *
 * Lists everything the Google Chat OOO bot flagged for review via its
 * `escalate()` tool (low-confidence answers), plus the crash-diagnostic
 * rows the webhook writes on async processing failures (senderName
 * "async-error"). Admins resolve or dismiss each row with an optional note.
 *
 * Reads the OooBotEscalation table directly (server component) and mutates
 * via PATCH /api/admin/ooo-bot/escalations.
 */
export default async function OooEscalationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  const roles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  if (!session?.user) redirect("/");
  const isAdmin = roles.some((r) => r === "ADMIN" || r === "OWNER" || r === "EXECUTIVE");
  if (!isAdmin) redirect("/");

  const { status: statusFilter } = await searchParams;
  const filter =
    statusFilter === "RESOLVED" ||
    statusFilter === "DISMISSED" ||
    statusFilter === "all"
      ? statusFilter
      : "PENDING";

  if (!prisma) {
    return (
      <DashboardShell title="Bot Escalations" accentColor="purple">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          Database not configured.
        </div>
      </DashboardShell>
    );
  }

  const where: { status?: string } = filter === "all" ? {} : { status: filter };

  const escalations = await prisma.oooBotEscalation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      senderEmail: true,
      senderName: true,
      question: true,
      botContext: true,
      spaceId: true,
      threadId: true,
      status: true,
      resolvedAt: true,
      resolvedNote: true,
      createdAt: true,
    },
  });

  const [pendingCount, resolvedCount, dismissedCount] = await Promise.all([
    prisma.oooBotEscalation.count({ where: { status: "PENDING" } }),
    prisma.oooBotEscalation.count({ where: { status: "RESOLVED" } }),
    prisma.oooBotEscalation.count({ where: { status: "DISMISSED" } }),
  ]);

  return (
    <DashboardShell title="Bot Escalations" accentColor="purple">
      <OooEscalationsClient
        initialEscalations={escalations.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
          resolvedAt: e.resolvedAt?.toISOString() ?? null,
        }))}
        currentFilter={filter}
        counts={{
          pending: pendingCount,
          resolved: resolvedCount,
          dismissed: dismissedCount,
        }}
      />
    </DashboardShell>
  );
}
