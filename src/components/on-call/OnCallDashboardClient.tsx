"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { HeroStrip } from "./HeroStrip";
import { LookaheadGrid } from "./LookaheadGrid";

type TonightResp = {
  pools: Array<{
    poolId: string;
    poolName: string;
    region: string;
    timezone: string;
    shiftStart: string;
    shiftEnd: string;
    date: string;
    crewMember: { id: string; name: string; email: string | null } | null;
    source: string | null;
  }>;
};

export function OnCallDashboardClient() {
  const tonight = useQuery<TonightResp>({
    queryKey: queryKeys.onCall.tonight(),
    queryFn: async () => {
      const res = await fetch("/api/on-call/tonight");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (tonight.isLoading) {
    return <div className="text-muted">Loading schedule…</div>;
  }
  if (tonight.error) {
    return <div className="text-rose-400">Failed to load on-call schedule.</div>;
  }
  if (!tonight.data || tonight.data.pools.length === 0) {
    return (
      <div className="bg-surface border border-t-border rounded-lg p-8 text-center">
        <p className="text-muted mb-2">No on-call pools configured yet.</p>
        <p className="text-sm text-muted">An admin needs to set up pools in Setup.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">Tonight</div>
        <HeroStrip pools={tonight.data.pools} />
      </section>
      <section>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">Next 14 Days</div>
        <LookaheadGrid pools={tonight.data.pools} days={14} />
      </section>
    </div>
  );
}
