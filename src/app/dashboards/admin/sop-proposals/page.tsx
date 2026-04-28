import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import SopProposalsClient from "./SopProposalsClient";

/**
 * Admin SOP Proposals dashboard.
 *
 * Lists every brand-new-SOP proposal submitted by users via the
 * "Submit a New SOP" button on the SOP guide. Admins approve (which
 * promotes the proposal to a live SopSection) or reject with notes.
 */
export default async function SopProposalsPage({
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
    statusFilter === "APPROVED" ||
    statusFilter === "REJECTED" ||
    statusFilter === "all"
      ? statusFilter
      : "PENDING";

  if (!prisma) {
    return (
      <DashboardShell title="SOP Proposals" accentColor="blue">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          Database not configured.
        </div>
      </DashboardShell>
    );
  }

  const where: { status?: "PENDING" | "APPROVED" | "REJECTED" } =
    filter === "all" ? {} : { status: filter };

  const proposals = await prisma.sopProposal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      suggestedTabId: true,
      suggestedGroup: true,
      reason: true,
      status: true,
      submittedBy: true,
      submittedByName: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewerNotes: true,
      promotedSectionId: true,
      promotedSectionTab: true,
      createdAt: true,
    },
  });

  const tabs = await prisma.sopTab.findMany({
    select: { id: true, label: true },
    orderBy: { sortOrder: "asc" },
  });

  // Hydrate counts per filter for the tab toggle UI
  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    prisma.sopProposal.count({ where: { status: "PENDING" } }),
    prisma.sopProposal.count({ where: { status: "APPROVED" } }),
    prisma.sopProposal.count({ where: { status: "REJECTED" } }),
  ]);

  return (
    <DashboardShell title="SOP Proposals" accentColor="blue">
      <SopProposalsClient
        initialProposals={proposals.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          reviewedAt: p.reviewedAt?.toISOString() ?? null,
        }))}
        tabs={tabs}
        currentFilter={filter}
        counts={{
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
        }}
      />
    </DashboardShell>
  );
}
