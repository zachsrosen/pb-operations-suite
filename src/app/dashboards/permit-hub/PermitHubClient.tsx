"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSSE } from "@/hooks/useSSE";
import { queryKeys } from "@/lib/query-keys";
import { SessionHeader } from "./SessionHeader";
import { PermitQueue } from "./PermitQueue";
import { ProjectDetail } from "./ProjectDetail";
import type { PermitQueueItem } from "@/lib/permit-hub";

export function PermitHubClient({ userEmail }: { userEmail: string }) {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

  const queueQuery = useQuery<{ queue: PermitQueueItem[]; lastUpdated: string }>({
    queryKey: queryKeys.permitHub.queue(),
    queryFn: async () => {
      const r = await fetch("/api/permit-hub/queue");
      if (!r.ok) throw new Error("Failed to load queue");
      return r.json();
    },
    staleTime: 30_000,
  });

  useSSE(() => queueQuery.refetch(), {
    url: "/api/stream",
    cacheKeyFilter: "deals:permit",
  });

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-3">
      <SessionHeader userEmail={userEmail} />
      <div className="flex flex-1 gap-3 overflow-hidden">
        <div className="w-[420px] shrink-0 overflow-hidden rounded-xl border border-t-border bg-surface">
          <PermitQueue
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
