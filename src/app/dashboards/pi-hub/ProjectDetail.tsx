"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { ProjectDetail as ProjectDetailData, Team } from "@/lib/pi-hub/types";
import { OverviewPanel } from "./panels/OverviewPanel";
import { AhjPanel } from "./panels/AhjPanel";
import { UtilityPanel } from "./panels/UtilityPanel";
import { PlansetPanel } from "./panels/PlansetPanel";
import { CorrespondencePanel } from "./panels/CorrespondencePanel";
import { StatusHistoryPanel } from "./panels/StatusHistoryPanel";
import { ActivityPanel } from "./panels/ActivityPanel";
import { StatusDropdown } from "./StatusDropdown";
import { ACCENTS, type Accent } from "./accents";

function ExternalLinkButton({
  href,
  label,
  primaryClass,
  tone = "secondary",
}: {
  href: string | null;
  label: string;
  primaryClass: string;
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
      ? `${base} ${primaryClass}`
      : `${base} bg-surface-2 text-foreground hover:bg-surface-2/80`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label} ↗
    </a>
  );
}

export function ProjectDetail({
  team,
  dealId,
  accent,
}: {
  team: Team;
  dealId: string;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  const detailQuery = useQuery<ProjectDetailData>({
    queryKey: queryKeys.piHub.project(team, dealId),
    queryFn: async () => {
      const r = await fetch(`/api/pi-hub/project/${dealId}?team=${team}`);
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
  const { deal } = detail;
  const portalLabel = detail.domain.kind === "ahj" ? "AHJ Portal" : "Utility Portal";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-t-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{deal.name}</h2>
          <StatusDropdown
            team={team}
            dealId={dealId}
            currentStatus={deal.status}
            currentStatusLabel={deal.statusLabel}
          />
        </div>
        <div className="text-muted mt-1 text-sm">
          {deal.address ?? "—"} · {deal.pbLocation ?? "—"}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ExternalLinkButton
            href={deal.hubspotUrl}
            label="HubSpot"
            tone="primary"
            primaryClass={a.primaryButton}
          />
          <ExternalLinkButton
            href={deal.portalUrl}
            label={portalLabel}
            tone="primary"
            primaryClass={a.primaryButton}
          />
          <ExternalLinkButton
            href={deal.applicationUrl}
            label="Application"
            primaryClass={a.primaryButton}
          />
          <ExternalLinkButton
            href={deal.folderUrl}
            label={deal.folderLabel}
            primaryClass={a.primaryButton}
          />
          <ExternalLinkButton
            href={deal.designFolderUrl}
            label="Design Folder"
            primaryClass={a.primaryButton}
          />
          {deal.driveFolderUrl && deal.driveFolderUrl !== deal.designFolderUrl && (
            <ExternalLinkButton
              href={deal.driveFolderUrl}
              label="Project Drive"
              primaryClass={a.primaryButton}
            />
          )}
        </div>
      </div>

      {/* One organized view rather than tabs — every panel visible at once.
          Correspondence leads the right column: most of this queue is waiting
          on the AHJ / utility, so "what did we last hear, and when" is the
          question the page exists to answer. Collapses to one column when the
          pane is narrow. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 p-4 xl:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <CollapsibleSection title="Overview">
              <OverviewPanel detail={detail} />
            </CollapsibleSection>
            {detail.domain.kind === "ahj" ? (
              <CollapsibleSection title="AHJ">
                <AhjPanel records={detail.domain.records} accent={accent} />
              </CollapsibleSection>
            ) : (
              <CollapsibleSection title="Utility">
                <UtilityPanel records={detail.domain.records} accent={accent} />
              </CollapsibleSection>
            )}
            {/* Named for the property it actually renders (designFolderUrl) —
                there is no separate planset property. */}
            <CollapsibleSection title="Design Folder">
              <PlansetPanel url={deal.designFolderUrl} accent={accent} />
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
              <CorrespondencePanel
                team={team}
                searchUrl={detail.correspondenceSearchUrl}
                threads={detail.correspondenceThreads}
                inbox={detail.correspondenceInbox}
                identifiers={detail.correspondenceIdentifiers ?? []}
              />
            </CollapsibleSection>
            <CollapsibleSection title="Status History" defaultOpen={false}>
              <StatusHistoryPanel history={detail.statusHistory} />
            </CollapsibleSection>
            <CollapsibleSection title="Activity" defaultOpen={false}>
              <ActivityPanel activity={detail.activity} />
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </div>
  );
}
