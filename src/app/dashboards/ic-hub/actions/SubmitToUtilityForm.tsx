"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  submissionDate: string;
  referenceNumber?: string;
  notes?: string;
}

export function SubmitToUtilityForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="SUBMIT_TO_UTILITY"
      title="Submit to Utility"
      validate={(v) => (!v.submissionDate ? "Submission date required" : null)}
      onSubmit={async (payload) => {
        const r = await fetch("/api/ic-hub/actions/submit-to-utility", {
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
            <span className="text-muted text-xs uppercase">Submission date</span>
            <input
              type="date"
              value={v.submissionDate ?? ""}
              onChange={(e) => update({ submissionDate: e.target.value })}
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
