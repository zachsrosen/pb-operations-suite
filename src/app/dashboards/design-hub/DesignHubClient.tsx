"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { parseTab } from "@/lib/design-hub/types";
import type { QueueItem, Tab } from "@/lib/design-hub/types";
import { SessionHeader } from "./SessionHeader";
import { Queue } from "./Queue";
import { ProjectDetail } from "./ProjectDetail";
import { Assignments } from "./Assignments";
import { GlobalAssignDialog } from "./GlobalAssignDialog";
import { ACCENTS, ACCENT_FOR_TAB } from "./accents";

const TAB_LABELS: Record<Tab, string> = {
  design: "Design",
  da: "Design Approval",
};

/** The assignment view is a third strip entry, not a Tab — it reads from the
 *  DB rather than a status property, so it never hits the queue endpoint. */
type View = Tab | "mine";

export function DesignHubClient({
  userEmail,
  hasAssignmentQueue,
}: {
  userEmail: string;
  hasAssignmentQueue: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [globalAssignOpen, setGlobalAssignOpen] = useState(false);

  const viewParam = searchParams.get("view");
  const view: View =
    viewParam === "mine" && hasAssignmentQueue
      ? "mine"
      : (parseTab(viewParam) ?? "design");

  // The assignment view spans both status properties, so the detail pane's tab
  // comes from the row that was clicked rather than from the view. Getting
  // this wrong would point the status dropdown at the wrong property.
  const [assignmentTab, setAssignmentTab] = useState<Tab>("design");
  const tab: Tab = view === "mine" ? assignmentTab : view;
  const accent = ACCENT_FOR_TAB[tab];

  // Selection is per-view — a deal selected in one list is meaningless in
  // another's context. Render-time reset (the React-sanctioned adjust-state-
  // during-render pattern) rather than an effect, which would paint one frame
  // with the stale selection.
  const [selectionView, setSelectionView] = useState(view);
  if (selectionView !== view) {
    setSelectionView(view);
    setSelectedDealId(null);
  }

  const queueQuery = useQuery<{ queue: QueueItem[]; lastUpdated: string }>({
    queryKey: queryKeys.designHub.queue(tab),
    queryFn: async () => {
      const r = await fetch(`/api/design-hub/queue?tab=${tab}`);
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
    staleTime: 30_000,
    // Switching tabs must not flash empty — keep the prior tab's rows on
    // screen until the new tab's data lands (house standard).
    placeholderData: keepPreviousData,
    enabled: view !== "mine",
  });

  // keepPreviousData without a visible fetching state makes a switch look like
  // a no-op: a cold queue load runs one HubSpot history call per deal, during
  // which the old rows sit on screen unchanged. Surface it.
  const isSwitching = queueQuery.isPlaceholderData;

  // No useSSE here, deliberately. The stream emits deals:permit and deals:ic
  // but nothing for design, so a subscription would be a no-op that reads
  // like real-time. Freshness comes from the 30s staleTime, the server's
  // 2min/15min stale-while-refresh cache, and direct invalidation after our
  // own writes. Wire SSE up here if a deals:design key is ever published.

  function switchView(v: View) {
    // Rebuild from the current params so switching doesn't drop whatever else
    // is on the URL (deep links, tracking params).
    const params = new URLSearchParams(searchParams);
    params.set("view", v);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const views: View[] = hasAssignmentQueue
    ? ["design", "da", "mine"]
    : ["design", "da"];

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {views.map((v) => {
            const active = v === view;
            const acc = ACCENTS[v === "mine" ? "purple" : ACCENT_FOR_TAB[v]];
            return (
              <button
                key={v}
                type="button"
                onClick={() => switchView(v)}
                aria-pressed={active}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? acc.primaryButton
                    : "bg-surface-2 text-foreground hover:bg-surface-elevated"
                }`}
              >
                {v === "mine" ? "Assigned to me" : TAB_LABELS[v]}
              </button>
            );
          })}
        </div>
        {/* Global assign: reach ANY deal, including ones not in a lane. Only
            shown to roster members, who are the ones who assign work. */}
        {hasAssignmentQueue && (
          <button
            type="button"
            onClick={() => setGlobalAssignOpen(true)}
            className="rounded-lg border border-t-border bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-elevated"
          >
            + Assign a project
          </button>
        )}
      </div>
      <SessionHeader
        userEmail={userEmail}
        lastUpdated={view === "mine" ? null : queueQuery.data?.lastUpdated}
      />
      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* overflow-visible, not -hidden: the filter dropdowns (fixed 288px)
            are wider than the point they open from and must escape the 420px
            rail into the detail-pane space beside it, or they clip. The inner
            list has its own overflow-y-auto, so scroll is still contained. */}
        <div className="w-[420px] shrink-0 overflow-visible rounded-xl border border-t-border bg-surface">
          {view === "mine" ? (
            <Assignments
              selectedDealId={selectedDealId}
              onSelect={(dealId, rowTab) => {
                setAssignmentTab(rowTab);
                setSelectedDealId(dealId);
              }}
              accent={accent}
            />
          ) : (
            <Queue
              items={queueQuery.data?.queue ?? []}
              isLoading={queueQuery.isLoading}
              isSwitching={isSwitching}
              selectedDealId={selectedDealId}
              onSelect={setSelectedDealId}
              tab={tab}
              accent={accent}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden rounded-xl border border-t-border bg-surface">
          {selectedDealId ? (
            <ProjectDetail tab={tab} dealId={selectedDealId} accent={accent} />
          ) : (
            <div className="text-muted flex h-full items-center justify-center">
              Select a project to begin.
            </div>
          )}
        </div>
      </div>

      {globalAssignOpen && (
        <GlobalAssignDialog onClose={() => setGlobalAssignOpen(false)} />
      )}
    </div>
  );
}
