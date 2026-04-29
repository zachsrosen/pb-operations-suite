"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { HeroStrip } from "./HeroStrip";
import { LookaheadGrid } from "./LookaheadGrid";
import { CallLogModal } from "./CallLogModal";
import { CallLogList } from "./CallLogList";

type TonightResp = {
  pools: Array<{
    poolId: string;
    poolName: string;
    region: string;
    timezone: string;
    shiftStart: string;
    shiftEnd: string;
    weekendShiftStart: string;
    weekendShiftEnd: string;
    date: string;
    crewMember: { id: string; name: string; email: string | null } | null;
    source: string | null;
  }>;
};

type MeResp = {
  crewMember: { id: string; name: string; email: string | null } | null;
  isAdmin?: boolean;
  activeCrewMembers?: { id: string; name: string }[];
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

  // Fetch the caller's CrewMember identity; admins can log on behalf of a crew member.
  const me = useQuery<MeResp>({
    queryKey: queryKeys.onCall.me(),
    queryFn: async () => {
      const res = await fetch("/api/on-call/me");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [callLogOpen, setCallLogOpen] = useState(false);

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

  // The crew member's pool-of-record for the modal default. Pull from `tonight`
  // (whichever pool currently has them on-call), else fall back to first pool.
  const myCrew = me.data?.crewMember ?? null;
  const defaultPoolId = myCrew
    ? tonight.data.pools.find((p) => p.crewMember?.id === myCrew.id)?.poolId
    : undefined;
  const isAdmin = me.data?.isAdmin ?? false;
  const showCallLog = Boolean(myCrew) || isAdmin;

  return (
    <div className="space-y-8">
      {/* Quick-log: prominent CTA for electricians and admins. */}
      {showCallLog && (
        <section className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Got a call?</div>
            <div className="text-xs text-muted mt-0.5">
              Log every emergency call right after you hang up — even nuisance / wrong-number calls.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCallLogOpen(true)}
            className="shrink-0 px-4 py-2 rounded bg-orange-500 text-white text-sm font-medium"
          >
            Log a call
          </button>
        </section>
      )}

      <section>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">Tonight</div>
        <HeroStrip pools={tonight.data.pools} />
      </section>

      {/* Calls this shift: 7-day rolling window, visible to whole pool for
          handoffs. Always shown — no point hiding it from non-electricians
          who might be admins or operations checking on coverage. */}
      <section>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">
          Recent Calls (last 7 days)
        </div>
        <CallLogList />
      </section>

      <section>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">Next 14 Days</div>
        <LookaheadGrid pools={tonight.data.pools} days={14} />
      </section>

      {showCallLog && (
        <CallLogModal
          open={callLogOpen}
          onClose={() => setCallLogOpen(false)}
          crewMember={myCrew ? { id: myCrew.id, name: myCrew.name } : null}
          activeCrewMembers={me.data?.activeCrewMembers}
          defaultPoolId={defaultPoolId}
        />
      )}
    </div>
  );
}
