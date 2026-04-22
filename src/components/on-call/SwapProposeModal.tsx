"use client";

import { useEffect, useState } from "react";

type Shift = {
  poolId: string;
  poolName: string;
  startDate: string;
  endDate: string;
};

type Assignment = {
  poolId: string;
  date: string;
  crewMemberId: string;
  crewMemberName: string;
  source: string;
  persisted: boolean;
};

type Props = {
  myCrewMemberId: string;
  myName: string;
  shift: Shift;
  onClose: () => void;
  onSubmitted: () => void;
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function SwapProposeModal({ myCrewMemberId, myName, shift, onClose, onSubmitted }: Props) {
  const [candidates, setCandidates] = useState<Assignment[] | null>(null);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Load future assignments in this pool (excluding my own) as swap candidates.
    const from = addDays(shift.endDate, 1);
    const to = addDays(shift.endDate, 120); // look ~4 months out
    void (async () => {
      try {
        const res = await fetch(`/api/on-call/assignments?poolId=${shift.poolId}&from=${from}&to=${to}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: { assignments: Assignment[] } = await res.json();
        // Group consecutive same-member assignments into week blocks; keep the first date of each block.
        const blocks: Assignment[] = [];
        for (const a of json.assignments) {
          if (a.crewMemberId === myCrewMemberId) continue;
          const last = blocks[blocks.length - 1];
          if (last && last.crewMemberId === a.crewMemberId && addDays(last.date, 1) === a.date) {
            // extend — we only track first date, so skip
            continue;
          }
          blocks.push(a);
        }
        setCandidates(blocks);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load candidates");
      }
    })();
  }, [shift.poolId, shift.endDate, myCrewMemberId]);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/on-call/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId: shift.poolId,
          requesterCrewMemberId: myCrewMemberId,
          requesterDate: shift.startDate, // day we give up (first day of our week block)
          counterpartyCrewMemberId: selected.crewMemberId,
          counterpartyDate: selected.date,
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
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-t-border rounded-t-xl md:rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-base font-semibold">Request Swap</h3>
          <p className="text-xs text-muted mt-1">
            You&apos;re giving up your shift <strong>{formatDate(shift.startDate)}</strong>
            {shift.startDate !== shift.endDate && <> – <strong>{formatDate(shift.endDate)}</strong></>}
            {" "}({shift.poolName}). Pick whose shift you&apos;ll cover in return.
          </p>
        </div>

        {err && (
          <div className="text-sm rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2 mb-3">
            {err}
          </div>
        )}

        {!candidates ? (
          <div className="text-sm text-muted">Loading candidates…</div>
        ) : candidates.length === 0 ? (
          <div className="text-sm text-muted italic">
            No upcoming shifts in this pool to swap with. Ask an admin to Publish farther out first.
          </div>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {candidates.map((c) => {
              const active = selected?.date === c.date && selected.crewMemberId === c.crewMemberId;
              return (
                <button
                  key={`${c.date}-${c.crewMemberId}`}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={
                    active
                      ? "w-full text-left px-3 py-2 rounded border border-orange-500/50 bg-orange-500/10 text-foreground"
                      : "w-full text-left px-3 py-2 rounded border border-t-border bg-surface-2 hover:border-orange-500/30"
                  }
                >
                  <div className="text-sm font-medium">{c.crewMemberName}</div>
                  <div className="text-xs text-muted">
                    {formatDate(c.date)}
                    {c.source === "manual" && <span className="ml-2 text-orange-300">· manually set</span>}
                    {!c.persisted && <span className="ml-2 text-muted/60">· forecast</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. kid's recital, PTO, etc."
            className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm"
            rows={2}
          />
        </div>

        <div className="mt-4 flex gap-2 sticky bottom-0 bg-surface pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded border border-t-border text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={submit}
            className="flex-1 px-3 py-2 rounded bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Sending…" : `Send request${selected ? ` to ${selected.crewMemberName}` : ""}`}
          </button>
        </div>

        <p className="text-xs text-muted mt-3">
          {myName} ↔ {selected?.crewMemberName ?? "…"}. Once they accept, the swap applies immediately — no admin approval needed.
        </p>
      </div>
    </div>
  );
}
