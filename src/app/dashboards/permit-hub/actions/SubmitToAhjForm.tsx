"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  submissionDate: string;
  method: "portal" | "paper" | "solarapp_plus" | "other";
  referenceNumber?: string;
  feePaid?: boolean;
  notes?: string;
}

export function SubmitToAhjForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="SUBMIT_TO_AHJ"
      title="Submit to AHJ"
      validate={(v) =>
        !v.submissionDate
          ? "Submission date required"
          : !v.method
            ? "Method required"
            : null
      }
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/submit-to-ahj", {
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
            <span className="text-muted text-xs uppercase">Method</span>
            <select
              value={v.method ?? ""}
              onChange={(e) =>
                update({ method: e.target.value as Payload["method"] })
              }
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="portal">Portal</option>
              <option value="paper">Paper</option>
              <option value="solarapp_plus">SolarApp+</option>
              <option value="other">Other</option>
            </select>
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
          <label className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              checked={v.feePaid ?? false}
              onChange={(e) => update({ feePaid: e.target.checked })}
            />
            <span className="text-muted text-xs uppercase">Permit fee paid</span>
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
