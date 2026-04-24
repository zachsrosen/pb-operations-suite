"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  trigger: "ahj_requested" | "qc_caught" | "customer";
  scopeNotes: string;
}

export function StartAsBuiltRevisionForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="START_AS_BUILT_REVISION"
      title="Start as-built revision"
      validate={(v) =>
        !v.trigger ? "Trigger required" : !v.scopeNotes ? "Scope notes required" : null
      }
      onSubmit={async (payload) => {
        const r = await fetch(
          "/api/permit-hub/actions/start-as-built-revision",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dealId, ...payload }),
          },
        );
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      }}
    >
      {(v, update) => (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Trigger</span>
            <select
              value={v.trigger ?? ""}
              onChange={(e) =>
                update({ trigger: e.target.value as Payload["trigger"] })
              }
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="ahj_requested">AHJ requested</option>
              <option value="qc_caught">QC caught</option>
              <option value="customer">Customer-initiated</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Scope notes</span>
            <textarea
              value={v.scopeNotes ?? ""}
              onChange={(e) => update({ scopeNotes: e.target.value })}
              rows={3}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
        </div>
      )}
    </FormShell>
  );
}
