"use client";

import { useEffect, useState } from "react";

type Pool = {
  id: string;
  name: string;
  region: string;
  shiftStart: string;
  shiftEnd: string;
  timezone: string;
  startDate: string;
  horizonMonths: number;
};

type Member = {
  id: string;
  crewMemberId: string;
  orderIndex: number;
  isActive: boolean;
  crewMember: { id: string; name: string; email: string | null };
};

export function PoolConfigCard({ pool }: { pool: Pool }) {
  const [startDate, setStartDate] = useState(pool.startDate);
  const [shiftStart, setShiftStart] = useState(pool.shiftStart);
  const [shiftEnd, setShiftEnd] = useState(pool.shiftEnd);
  const [timezone, setTimezone] = useState(pool.timezone);
  const [horizonMonths, setHorizonMonths] = useState(pool.horizonMonths);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch(`/api/on-call/pools/${pool.id}/members`);
      if (res.ok) {
        const json = await res.json();
        setMembers(json.members);
      }
      setLoading(false);
    })();
  }, [pool.id]);

  function move(idx: number, dir: -1 | 1) {
    const next = [...members];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    next.forEach((m, i) => (m.orderIndex = i));
    setMembers(next);
  }

  function toggleActive(idx: number) {
    const next = [...members];
    next[idx] = { ...next[idx], isActive: !next[idx].isActive };
    setMembers(next);
  }

  async function saveAll() {
    setSaving(true);
    setStatus(null);
    try {
      const metaRes = await fetch(`/api/on-call/pools/${pool.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, shiftStart, shiftEnd, timezone, horizonMonths }),
      });
      if (!metaRes.ok) throw new Error("Failed to save pool metadata");

      const memRes = await fetch(`/api/on-call/pools/${pool.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: members.map((m) => ({ id: m.id, orderIndex: m.orderIndex, isActive: m.isActive })),
        }),
      });
      if (!memRes.ok) throw new Error("Failed to save members");

      setStatus("Saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-t-border rounded-lg p-5">
      <h3 className="text-base font-semibold mb-1">{pool.name}</h3>
      <p className="text-xs text-muted mb-4">{pool.region}</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Start date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                 className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Horizon (months)">
          <input type="number" min={1} max={12} value={horizonMonths}
                 onChange={(e) => setHorizonMonths(Number(e.target.value))}
                 className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Shift start">
          <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)}
                 className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Shift end">
          <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)}
                 className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Timezone">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
                  className="w-full bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm col-span-2">
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/New_York">Eastern (New York)</option>
          </select>
        </Field>
      </div>

      <div className="mb-3">
        <div className="text-xs uppercase tracking-wider text-muted mb-2">Rotation Order ({members.length} members)</div>
        {loading ? (
          <div className="text-sm text-muted">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-muted italic">No members yet.</div>
        ) : (
          <div className="space-y-1">
            {members.map((m, idx) => (
              <div key={m.id} className="flex items-center gap-2 bg-surface-2 border border-t-border rounded px-2 py-1.5 text-sm">
                <span className="text-xs text-muted w-6 text-right">{idx + 1}.</span>
                <span className={`flex-1 ${m.isActive ? "" : "line-through opacity-50"}`}>{m.crewMember.name}</span>
                <button type="button" onClick={() => toggleActive(idx)}
                        className={`text-xs px-2 py-0.5 rounded ${m.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                  {m.isActive ? "Active" : "Inactive"}
                </button>
                <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                        className="text-muted disabled:opacity-30 px-1">↑</button>
                <button type="button" onClick={() => move(idx, 1)} disabled={idx === members.length - 1}
                        className="text-muted disabled:opacity-30 px-1">↓</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{status}</span>
        <button type="button" onClick={saveAll} disabled={saving}
                className="px-4 py-2 rounded bg-orange-500 text-white text-sm font-medium disabled:opacity-50">
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted block mb-1">{label}</span>
      {children}
    </label>
  );
}
