"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { OverviewTab } from "./tabs/OverviewTab";
import { AhjTab } from "./tabs/AhjTab";
import { PlansetTab } from "./tabs/PlansetTab";
import { CorrespondenceTab } from "./tabs/CorrespondenceTab";
import { StatusHistoryTab } from "./tabs/StatusHistoryTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { ActionPanel } from "./actions/ActionPanel";
import type { PermitProjectDetail } from "@/lib/permit-hub";

type TabKey = "overview" | "ahj" | "planset" | "correspondence" | "history" | "activity";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "ahj", label: "AHJ" },
  { key: "planset", label: "Planset" },
  { key: "correspondence", label: "Correspondence" },
  { key: "history", label: "Status History" },
  { key: "activity", label: "Activity" },
];

export function ProjectDetail({ dealId }: { dealId: string }) {
  const [tab, setTab] = useState<TabKey>("overview");

  const detailQuery = useQuery<PermitProjectDetail>({
    queryKey: queryKeys.permitHub.project(dealId),
    queryFn: async () => {
      const r = await fetch(`/api/permit-hub/project/${dealId}`);
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
          <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            {detail.deal.permittingStatus || "—"}
          </span>
        </div>
        <div className="text-muted mt-1 text-sm">
          {detail.deal.address ?? "—"} · {detail.deal.pbLocation ?? "—"}
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
                ? "border-blue-500 text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        {tab === "overview" && <OverviewTab detail={detail} />}
        {tab === "ahj" && <AhjTab ahj={detail.ahj} />}
        {tab === "planset" && <PlansetTab url={detail.plansetFolderUrl} />}
        {tab === "correspondence" && (
          <CorrespondenceTab searchUrl={detail.correspondenceSearchUrl} />
        )}
        {tab === "history" && <StatusHistoryTab history={detail.statusHistory} />}
        {tab === "activity" && <ActivityTab activity={detail.activity} />}
      </div>

      {detail.deal.actionKind && (
        <div className="bg-surface-2 shrink-0 border-t border-t-border p-4">
          <ActionPanel dealId={dealId} actionKind={detail.deal.actionKind} />
        </div>
      )}
    </div>
  );
}
