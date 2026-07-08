import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import TechOpsEscalationsClient from "./TechOpsEscalationsClient";

/**
 * Admin Tech Ops Bot Escalations dashboard.
 *
 * Lists everything the Google Chat Tech Ops bot flagged for review via its
 * `escalate()` tool (low-confidence answers), plus the crash-diagnostic
 * rows the webhook writes on async processing failures (senderName
 * "async-error"). Admins resolve or dismiss each row with an optional note.
 *
 * Reads the TechOpsBotEscalation table directly (server component) and mutates
 * via PATCH /api/admin/tech-ops-bot/escalations.
 */
export default async function TechOpsEscalationsPage({
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
  const isCorrections = statusFilter === "CORRECTIONS";
  const isConversations = statusFilter === "CONVERSATIONS";
  const filter = isCorrections
    ? "CORRECTIONS"
    : isConversations
      ? "CONVERSATIONS"
      : statusFilter === "RESOLVED" ||
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

  // Corrections (logged via log_correction) live in the same table, marked
  // with a [CORRECTION] question prefix. They get their own tab; the status
  // tabs (Pending/Resolved/etc.) show escalations only.
  const CORRECTION_PREFIX = "[CORRECTION]";
  const notCorrection = {
    NOT: { question: { startsWith: CORRECTION_PREFIX } },
  } as const;

  const where = isCorrections
    ? { question: { startsWith: CORRECTION_PREFIX } }
    : filter === "all"
      ? notCorrection
      : { status: filter, ...notCorrection };

  // Conversations tab: full DM/room history from the bot's conversation
  // memory (TechOpsBotConversation) — the "received" half of the audit trail.
  let conversations: Array<{
    spaceId: string;
    person: string;
    lastAt: string;
    messages: Array<{ role: string; senderName: string; content: string; createdAt: string; toolsUsed: string[] }>;
  }> = [];
  if (isConversations) {
    const rows = await prisma.techOpsBotConversation.findMany({
      orderBy: { createdAt: "desc" },
      take: 600,
      select: {
        spaceId: true, senderEmail: true, senderName: true, role: true,
        content: true, toolsUsed: true, createdAt: true,
      },
    });
    const bySpace = new Map<string, typeof rows>();
    for (const r of rows) bySpace.set(r.spaceId, [...(bySpace.get(r.spaceId) ?? []), r]);
    conversations = [...bySpace.entries()]
      .map(([spaceId, msgs]) => {
        const human = msgs.find((m) => m.role === "user");
        return {
          spaceId,
          person: human ? `${human.senderName} <${human.senderEmail}>` : spaceId,
          lastAt: msgs[0].createdAt.toISOString(),
          messages: [...msgs]
            .reverse()
            .slice(-60)
            .map((m) => ({
              role: m.role,
              senderName: m.senderName,
              content: m.content,
              createdAt: m.createdAt.toISOString(),
              toolsUsed: m.toolsUsed ?? [],
            })),
        };
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  const escalations = await prisma.techOpsBotEscalation.findMany({
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

  const [pendingCount, resolvedCount, dismissedCount, correctionsCount, conversationCount] =
    await Promise.all([
      prisma.techOpsBotEscalation.count({
        where: { status: "PENDING", ...notCorrection },
      }),
      prisma.techOpsBotEscalation.count({
        where: { status: "RESOLVED", ...notCorrection },
      }),
      prisma.techOpsBotEscalation.count({
        where: { status: "DISMISSED", ...notCorrection },
      }),
      prisma.techOpsBotEscalation.count({
        where: { question: { startsWith: CORRECTION_PREFIX } },
      }),
      prisma.techOpsBotConversation.count(),
    ]);

  return (
    <DashboardShell title="Bot Escalations" accentColor="purple">
      <TechOpsEscalationsClient
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
          corrections: correctionsCount,
          conversations: conversationCount,
        }}
        conversations={conversations}
      />
    </DashboardShell>
  );
}
