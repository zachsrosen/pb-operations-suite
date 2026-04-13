"use client";

import DashboardShell from "@/components/DashboardShell";
import DealHeader from "@/components/deal-detail/DealHeader";
import MilestoneTimeline from "@/components/deal-detail/MilestoneTimeline";
import StatusFlagsBar from "@/components/deal-detail/StatusFlagsBar";
import CollapsibleSection from "@/components/deal-detail/CollapsibleSection";
import FieldGrid from "@/components/deal-detail/FieldGrid";
import DealSidebar from "@/components/deal-detail/DealSidebar";
import TeamCard from "@/components/deal-detail/TeamCard";
import EquipmentCard from "@/components/deal-detail/EquipmentCard";
import ContactCard from "@/components/deal-detail/ContactCard";
import ExternalLinksCard from "@/components/deal-detail/ExternalLinksCard";
import QuickActionsCard from "@/components/deal-detail/QuickActionsCard";
import { getSectionsForPipeline, getStageColor } from "@/components/deal-detail/section-registry";
import type { SerializedDeal, TimelineStage } from "@/components/deal-detail/types";

interface DealDetailViewProps {
  deal: SerializedDeal;
  timelineStages: TimelineStage[];
  stageOrder: string[];
  staleness: string;
}

export default function DealDetailView({
  deal,
  timelineStages,
  stageOrder,
  staleness,
}: DealDetailViewProps) {
  const sections = getSectionsForPipeline(deal.pipeline);
  const stageColor = getStageColor(deal.pipeline, deal.stage, stageOrder);

  return (
    <DashboardShell
      title={deal.dealName}
      accentColor="orange"
      breadcrumbs={[
        { label: "Operations", href: "/suites/operations" },
        { label: "Deals", href: "/dashboards/deals" },
        { label: deal.dealName },
      ]}
      syncMeta={{
        source: "deal-mirror",
        lastSyncedAt: deal.lastSyncedAt ?? new Date().toISOString(),
        staleness,
      }}
      fullWidth
    >
      {/* Above the fold */}
      <DealHeader deal={deal} stageColor={stageColor} />
      {timelineStages.length > 0 && (
        <MilestoneTimeline stages={timelineStages} />
      )}
      <StatusFlagsBar deal={deal} stageOrder={stageOrder} />

      {/* Two-column layout */}
      <div className="mt-4 flex flex-col gap-6 lg:flex-row">
        {/* Left: collapsible sections */}
        <div className="min-w-0 flex-[2]">
          {sections.map((section) => {
            const fields = section.fields(deal);
            return (
              <CollapsibleSection
                key={section.key}
                title={section.title}
                fieldCount={fields.length}
                defaultOpen={section.defaultOpen}
              >
                <FieldGrid fields={fields} />
              </CollapsibleSection>
            );
          })}
        </div>

        {/* Right: pinned sidebar */}
        <div className="flex-1 lg:max-w-xs">
          <DealSidebar>
            <TeamCard deal={deal} />
            <EquipmentCard deal={deal} />
            <ContactCard deal={deal} />
            <ExternalLinksCard deal={deal} />
            <QuickActionsCard />
          </DealSidebar>
        </div>
      </div>
    </DashboardShell>
  );
}
