"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  approvalDate: string;
  icaNumber?: string;
  expirationDate?: string;
  icaDocUrl?: string;
  notes?: string;
}

export function MarkIcApprovedForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="MARK_IC_APPROVED"
      title="Mark IC approved"
      validate={(v) => (!v.approvalDate ? "Approval date required" : null)}
      onSubmit={async (payload) => {
        const r = await fetch("/api/ic-hub/actions/mark-ic-approved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, ...payload }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      }}
    >
      {(v, update) => (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Approval date</span>
            <input
              type="date"
              value={v.approvalDate ?? ""}
              onChange={(e) => update({ approvalDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">ICA #</span>
            <input
              type="text"
              value={v.icaNumber ?? ""}
              onChange={(e) => update({ icaNumber: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Expiration</span>
            <input
              type="date"
              value={v.expirationDate ?? ""}
              onChange={(e) => update({ expirationDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">ICA doc URL</span>
            <input
              type="url"
              value={v.icaDocUrl ?? ""}
              onChange={(e) => update({ icaDocUrl: e.target.value })}
              placeholder="https://drive.google.com/…"
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Notes</span>
            <textarea
              value={v.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              rows={2}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
        </div>
      )}
    </FormShell>
  );
}
