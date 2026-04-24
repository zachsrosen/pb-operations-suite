"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  resubmissionDate: string;
  referenceNumber?: string;
  whatChanged: string;
  notes?: string;
  asBuilt?: boolean;
}

export function ResubmitToAhjForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="RESUBMIT_TO_AHJ"
      title="Resubmit to AHJ"
      validate={(v) =>
        !v.resubmissionDate
          ? "Resubmission date required"
          : !v.whatChanged
            ? "Describe what changed"
            : null
      }
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/resubmit-to-ahj", {
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
            <span className="text-muted text-xs uppercase">Resubmission date</span>
            <input
              type="date"
              value={v.resubmissionDate ?? ""}
              onChange={(e) => update({ resubmissionDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Reference #</span>
            <input
              type="text"
              value={v.referenceNumber ?? ""}
              onChange={(e) => update({ referenceNumber: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">What changed</span>
            <textarea
              value={v.whatChanged ?? ""}
              onChange={(e) => update({ whatChanged: e.target.value })}
              rows={2}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.asBuilt ?? false}
              onChange={(e) => update({ asBuilt: e.target.checked })}
            />
            <span className="text-muted text-xs uppercase">As-built resubmission</span>
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
