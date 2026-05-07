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

type PtoRequest = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  pool: { name: string };
};

type PoolOption = { id: string; name: string };

type SubscribeUrl = {
  poolId: string;
  poolName: string;
  icalUrl: string | null;
  googleCalendarId: string | null;
};

type MeResp = {
  crewMember: { id: string; name: string; email: string | null } | null;
  shifts: Shift[];
  pendingSwaps: PendingSwap[];
  myRequests: MyRequest[];
  ptoRequests?: PtoRequest[];
  myPools?: PoolOption[];
  subscribeUrls?: SubscribeUrl[];
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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const [showPtoForm, setShowPtoForm] = useState(false);

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
                <div className="text-sm font-medium mb-2">
                  {s.requesterCrewMember.name} wants to swap shifts with you
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-surface rounded border border-t-border p-2">
                    <div className="text-xs text-muted mb-0.5">You&apos;d cover their shift</div>
                    <div className="text-sm font-medium">{formatDate(s.requesterDate)}</div>
                  </div>
                  <div className="bg-surface rounded border border-t-border p-2">
                    <div className="text-xs text-muted mb-0.5">They&apos;d cover yours</div>
                    <div className="text-sm font-medium">{formatDate(s.counterpartyDate)}</div>
                  </div>
                </div>
                <div className="text-xs text-muted mb-2">{s.pool.name}</div>
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
                    {acceptSwap.isPending ? "Accepting…" : "Accept"}
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
                <p className="text-xs text-muted mt-2">
                  Once accepted, a manager will review and finalize the swap.
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My pending outgoing requests */}
      {data.myRequests.length > 0 && (
        <section className="bg-surface border border-t-border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-3">Your Pending Swap Requests</h2>
          <div className="space-y-2">
            {data.myRequests.map((r) => (
              <div key={r.id} className="bg-surface-2 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    Swap with <strong>{r.counterpartyCrewMember.name}</strong>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.status === "awaiting-counterparty"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-blue-500/15 text-blue-300"
                  }`}>
                    {r.status === "awaiting-counterparty" ? "Waiting on them" : "Waiting for manager"}
                  </span>
                </div>
                <div className="text-xs text-muted mt-1">
                  Your shift {formatDate(r.requesterDate)} ↔ their shift {formatDate(r.counterpartyDate)} · {r.pool.name}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* PTO Section */}
      <section className="bg-surface border border-t-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Time Off</h2>
          {!showPtoForm && data.myPools && data.myPools.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPtoForm(true)}
              className="text-xs px-3 py-1.5 rounded bg-orange-500 text-white font-medium"
            >
              Request PTO
            </button>
          )}
        </div>

        {showPtoForm && data.crewMember && data.myPools && (
          <PtoRequestForm
            crewMemberId={data.crewMember.id}
            pools={data.myPools}
            onClose={() => setShowPtoForm(false)}
            onSubmitted={() => {
              setShowPtoForm(false);
              queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
            }}
          />
        )}

        {data.ptoRequests && data.ptoRequests.length > 0 ? (
          <div className="space-y-2">
            {data.ptoRequests.map((pto) => (
              <div key={pto.id} className="flex items-center justify-between bg-surface-2 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">
                    {formatDate(pto.startDate)}
                    {pto.startDate !== pto.endDate && <> – {formatDate(pto.endDate)}</>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {pto.pool.name}
                    {pto.reason && <> · {pto.reason}</>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pto.status === "approved"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300"
                }`}>
                  {pto.status === "approved" ? "Approved" : "Pending"}
                </span>
              </div>
            ))}
          </div>
        ) : !showPtoForm ? (
          <p className="text-sm text-muted">No upcoming PTO requests.</p>
        ) : null}
      </section>

      {/* Upcoming shifts */}
      <section className="bg-surface border border-t-border rounded-lg p-5">
        <h2 className="text-sm font-semibold mb-3">Your Upcoming Shifts</h2>
        {data.shifts.length === 0 ? (
          <p className="text-sm text-muted italic">No upcoming shifts. Admin may need to Publish the schedule.</p>
        ) : (
          <div className="space-y-2">
            {data.shifts.map((s, i) => (
              <div key={i} className="bg-surface-2 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{formatShift(s)}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {s.poolName} · {formatShiftWindows(s)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProposeForShift(s)}
                    className="text-xs px-3 py-1.5 rounded bg-surface border border-t-border text-muted hover:text-foreground hover:border-orange-500/30"
                  >
                    Swap This Shift
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {data.shifts.length > 0 && (
          <p className="text-xs text-muted mt-3">
            To swap a shift, click &ldquo;Swap This Shift&rdquo; and pick who you&apos;ll trade with.
            They&apos;ll get a request, and once they accept, a manager approves the final swap.
          </p>
        )}
      </section>

      {/* Calendar subscribe */}
      {data.subscribeUrls && data.subscribeUrls.some((s) => s.icalUrl || s.googleCalendarId) && (
        <section className="bg-surface border border-t-border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-1">Add to your calendar</h2>
          <p className="text-xs text-muted mb-3">
            Your shifts also auto-invite you on Google Calendar. These let you see <em>everyone&apos;s</em> shifts.
          </p>
          <div className="space-y-3">
            {data.subscribeUrls.map((s) => (
              <div key={s.poolId} className="text-xs">
                <div className="font-semibold text-foreground mb-1">{s.poolName}</div>
                {s.googleCalendarId && (
                  <div className="text-muted mb-1">
                    Google Calendar ID:{" "}
                    <code className="bg-surface-2 px-2 py-0.5 rounded">{s.googleCalendarId}</code>
                    <span className="ml-2 opacity-70">
                      (Google Calendar → Other calendars → + → Subscribe to calendar → paste this ID)
                    </span>
                  </div>
                )}
                {s.icalUrl && (
                  <div className="text-muted">
                    iCal feed:{" "}
                    <code className="bg-surface-2 px-2 py-0.5 rounded break-all">
                      {typeof window !== "undefined" ? window.location.origin : ""}
                      {s.icalUrl}
                    </code>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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

// ---------------------------------------------------------------------------
// PTO Request Form (inline)
// ---------------------------------------------------------------------------

function PtoRequestForm({
  crewMemberId,
  pools,
  onClose,
  onSubmitted,
}: {
  crewMemberId: string;
  pools: PoolOption[];
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!poolId || !startDate || !endDate) return;
    if (startDate > endDate) {
      setErr("End date must be on or after start date.");
      return;
    }
    if (startDate < todayStr()) {
      setErr("Start date must be today or later.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/on-call/pto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId,
          crewMemberId,
          startDate,
          endDate,
          reason: reason.trim() || undefined,
        }),
      });
      const text = await res.text();
      const json: { error?: string } = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-surface-2 border border-t-border rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold mb-3">Request Time Off</h3>

      {err && (
        <div className="text-sm rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 mb-3">
          {err}
        </div>
      )}

      {pools.length > 1 && (
        <div className="mb-3">
          <label className="block text-xs text-muted mb-1">Pool</label>
          <select
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            className="w-full bg-surface border border-t-border rounded px-2 py-1.5 text-sm"
          >
            {pools.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-muted mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
            }}
            min={todayStr()}
            required
            className="w-full bg-surface border border-t-border rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate || todayStr()}
            required
            className="w-full bg-surface border border-t-border rounded px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-muted mb-1">Reason (optional)</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. vacation, appointment, family"
          className="w-full bg-surface border border-t-border rounded px-2 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-3 py-2 rounded border border-t-border text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !startDate || !endDate}
          className="flex-1 px-3 py-2 rounded bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit Request"}
        </button>
      </div>

      <p className="text-xs text-muted mt-3">
        Your manager will review and approve. A replacement will be assigned for your shift dates.
      </p>
    </form>
  );
}
