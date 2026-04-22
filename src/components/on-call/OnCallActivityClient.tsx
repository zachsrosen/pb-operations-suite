"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useState } from "react";

type Swap = {
  id: string;
  requesterCrewMember: { id: string; name: string };
  counterpartyCrewMember: { id: string; name: string };
  requesterDate: string;
  counterpartyDate: string;
  reason: string | null;
  status: string;
  denialReason: string | null;
  createdAt: string;
  updatedAt: string;
  counterpartyAcceptedAt: string | null;
  pool: { id: string; name: string };
};

type Pto = {
  id: string;
  crewMember: { id: string; name: string };
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  denialReason: string | null;
  createdAt: string;
  updatedAt: string;
  pool: { id: string; name: string };
};

type ActivityResp = {
  pendingSwaps: Swap[];
  recentSwaps: Swap[];
  pendingPto: Pto[];
  recentPto: Pto[];
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtRelative(isoTs: string): string {
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoTs).toLocaleDateString();
}

function statusPill(status: string): React.ReactNode {
  const map: Record<string, string> = {
    "awaiting-counterparty": "bg-blue-500/15 text-blue-300 border-blue-500/30",
    "awaiting-admin": "bg-orange-500/15 text-orange-300 border-orange-500/30",
    approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    denied: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    cancelled: "bg-zinc-500/15 text-muted border-zinc-500/30",
  };
  const label: Record<string, string> = {
    "awaiting-counterparty": "Waiting for counterparty",
    "awaiting-admin": "Waiting for admin",
    approved: "Approved",
    denied: "Denied",
    cancelled: "Cancelled",
  };
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}

