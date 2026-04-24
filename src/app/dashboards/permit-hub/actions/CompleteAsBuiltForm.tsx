"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  completionDate: string;
  updatedPlansetUrl?: string;
  notes?: string;
}

export function CompleteAsBuiltForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="COMPLETE_AS_BUILT"
      title="Complete as-built revision"
      validate={(v) => (!v.completionDate ? "Completion date required" : null)}
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/complete-as-built", {
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
            <span className="text-muted text-xs uppercase">Completion date</span>
            <input
              type="date"
              value={v.completionDate ?? ""}
              onChange={(e) => update({ completionDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Updated planset URL</span>
            <input
              type="url"
              value={v.updatedPlansetUrl ?? ""}
              onChange={(e) => update({ updatedPlansetUrl: e.target.value })}
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
