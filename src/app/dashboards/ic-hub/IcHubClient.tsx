"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { SessionHeader } from "./SessionHeader";
import { IcQueue } from "./IcQueue";
import { ProjectDetail } from "./ProjectDetail";
import type { IcQueueItem } from "@/lib/ic-hub";

export function IcHubClient({ userEmail }: { userEmail: string }) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const queueQuery = useQuery<{ queue: IcQueueItem[]; lastUpdated: string }>({
    queryKey: queryKeys.icHub.queue(),
    queryFn: async () => {
      const r = await fetch("/api/ic-hub/queue");
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
    staleTime: 30_000,
  });

  useSSE(() => queueQuery.refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "deals:ic",
  });

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-3">
      <SessionHeader userEmail={userEmail} />
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="w-[420px] shrink-0 overflow-hidden rounded-xl border border-t-border bg-surface">
          <IcQueue
            items={queueQuery.data?.queue ?? []}
            isLoading={queueQuery.isLoading}
            selectedDealId={selectedDealId}
            onSelect={setSelectedDealId}
          />
        </div>
        <div className="flex-1 overflow-hidden rounded-xl border border-t-border bg-surface">
          {selectedDealId ? (
            <ProjectDetail dealId={selectedDealId} />
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
