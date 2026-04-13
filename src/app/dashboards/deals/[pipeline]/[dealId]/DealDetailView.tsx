"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
import ZuperJobCard from "@/components/deal-detail/ZuperJobCard";
import ChangeLogCard from "@/components/deal-detail/ChangeLogCard";
import RelatedDealsCard from "@/components/deal-detail/RelatedDealsCard";
import { getSectionsForPipeline, getStageColor } from "@/components/deal-detail/section-registry";
import { useSSE } from "@/hooks/useSSE";
import type {
  SerializedDeal,
  TimelineStage,
  ZuperJobInfo,
  ChangeLogEntry,
  RelatedDeal,
} from "@/components/deal-detail/types";

// Roles that can see QC metrics, install planning, revision counts
const OPERATIONAL_ROLES = new Set([
  "ADMIN", "OWNER", "PROJECT_MANAGER", "OPERATIONS_MANAGER",
  "OPERATIONS", "TECH_OPS",
]);

// Sections hidden from non-operational roles
const OPERATIONAL_SECTIONS = new Set([
  "qc-metrics", "install-planning", "revision-counts",
]);

interface DealDetailViewProps {
  deal: SerializedDeal;
  timelineStages: TimelineStage[];
  stageOrder: string[];
  staleness: string;
  zuperJobs?: ZuperJobInfo[];
  changeLog?: ChangeLogEntry[];
  relatedDeals?: RelatedDeal[];
  userRole?: string;
}

export default function DealDetailView({
  deal,
  timelineStages,
  stageOrder,
  staleness,
  zuperJobs = [],
  changeLog = [],
  relatedDeals = [],
  userRole = "VIEWER",
}: DealDetailViewProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time: refresh page when deal-mirror SSE events fire
  useSSE(() => router.refresh(), {
    url: "/api/stream",
    cacheKeyFilter: `deals:${deal.hubspotDealId}`,
  });

  // Sync from HubSpot
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/deals/${deal.hubspotDealId}/sync`, {
        method: "POST",
      });
      if (res.ok) {
        // Give the server a moment to persist, then refresh RSC data
        await new Promise((r) => {
          refreshTimeoutRef.current = setTimeout(r, 500);
        });
        router.refresh();
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsRefreshing(false);
    }
  }, [deal.hubspotDealId, isRefreshing, router]);

  // Filter sections by pipeline and role
  const allSections = getSectionsForPipeline(deal.pipeline);
  const sections = OPERATIONAL_ROLES.has(userRole)
    ? allSections
    : allSections.filter((s) => !OPERATIONAL_SECTIONS.has(s.key));

  const stageColor = getStageColor(deal.pipeline, deal.stage, stageOrder);

  // Print handler
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

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
                sectionKey={section.key}
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
        <div className="flex-1 lg:max-w-xs print:hidden">
          <DealSidebar>
            <QuickActionsCard
              deal={deal}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
            <TeamCard deal={deal} />
            <EquipmentCard deal={deal} />
            <ZuperJobCard jobs={zuperJobs} />
            <ContactCard deal={deal} />
            <RelatedDealsCard deals={relatedDeals} />
            <ChangeLogCard entries={changeLog} />
            <ExternalLinksCard deal={deal} />
          </DealSidebar>
        </div>
      </div>

      {/* Print button — bottom of page */}
      <div className="mt-6 flex justify-end print:hidden">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 rounded-lg border border-t-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          🖨 Print / Export
        </button>
      </div>
    </DashboardShell>
  );
}