export function OnCallActivityClient() {
  const queryClient = useQueryClient();
  const q = useQuery<ActivityResp>({
    queryKey: ["on-call", "activity"],
    queryFn: async () => {
      const res = await fetch("/api/on-call/activity");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [actionErr, setActionErr] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["on-call"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
  };

  const approveSwap = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/on-call/swaps/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        const json: { error?: string } = text ? JSON.parse(text) : {};
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e: Error) => setActionErr(e.message),
  });

  const denySwap = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt("Reason for denial (optional):") ?? "";
      const res = await fetch(`/api/on-call/swaps/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denialReason: reason || undefined }),
      });
      if (!res.ok) {
        const text = await res.text();
        const json: { error?: string } = text ? JSON.parse(text) : {};
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e: Error) => setActionErr(e.message),
  });

  const denyPto = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt("Reason for denial (optional):") ?? "";
      const res = await fetch(`/api/on-call/pto/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denialReason: reason || undefined }),
      });
      if (!res.ok) {
        const text = await res.text();
        const json: { error?: string } = text ? JSON.parse(text) : {};
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: invalidate,
    onError: (e: Error) => setActionErr(e.message),
  });

  if (q.isLoading) return <div className="text-muted">Loading…</div>;
  if (q.error) return <div className="text-rose-400">Failed to load activity.</div>;
  if (!q.data) return null;
  const { pendingSwaps, recentSwaps, pendingPto, recentPto } = q.data;

  const nothingPending = pendingSwaps.length === 0 && pendingPto.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {actionErr && (
        <div className="text-sm rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2">
          {actionErr}
        </div>
      )}

      {/* Pending summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatTile
          label="Pending Swaps"
          count={pendingSwaps.length}
          empty="Inbox clear"
        />
        <StatTile
          label="Pending PTO"
          count={pendingPto.length}
          empty="Inbox clear"
        />
      </div>

      {nothingPending && (
        <div className="bg-surface border border-t-border rounded-lg p-8 text-center">
          <p className="text-muted">Nothing pending right now. 🎉</p>
          <p className="text-xs text-muted mt-1">Self-service swaps auto-apply when the counterparty accepts — you&apos;ll only see items here if someone needs your attention.</p>
        </div>
      )}

      {/* Pending swap requests */}
      {pendingSwaps.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Pending Swap Requests</h2>
          <div className="space-y-2">
            {pendingSwaps.map((s) => (
              <div key={s.id} className="bg-surface border border-t-border rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">{s.requesterCrewMember.name}</span>
                  <span className="text-muted">→</span>
                  <span className="text-sm font-semibold">{s.counterpartyCrewMember.name}</span>
                  <span className="text-xs text-muted ml-auto">{s.pool.name}</span>
                  {statusPill(s.status)}
                </div>
                <div className="text-xs text-muted mb-2">
                  {s.requesterCrewMember.name} covers <strong className="text-foreground">{fmtDate(s.counterpartyDate)}</strong>,
                  {" "}{s.counterpartyCrewMember.name} covers <strong className="text-foreground">{fmtDate(s.requesterDate)}</strong>
                  <span className="ml-2">· proposed {fmtRelative(s.createdAt)}</span>
                </div>
                {s.reason && <div className="text-xs italic text-muted mb-2">&ldquo;{s.reason}&rdquo;</div>}
                <div className="flex gap-2">
                  {s.status === "awaiting-admin" && (
                    <button
                      type="button"
                      disabled={approveSwap.isPending}
                      onClick={() => approveSwap.mutate(s.id)}
                      className="px-3 py-1.5 rounded bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={denySwap.isPending}
                    onClick={() => denySwap.mutate(s.id)}
                    className="px-3 py-1.5 rounded border border-t-border text-xs text-muted hover:text-foreground disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending PTO */}
      {pendingPto.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Pending PTO Requests</h2>
          <div className="space-y-2">
            {pendingPto.map((p) => (
              <div key={p.id} className="bg-surface border border-t-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">{p.crewMember.name}</span>
                  <span className="text-xs text-muted ml-auto">{p.pool.name}</span>
                  {statusPill(p.status)}
                </div>
                <div className="text-xs text-muted mb-2">
                  <strong className="text-foreground">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</strong>
                  <span className="ml-2">· requested {fmtRelative(p.createdAt)}</span>
                </div>
                {p.reason && <div className="text-xs italic text-muted mb-2">&ldquo;{p.reason}&rdquo;</div>}
                <div className="flex gap-2">
                  <span className="text-xs text-muted italic">Approve from Day-Actions drawer on the Month view — pick reassignments per day.</span>
                  <button
                    type="button"
                    disabled={denyPto.isPending}
                    onClick={() => denyPto.mutate(p.id)}
                    className="ml-auto px-3 py-1.5 rounded border border-t-border text-xs text-muted hover:text-foreground disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent resolutions */}
      {(recentSwaps.length > 0 || recentPto.length > 0) && (
        <section>
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Recent Activity (last 30 days)</h2>
          <div className="bg-surface border border-t-border rounded-lg divide-y divide-t-border">
            {[...recentSwaps, ...recentPto]
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
              .slice(0, 30)
              .map((item) => {
                const isSwap = "counterpartyCrewMember" in item;
                if (isSwap) {
                  const s = item as Swap;
                  return (
                    <div key={`s-${s.id}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <span className="opacity-60">{fmtRelative(s.updatedAt)}</span>
                      <span>
                        Swap: <strong>{s.requesterCrewMember.name}</strong> ↔{" "}
                        <strong>{s.counterpartyCrewMember.name}</strong> ({s.pool.name})
                      </span>
                      <span className="ml-auto">{statusPill(s.status)}</span>
                    </div>
                  );
                } else {
                  const p = item as Pto;
                  return (
                    <div key={`p-${p.id}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <span className="opacity-60">{fmtRelative(p.updatedAt)}</span>
                      <span>
                        PTO: <strong>{p.crewMember.name}</strong> {fmtDate(p.startDate)}–{fmtDate(p.endDate)} ({p.pool.name})
                      </span>
                      <span className="ml-auto">{statusPill(p.status)}</span>
                    </div>
                  );
                }
              })}
          </div>
        </section>
      )}
    </div>
  );
}

function StatTile({ label, count, empty }: { label: string; count: number; empty: string }) {
  return (
    <div className="bg-surface border border-t-border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className="text-2xl font-bold text-foreground">
        {count > 0 ? count : <span className="text-muted italic text-base">{empty}</span>}
      </div>
    </div>
  );
}
