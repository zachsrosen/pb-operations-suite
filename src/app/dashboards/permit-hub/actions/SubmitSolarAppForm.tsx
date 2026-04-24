"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  submissionDate: string;
  solarAppProjectNumber: string;
  notes?: string;
}

export function SubmitSolarAppForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="SUBMIT_SOLARAPP"
      title="Submit SolarApp+"
      validate={(v) =>
        !v.submissionDate
          ? "Submission date required"
          : !v.solarAppProjectNumber
            ? "SolarApp+ project # required"
            : null
      }
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/submit-solarapp", {
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
            <span className="text-muted text-xs uppercase">SolarApp+ project #</span>
            <input
              type="text"
              value={v.solarAppProjectNumber ?? ""}
              onChange={(e) => update({ solarAppProjectNumber: e.target.value })}
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
