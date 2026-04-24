"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  issueDate: string;
  permitNumber: string;
  expirationDate?: string;
  issuedPermitUrl?: string;
}

export function MarkPermitIssuedForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="MARK_PERMIT_ISSUED"
      title="Mark permit issued"
      validate={(v) =>
        !v.issueDate
          ? "Issue date required"
          : !v.permitNumber
            ? "Permit # required"
            : null
      }
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/mark-permit-issued", {
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
            <span className="text-muted text-xs uppercase">Issue date</span>
            <input
              type="date"
              value={v.issueDate ?? ""}
              onChange={(e) => update({ issueDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Permit #</span>
            <input
              type="text"
              value={v.permitNumber ?? ""}
              onChange={(e) => update({ permitNumber: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Expiration date</span>
            <input
              type="date"
              value={v.expirationDate ?? ""}
              onChange={(e) => update({ expirationDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Issued permit URL</span>
            <input
              type="url"
              value={v.issuedPermitUrl ?? ""}
              onChange={(e) => update({ issuedPermitUrl: e.target.value })}
              placeholder="https://drive.google.com/…"
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
        </div>
      )}
    </FormShell>
  );
}
