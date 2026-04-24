"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  sentDate: string;
  infoRequested: string;
  whatWasSent: string;
  notes?: string;
}

export function ProvideInformationForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="PROVIDE_INFORMATION"
      title="Provide information to utility"
      validate={(v) => {
        if (!v.sentDate) return "Sent date required";
        if (!v.infoRequested) return "What was requested?";
        if (!v.whatWasSent) return "What did you send?";
        return null;
      }}
      onSubmit={async (payload) => {
        const r = await fetch("/api/ic-hub/actions/provide-information", {
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
            <span className="text-muted text-xs uppercase">Sent date</span>
            <input
              type="date"
              value={v.sentDate ?? ""}
              onChange={(e) => update({ sentDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">What was requested</span>
            <textarea
              value={v.infoRequested ?? ""}
              onChange={(e) => update({ infoRequested: e.target.value })}
              rows={2}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">What you sent</span>
            <textarea
              value={v.whatWasSent ?? ""}
              onChange={(e) => update({ whatWasSent: e.target.value })}
              rows={2}
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
