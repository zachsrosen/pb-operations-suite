"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { parseTeam } from "@/lib/pi-hub/types";
import type { QueueItem, Team } from "@/lib/pi-hub/types";
import { SessionHeader } from "./SessionHeader";
import { Queue } from "./Queue";
import { ProjectDetail } from "./ProjectDetail";
import { ACCENTS, ACCENT_FOR_TEAM } from "./accents";

const TEAM_LABELS: Record<Team, string> = {
  permit: "Permit",
  ic: "Interconnection",
  pto: "PTO",
};

/**
 * SSE cache-key prefix per team. PTO is interconnection work and rides the
 * same "deals:ic" invalidations as IC (the upstream stream only distinguishes
 * permit vs ic). Our own status writes invalidate the queue directly, so this
 * only has to catch changes made elsewhere.
 */
const SSE_FILTER: Record<Team, string> = {
  permit: "deals:permit",
  ic: "deals:ic",
  pto: "deals:ic",
};

export function PiHubClient({
  userEmail,
  allowedTeams,
}: {
  userEmail: string;
  allowedTeams: Team[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const teamParam = parseTeam(searchParams.get("team"));
  // Default to the first allowed team. The "permit" fallback only matters if
  // allowedTeams is empty, which the server page prevents (allowed roles always
  // resolve to at least one team) — it exists to keep `team` a plain Team.
  const team: Team =
    teamParam && allowedTeams.includes(teamParam)
      ? teamParam
      : allowedTeams[0] ?? "permit";
  const accent = ACCENT_FOR_TEAM[team];

  // Selection is per-team — a deal from one team's queue is meaningless in
  // another's, so clear it when the team changes. Render-time reset (the
  // React-sanctioned adjust-state-during-render pattern) rather than an
  // effect: the effect version painted one frame with the stale selection
  // and tripped react-hooks/set-state-in-effect.
  const [selectionTeam, setSelectionTeam] = useState(team);
  if (selectionTeam !== team) {
    setSelectionTeam(team);
    setSelectedDealId(null);
  }

  const queueQuery = useQuery<{ queue: QueueItem[]; lastUpdated: string }>({
    queryKey: queryKeys.piHub.queue(team),
    queryFn: async () => {
      const r = await fetch(`/api/pi-hub/queue?team=${team}`);
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
    staleTime: 30_000,
    // Switching teams must not flash empty — keep the prior team's rows on
    // screen until the new team's data lands (house standard).
    placeholderData: keepPreviousData,
  });

  // keepPreviousData without a visible fetching state made team switches look
  // like a no-op: a cold queue load runs one HubSpot history call per deal
  // (30-60s for the IC queue), during which the old team's rows sat on screen
  // unchanged. Surface it so the switch visibly happened.
  const isSwitching = queueQuery.isPlaceholderData;

  // Warm the other allowed teams once the current queue has landed: makes the
  // first switch near-instant and heats the server-side status-history cache.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!queueQuery.isSuccess || queueQuery.isPlaceholderData) return;
    for (const other of allowedTeams) {
      if (other === team) continue;
      void queryClient.prefetchQuery({
        queryKey: queryKeys.piHub.queue(other),
        queryFn: async () => {
          const r = await fetch(`/api/pi-hub/queue?team=${other}`);
          if (!r.ok) throw new Error("Failed to load queue");
          return r.json();
        },
        staleTime: 30_000,
      });
    }
  }, [queueQuery.isSuccess, queueQuery.isPlaceholderData, team, allowedTeams, queryClient]);

  useSSE(() => queueQuery.refetch(), {
    url: "/api/stream",
    cacheKeyFilter: SSE_FILTER[team],
  });

  function switchTeam(t: Team) {
    // Rebuild from the current params so switching teams doesn't drop whatever
    // else is on the URL (deep links, tracking params).
    const params = new URLSearchParams(searchParams);
    params.set("team", t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-3">
      {allowedTeams.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {allowedTeams.map((t) => {
            const active = t === team;
            const acc = ACCENTS[ACCENT_FOR_TEAM[t]];
            return (
              <button
                key={t}
                type="button"
                onClick={() => switchTeam(t)}
                aria-pressed={active}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? acc.primaryButton
                    : "bg-surface-2 text-foreground hover:bg-surface-elevated"
                }`}
              >
                {TEAM_LABELS[t]}
              </button>
            );
          })}
        </div>
      )}
      <SessionHeader
        userEmail={userEmail}
        lastUpdated={queueQuery.data?.lastUpdated}
      />
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="w-[420px] shrink-0 overflow-hidden rounded-xl border border-t-border bg-surface">
          <Queue
            items={queueQuery.data?.queue ?? []}
            isLoading={queueQuery.isLoading}
            isSwitching={isSwitching}
            selectedDealId={selectedDealId}
            onSelect={setSelectedDealId}
            team={team}
            accent={accent}
          />
        </div>
        <div className="flex-1 overflow-hidden rounded-xl border border-t-border bg-surface">
          {selectedDealId ? (
            <ProjectDetail team={team} dealId={selectedDealId} accent={accent} />
          ) : (
            <div className="text-muted flex h-full items-center justify-center">
              Select a project from the queue to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
