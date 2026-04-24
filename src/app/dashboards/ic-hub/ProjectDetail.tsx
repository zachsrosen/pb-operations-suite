"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { OverviewTab } from "./tabs/OverviewTab";
import { UtilityTab } from "./tabs/UtilityTab";
import { PlansetTab } from "./tabs/PlansetTab";
import { CorrespondenceTab } from "./tabs/CorrespondenceTab";
import { StatusHistoryTab } from "./tabs/StatusHistoryTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { ActionPanel } from "./actions/ActionPanel";
import type { IcProjectDetail } from "@/lib/ic-hub";

type TabKey =
  | "overview"
  | "utility"
  | "planset"
  | "correspondence"
  | "history"
  | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "utility", label: "Utility" },
  { key: "planset", label: "Planset" },
  { key: "correspondence", label: "Correspondence" },
  { key: "history", label: "Status History" },
  { key: "activity", label: "Activity" },
];

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
  const [tab, setTab] = useState<TabKey>("overview");

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
            {detail.deal.interconnectionStatus || "—"}
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

      <div className="flex gap-1 border-b border-t-border px-4">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-green-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-6">
          {tab === "overview" && <OverviewTab detail={detail} />}
          {tab === "utility" && <UtilityTab utility={detail.utility} />}
          {tab === "planset" && <PlansetTab url={detail.deal.designFolderUrl} />}
          {tab === "correspondence" && (
            <CorrespondenceTab
              searchUrl={detail.correspondenceSearchUrl}
              threads={detail.correspondenceThreads}
              inbox={detail.correspondenceInbox}
            />
          )}
          {tab === "history" && (
            <StatusHistoryTab history={detail.statusHistory} />
          )}
          {tab === "activity" && <ActivityTab activity={detail.activity} />}
        </div>

        {detail.deal.actionKind && (
          <div className="bg-surface-2 border-t border-t-border p-6">
            <ActionPanel dealId={dealId} actionKind={detail.deal.actionKind} />
          </div>
        )}
      </div>
    </div>
  );
}
