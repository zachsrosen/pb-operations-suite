"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { OverviewTab } from "./tabs/OverviewTab";
import { UtilityTab } from "./tabs/UtilityTab";
import { PlansetTab } from "./tabs/PlansetTab";
import { CorrespondenceTab } from "./tabs/CorrespondenceTab";
import { StatusHistoryTab } from "./tabs/StatusHistoryTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { ActionPanel } from "./actions/ActionPanel";
import type { IcProjectDetail } from "@/lib/ic-hub";

function ExternalLinkButton({
  href,
  label,
  tone = "secondary",
}: {
  href: string | null;
  label: string;
  tone?: "primary" | "secondary";
}) {
  const base =
    "inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors";
  if (!href) {
    return (
      <span
        className={`${base} text-muted/60 bg-surface-2 cursor-not-allowed`}
        title={`${label} not available`}
      >
        {label}
      </span>
    );
  }
  const cls =
    tone === "primary"
      ? `${base} bg-green-500 text-white hover:bg-green-600`
      : `${base} bg-surface-2 text-foreground hover:bg-surface-2/80`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label} ↗
    </a>
  );
}

export function ProjectDetail({ dealId }: { dealId: string }) {
  const detailQuery = useQuery<IcProjectDetail>({
    queryKey: queryKeys.icHub.project(dealId),
    queryFn: async () => {
      const r = await fetch(`/api/ic-hub/project/${dealId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <div className="bg-surface-2 h-8 w-1/2 animate-pulse rounded" />
        <div className="bg-surface-2 h-24 w-full animate-pulse rounded" />
        <div className="bg-surface-2 h-48 w-full animate-pulse rounded" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return <div className="p-6 text-red-500">Failed to load project.</div>;
  }

  const detail = detailQuery.data;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-t-border px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{detail.deal.name}</h2>
          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-400">
            {detail.deal.interconnectionStatusLabel ||
              detail.deal.interconnectionStatus ||
              "—"}
          </span>
        </div>
        <div className="text-muted mt-1 text-sm">
          {detail.deal.address ?? "—"} · {detail.deal.pbLocation ?? "—"}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ExternalLinkButton
            href={detail.deal.hubspotUrl}
            label="HubSpot"
            tone="primary"
          />
          <ExternalLinkButton
            href={detail.deal.utilityPortalUrl}
            label="Utility Portal"
            tone="primary"
          />
          <ExternalLinkButton
            href={detail.deal.utilityApplicationUrl}
            label="Application"
          />
          <ExternalLinkButton
            href={detail.deal.designFolderUrl}
            label="Design Folder"
          />
          <ExternalLinkButton
            href={detail.deal.permitFolderUrl}
            label="Permit Folder"
          />
          {detail.deal.driveFolderUrl &&
            detail.deal.driveFolderUrl !== detail.deal.designFolderUrl && (
              <ExternalLinkButton
                href={detail.deal.driveFolderUrl}
                label="Project Drive"
              />
            )}
        </div>
      </div>

      {/* One organized view rather than tabs — every panel visible at once, in
          the shape the IDR design-meeting detail uses. Correspondence leads the
          right column: most of this queue is waiting on the utility, so "what
          did we last hear, and when" is the question the page exists to answer.
          Collapses to one column when the pane is narrow. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 p-4 xl:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <CollapsibleSection title="Overview">
              <OverviewTab detail={detail} />
            </CollapsibleSection>
            <CollapsibleSection title="Utility">
              <UtilityTab utility={detail.utility} />
            </CollapsibleSection>
            <CollapsibleSection title="Planset">
              <PlansetTab url={detail.deal.designFolderUrl} />
            </CollapsibleSection>
          </div>
          <div className="min-w-0 space-y-3">
            <CollapsibleSection
              title="Correspondence"
              badge={
                detail.correspondenceThreads.length > 0 ? (
                  <span className="bg-surface-2 text-muted rounded-full px-1.5 text-[10px] font-semibold">
                    {detail.correspondenceThreads.length}
                  </span>
                ) : null
              }
            >
              <CorrespondenceTab
                searchUrl={detail.correspondenceSearchUrl}
                threads={detail.correspondenceThreads}
                inbox={detail.correspondenceInbox}
              />
            </CollapsibleSection>
            <CollapsibleSection title="Status History" defaultOpen={false}>
              <StatusHistoryTab history={detail.statusHistory} />
            </CollapsibleSection>
            <CollapsibleSection title="Activity" defaultOpen={false}>
              <ActivityTab activity={detail.activity} />
            </CollapsibleSection>
          </div>
        </div>

        {/* FOLLOW_UP_UTILITY is excluded — see the permit hub's ProjectDetail:
            the form only asks the lead to retype what Correspondence now reads
            from the shared inbox, and it does not move the status. */}
        {detail.deal.actionKind &&
          detail.deal.actionKind !== "FOLLOW_UP_UTILITY" && (
            <div className="bg-surface-2 border-t border-t-border p-6">
              <ActionPanel dealId={dealId} actionKind={detail.deal.actionKind} />
            </div>
          )}
      </div>
    </div>
  );
}
