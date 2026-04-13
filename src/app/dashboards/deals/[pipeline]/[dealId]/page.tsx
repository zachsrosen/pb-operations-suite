import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { serializeDeal, buildTimelineStages } from "@/components/deal-detail/serialize";
import { formatStaleness } from "@/lib/deal-sync";
import DealDetailView from "./DealDetailView";

// Stored stage shape from DealPipelineConfig.stages Json column
type StoredStage = { id: string; name: string; displayOrder: number; isActive: boolean };

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ pipeline: string; dealId: string }>;
}) {
  const { pipeline, dealId } = await params;

  if (!prisma) notFound();

  // Look up deal — try cuid first, fall back to hubspotDealId
  const isCuid = dealId.startsWith("c"); // cuids start with 'c'
  let deal = isCuid
    ? await prisma.deal.findUnique({ where: { id: dealId } })
    : await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });

  // If cuid lookup failed, also try hubspotDealId (in case someone passes a cuid-like string)
  if (!deal && isCuid) {
    deal = await prisma.deal.findUnique({ where: { hubspotDealId: dealId } });
  }

  if (!deal) notFound();

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
  const staleness = formatStaleness(deal.lastSyncedAt);

  return (
    <DealDetailView
      deal={serialized}
      timelineStages={timelineStages}
      stageOrder={stageOrder}
      staleness={staleness}
    />
  );
}
