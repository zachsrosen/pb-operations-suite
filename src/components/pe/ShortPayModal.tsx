"use client";

import { useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// Short-pay entry modal (admin/owner): record per-milestone shortfalls so PE
// "collected" totals reflect dollars actually received, not the expected
// milestone amount. Stored server-side via /api/admin/pe/payment-adjustment.
// Shared by the PE Report page and the PE hub's Deals & Payments tab.
// ---------------------------------------------------------------------------

export interface ShortPayDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  peM1Status: string | null;
  peM2Status: string | null;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  m1PaymentShort: number;
  m2PaymentShort: number;
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ShortPayModal({ deals, onClose, onSaved }: {
  deals: ShortPayDeal[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [m1Short, setM1Short] = useState("");
  const [m2Short, setM2Short] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(
    () => deals.filter((d) => (d.m1PaymentShort ?? 0) > 0 || (d.m2PaymentShort ?? 0) > 0),
    [deals],
  );
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return deals.filter((d) => d.dealName.toLowerCase().includes(q)).slice(0, 8);
  }, [deals, search]);
  const selected = selectedId ? deals.find((d) => d.dealId === selectedId) ?? null : null;

  const pick = (d: ShortPayDeal) => {
    setSelectedId(d.dealId);
    setSearch(d.dealName);
    setM1Short((d.m1PaymentShort ?? 0) > 0 ? String(d.m1PaymentShort) : "");
    setM2Short((d.m2PaymentShort ?? 0) > 0 ? String(d.m2PaymentShort) : "");
  };

  const save = async () => {
    if (!selectedId) { setError("Pick a deal first."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pe/payment-adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: selectedId, m1Short: Number(m1Short) || 0, m2Short: Number(m2Short) || 0, note }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface-elevated rounded-xl border border-border shadow-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-foreground">Record short-pay</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none">×</button>
        </div>
        <p className="text-xs text-muted mb-4">
          Enter how much <em>less</em> than the milestone amount PE actually paid. Set both to 0 to clear a deal.
        </p>

        <label className="block text-xs font-medium text-muted mb-1">Deal</label>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedId(null); }}
          placeholder="Search by deal name…"
          className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground mb-1 focus:outline-none focus:border-foreground/30"
        />
        {!selected && matches.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden mb-3 divide-y divide-border">
            {matches.map((d) => (
              <button key={d.dealId} onClick={() => pick(d)} className="block w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-surface-2">
                {d.dealName}
                <span className="text-xs text-muted ml-2">{d.pbLocation}</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="text-xs text-muted mb-3">
            M1: {selected.peM1Status ?? "—"} ({money(selected.pePaymentIC)}) · M2: {selected.peM2Status ?? "—"} ({money(selected.pePaymentPC)})
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">M1 (IC) short $</label>
            <input type="number" min="0" step="0.01" value={m1Short} onChange={(e) => setM1Short(e.target.value)} placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground focus:outline-none focus:border-foreground/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">M2 (PC) short $</label>
            <input type="number" min="0" step="0.01" value={m2Short} onChange={(e) => setM2Short(e.target.value)} placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground focus:outline-none focus:border-foreground/30" />
          </div>
        </div>

        <label className="block text-xs font-medium text-muted mb-1">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sales entered wrong % — PE paid less than recorded"
          className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-border text-sm text-foreground mb-4 focus:outline-none focus:border-foreground/30" />

        {error && <div className="text-xs text-red-400 mb-3">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-muted hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={saving || !selectedId}
            className="text-sm px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {existing.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="text-xs font-medium text-muted mb-1.5">Current short-pays</div>
            <div className="space-y-1">
              {existing.map((d) => (
                <button key={d.dealId} onClick={() => pick(d)} className="flex w-full items-center justify-between text-xs text-foreground hover:text-emerald-400">
                  <span className="truncate">{d.dealName}</span>
                  <span className="text-red-400 tabular-nums ml-2 shrink-0">{money((d.m1PaymentShort ?? 0) + (d.m2PaymentShort ?? 0))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
