"use client";

/**
 * RaiseFlagButton — drop-in trigger to manually raise a PM flag on a deal.
 *
 * Usage:
 *   <RaiseFlagButton dealId="12345678" dealName="Williams, Robert" />
 *
 * Renders nothing if the user isn't logged in. Anyone with API access to
 * /api/pm-flags can post — the API enforces additional role gates.
 */

import { useState } from "react";

const TYPE_OPTIONS = [
  { value: "STAGE_STUCK",        label: "Stage stuck" },
  { value: "MILESTONE_OVERDUE",  label: "Milestone overdue" },
  { value: "CUSTOMER_COMPLAINT", label: "Customer complaint" },
  { value: "MISSING_DATA",       label: "Missing data" },
  { value: "CHANGE_ORDER",       label: "Change order" },
  { value: "INSTALL_BLOCKED",    label: "Install blocked" },
  { value: "PERMIT_ISSUE",       label: "Permit issue" },
  { value: "INTERCONNECT_ISSUE", label: "Interconnect issue" },
  { value: "DESIGN_ISSUE",       label: "Design issue" },
  { value: "PAYMENT_ISSUE",      label: "Payment issue" },
  { value: "OTHER",              label: "Other" },
];

const SEVERITY_OPTIONS = [
  { value: "LOW",      label: "Low" },
  { value: "MEDIUM",   label: "Medium" },
  { value: "HIGH",     label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

export interface RaiseFlagButtonProps {
  dealId: string;
  dealName?: string;
  /** Visible button text. Default: "Flag for PM". */
  label?: string;
  /** Tailwind classes to override the trigger style. */
  className?: string;
  /** Called after a successful flag creation. Useful for re-fetching deal state. */
  onFlagCreated?: (flagId: string) => void;
}

export function RaiseFlagButton({
  dealId,
  dealName,
  label = "Flag for PM",
  className,
  onFlagCreated,
}: RaiseFlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("STAGE_STUCK");
  const [severity, setSeverity] = useState("MEDIUM");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/pm-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubspotDealId: dealId,
          dealName: dealName ?? null,
          type,
          severity,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      const body = (await res.json()) as { flag: { id: string } };
      setSuccess(`Flag raised — assigned to a PM.`);
      onFlagCreated?.(body.flag.id);
      setReason("");
      // Auto-close after a beat so user sees the success state.
      setTimeout(() => setOpen(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to raise flag");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-orange-500 hover:bg-orange-600 text-white font-medium"
        }
      >
        <span aria-hidden>⚠</span> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-surface-elevated border border-t-border rounded-lg max-w-md w-full mx-4 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Raise PM flag</h3>
                {dealName && <p className="text-sm text-muted mt-0.5">{dealName}</p>}
              </div>
              <button
                onClick={() => !busy && setOpen(false)}
                className="text-muted hover:text-foreground text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Type</label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  disabled={busy}
                  className="w-full mt-1 bg-background border border-t-border rounded-md p-2 text-sm text-foreground"
                >
                  {TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Severity</label>
                <select
                  value={severity}
                  onChange={e => setSeverity(e.target.value)}
                  disabled={busy}
                  className="w-full mt-1 bg-background border border-t-border rounded-md p-2 text-sm text-foreground"
                >
                  {SEVERITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide text-muted">Reason</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={4}
                  disabled={busy}
                  placeholder="What needs PM attention?"
                  className="w-full mt-1 bg-background border border-t-border rounded-md p-2 text-sm text-foreground"
                />
              </div>

              {error && (
                <div className="p-2 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="p-2 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm">
                  {success}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => !busy && setOpen(false)}
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-md bg-surface hover:bg-surface-2 border border-t-border text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy || reason.trim().length === 0}
                  className="flex-1 px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-medium"
                >
                  {busy ? "Raising…" : "Raise flag"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default RaiseFlagButton;
