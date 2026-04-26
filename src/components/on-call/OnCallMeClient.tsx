"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useState } from "react";
import { SwapProposeModal } from "./SwapProposeModal";

type Shift = {
  poolId: string;
  poolName: string;
  startDate: string;
  endDate: string;
  shiftStart: string;
  shiftEnd: string;
  weekendShiftStart: string;
  weekendShiftEnd: string;
  timezone: string;
  rotationUnit: string;
};

type PendingSwap = {
  id: string;
  requesterCrewMember: { id: string; name: string };
  requesterDate: string;
  counterpartyDate: string;
  reason: string | null;
  createdAt: string;
  pool: { name: string };
};

type MyRequest = {
  id: string;
  counterpartyCrewMember: { id: string; name: string };
  requesterDate: string;
  counterpartyDate: string;
  status: string;
  pool: { name: string };
};

type MeResp = {
  crewMember: { id: string; name: string; email: string | null } | null;
  shifts: Shift[];
  pendingSwaps: PendingSwap[];
  myRequests: MyRequest[];
};

function formatShift(s: Shift): string {
  if (s.startDate === s.endDate) return formatDate(s.startDate);
  return `${formatDate(s.startDate)} → ${formatDate(s.endDate)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatShiftWindows(s: Shift): string {
  const tzAbbr = s.timezone.includes("Los_Angeles") ? "PT" : "MT";
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
  };
  const wd = `${fmt(s.shiftStart)}–${fmt(s.shiftEnd)} weekdays`;
  const we = `${fmt(s.weekendShiftStart)}–${fmt(s.weekendShiftEnd)} weekends`;
  return `${wd}, ${we} ${tzAbbr}`;
}

export function OnCallMeClient() {
  const queryClient = useQueryClient();
  const meQ = useQuery<MeResp>({
    queryKey: queryKeys.onCall.me(),
    queryFn: async () => {
      const res = await fetch("/api/on-call/me");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [proposeForShift, setProposeForShift] = useState<Shift | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const acceptSwap = useMutation({
    mutationFn: async (swapId: string) => {
      const res = await fetch(`/api/on-call/swaps/${swapId}/accept`, { method: "POST" });
      const text = await res.text();
      const json: { error?: string } = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: () => {
      setActionErr(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  const denySwap = useMutation({
    mutationFn: async (swapId: string) => {
      const res = await fetch(`/api/on-call/swaps/${swapId}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denialReason: "Counterparty declined" }),
      });
      const text = await res.text();
      const json: { error?: string } = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: () => {
      setActionErr(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
    },
    onError: (e: Error) => setActionErr(e.message),
  });

  if (meQ.isLoading) return <div className="text-muted">Loading…</div>;
  if (meQ.error) return <div className="text-rose-400">Failed to load your shifts.</div>;

  const data = meQ.data;
  if (!data?.crewMember) {
    return (
      <div className="bg-surface border border-t-border rounded-lg p-8 text-center">
        <p className="text-muted mb-2">We couldn&apos;t match your login to an electrician on the rotation.</p>
        <p className="text-sm text-muted">
          If you think this is a mistake, ask an admin to confirm your email matches your CrewMember record.
        </p>
      </div>
    );
  }

  const firstName = data.crewMember.name.split(" ")[0];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <p className="text-sm text-muted">
        Hey <strong className="text-foreground">{firstName}</strong> — here&apos;s what&apos;s on your plate.
      </p>

      {actionErr && (
        <div className="text-sm rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2">
          {actionErr}
        </div>
      )}

      {/* Inbox — pending swap requests directed at me */}
      {data.pendingSwaps.length > 0 && (
        <section className="bg-surface border border-orange-500/30 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-orange-300">
              Swap Requests Waiting for You
            </h2>
            <span className="text-xs rounded-full bg-orange-500/20 text-orange-300 px-2 py-0.5">
              {data.pendingSwaps.length} pending
            </span>
          </div>
          <div className="space-y-3">
            {data.pendingSwaps.map((s) => (
              <div key={s.id} className="bg-surface-2 border border-t-border rounded-lg p-4">
                <div className="text-sm mb-1">
                  <strong>{s.requesterCrewMember.name}</strong> wants to swap.
                </div>
                <div className="text-xs text-muted mb-2">
                  You&apos;d cover <strong className="text-foreground">{formatDate(s.requesterDate)}</strong>,
                  they&apos;d cover your shift <strong className="text-foreground">{formatDate(s.counterpartyDate)}</strong> ({s.pool.name}).
                </div>
                {s.reason && (
                  <div className="text-xs italic text-muted mb-3">&ldquo;{s.reason}&rdquo;</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={acceptSwap.isPending}
                    onClick={() => acceptSwap.mutate(s.id)}
                    className="flex-1 px-3 py-2 rounded bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {acceptSwap.isPending ? "Accepting…" : "Accept & Apply"}
                  </button>
                  <button
                    type="button"
                    disabled={denySwap.isPending}
                    onClick={() => {
                      if (confirm(`Decline ${s.requesterCrewMember.name}'s swap request?`)) {
                        denySwap.mutate(s.id);
                      }
                    }}
                    className="px-3 py-2 rounded border border-t-border text-sm text-muted hover:text-foreground disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My pending outgoing requests */}
      {data.myRequests.length > 0 && (
        <section className="bg-surface border border-t-border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-3">Your Pending Requests</h2>
          <div className="space-y-2">
            {data.myRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-surface-2 rounded px-3 py-2">
                <div>
                  With <strong>{r.counterpartyCrewMember.name}</strong>:{" "}
                  {formatDate(r.requesterDate)} ↔ {formatDate(r.counterpartyDate)}
                </div>
                <span className="text-xs text-muted">
                  {r.status === "awaiting-counterparty" ? "Waiting on them" : "Waiting for admin"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming shifts */}
      <section className="bg-surface border border-t-border rounded-lg p-5">
        <h2 className="text-sm font-semibold mb-3">Your Upcoming Shifts</h2>
        {data.shifts.length === 0 ? (
          <p className="text-sm text-muted italic">No upcoming shifts. Admin may need to Publish the schedule.</p>
        ) : (
          <div className="space-y-2">
            {data.shifts.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-2 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{formatShift(s)}</div>
                  <div className="text-xs text-muted">
                    {s.poolName} · {formatShiftWindows(s)}
                    {s.rotationUnit === "weekly" ? " · weekly" : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setProposeForShift(s)}
                  className="text-xs px-3 py-1.5 rounded border border-t-border text-muted hover:text-foreground"
                >
                  Request Swap
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {proposeForShift && data.crewMember && (
        <SwapProposeModal
          myCrewMemberId={data.crewMember.id}
          myName={data.crewMember.name}
          shift={proposeForShift}
          onClose={() => setProposeForShift(null)}
          onSubmitted={() => {
            setProposeForShift(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
          }}
        />
      )}
    </div>
  );
}
