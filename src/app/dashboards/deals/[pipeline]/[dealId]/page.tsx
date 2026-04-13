import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma, getUserByEmail } from "@/lib/db";
import { auth } from "@/auth";
import { syncSingleDeal } from "@/lib/deal-sync";
import { serializeDeal, buildTimelineStages } from "@/components/deal-detail/serialize";
import DealDetailView from "./DealDetailView";
import type { ZuperJobInfo, ChangeLogEntry, RelatedDeal } from "@/components/deal-detail/types";

// Stored stage shape from DealPipelineConfig.stages Json column
type StoredStage = { id: string; name: string; displayOrder: number; isActive: boolean };

function formatStalenessLocal(lastSync: Date | null): string {
  if (!lastSync) return "unknown";
  const minutes = Math.floor((Date.now() - lastSync.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Inline 404 UI — avoids notFound() which crashes in this nested dynamic route */
function DealNotFound({ dealId }: { dealId: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center bg-surface rounded-xl p-8 border border-t-border shadow-card max-w-md">
        <div className="text-orange-500 text-6xl mb-4 font-bold">404</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Deal Not Found</h2>
        <p className="text-muted mb-2">
          No deal with ID <code className="text-xs bg-surface-2 px-1.5 py-0.5 rounded">{dealId}</code> exists in the deal mirror.
        </p>
        <p className="text-xs text-muted mb-6">
          The deal may not have been synced yet, or the ID may be incorrect.
        </p>
        <Link
          href="/dashboards/deals"
          className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors inline-block"
        >
          Back to Deals
        </Link>
      </div>
    </div>
  );
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ pipeline: string; dealId: string }>;
}) {
  const { pipeline, dealId } = await params;

  if (!prisma) return <DealNotFound dealId={dealId} />;

  // Look up deal — try cuid first, fall back to hubspotDealId
  const isCuid = dealId.startsWith("c"); // cuids start with 'c'
  let deal = isCuid
    ? await prisma.deal.findUnique({ where: { id: dealId } })
    : await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });

  // If cuid lookup failed, also try hubspotDealId (in case someone passes a cuid-like string)
  if (!deal && isCuid) {
    deal = await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });
  }

  // On-demand sync: if the deal isn't in the mirror yet, try pulling it from HubSpot.
  // This covers deals that exist in HubSpot but haven't been picked up by the cron yet.
  if (!deal && /^\d+$/.test(dealId)) {
    try {
      await syncSingleDeal(dealId, "MANUAL");
      deal = await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });
    } catch {
      // HubSpot fetch failed (404, rate limit, etc.) — fall through to 404 UI
    }
  }

  if (!deal) return <DealNotFound dealId={dealId} />;

  // Canonical URL enforcement: single redirect for both identifier + pipeline normalization
  const canonicalPipeline = deal.pipeline.toLowerCase();
  if (dealId !== deal.id || pipeline !== canonicalPipeline) {
    redirect(`/dashboards/deals/${canonicalPipeline}/${deal.id}`);
  }

  // Read stage order from local DealPipelineConfig (no live HubSpot calls)
  const pipelineConfig = await prisma.dealPipelineConfig.findUnique({
    where: { pipeline: deal.pipeline },
  });
  const stages = (pipelineConfig?.stages as StoredStage[]) ?? [];
  const stageOrder = stages
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => s.name);

  // Serialize for client
  const serialized = serializeDeal(deal);
  const timelineStages = buildTimelineStages(
    deal.pipeline,
    stageOrder,
    serialized,
  );
  const staleness = formatStalenessLocal(deal.lastSyncedAt);

  // Fetch enrichment data in parallel
  const [zuperJobs, syncLogs, relatedDeals, session] = await Promise.all([
    // Zuper jobs linked to this deal
    prisma.zuperJobCache.findMany({
      where: { hubspotDealId: deal.hubspotDealId },
      orderBy: { scheduledStart: "desc" },
      take: 5,
    }).catch(() => []),
    // Recent sync log entries
    prisma.dealSyncLog.findMany({
      where: { dealId: deal.id, status: { not: "SKIPPED" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }).catch(() => []),
    // Related deals (same contact or company)
    (async () => {
      const conditions = [];
      if (deal.hubspotContactId) conditions.push({ hubspotContactId: deal.hubspotContactId });
      if (deal.hubspotCompanyId) conditions.push({ hubspotCompanyId: deal.hubspotCompanyId });
      if (conditions.length === 0) return [];
      return prisma.deal.findMany({
        where: {
          OR: conditions,
          id: { not: deal.id },
        },
        select: { id: true, hubspotDealId: true, dealName: true, pipeline: true, stage: true, amount: true },
        orderBy: { hubspotUpdatedAt: "desc" },
        take: 5,
      });
    })().catch(() => []),
    // Current user session for role-based visibility
    auth().catch(() => null),
  ]);

  // Resolve user role
  let userRole = "VIEWER";
  if (session?.user?.email) {
    const user = await getUserByEmail(session.user.email);
    if (user) userRole = user.role;
  }

  // Serialize enrichment data
  const zuperJobInfos: ZuperJobInfo[] = zuperJobs.map((j) => ({
    jobUid: j.jobUid,
    jobTitle: j.jobTitle,
    jobCategory: j.jobCategory,
    jobStatus: j.jobStatus,
    jobPriority: j.jobPriority,
    scheduledStart: j.scheduledStart?.toISOString() ?? null,
    scheduledEnd: j.scheduledEnd?.toISOString() ?? null,
    completedDate: j.completedDate?.toISOString() ?? null,
    assignedUsers: (j.assignedUsers as { user_uid: string; user_name?: string }[]) ?? [],
  }));

  const changeLog: ChangeLogEntry[] = syncLogs.map((l) => ({
    id: l.id,
    syncType: l.syncType,
    source: l.source,
    status: l.status,
    changesDetected: l.changesDetected as Record<string, [unknown, unknown]> | null,
    createdAt: l.createdAt.toISOString(),
  }));

  const related: RelatedDeal[] = relatedDeals.map((d) => ({
    id: d.id,
    hubspotDealId: d.hubspotDealId,
    dealName: d.dealName,
    pipeline: d.pipeline,
    stage: d.stage,
    amount: d.amount ? Number(d.amount) : null,
  }));

  return (
    <DealDetailView
      deal={serialized}
      timelineStages={timelineStages}
      stageOrder={stageOrder}
      staleness={staleness}
      zuperJobs={zuperJobInfos}
      changeLog={changeLog}
      relatedDeals={related}
      userRole={userRole}
    />
  );
}
