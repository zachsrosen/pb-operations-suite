"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  contactDate: string;
  contactMethod: "phone" | "email" | "portal" | "in_person";
  whatWasSaid: string;
  nextFollowUpDate?: string;
}

export function FollowUpForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="FOLLOW_UP_UTILITY"
      title="Follow up with utility"
      validate={(v) => {
        if (!v.contactDate) return "Contact date required";
        if (!v.contactMethod) return "Method required";
        if (!v.whatWasSaid) return "Summary required";
        return null;
      }}
      onSubmit={async (payload) => {
        const r = await fetch("/api/ic-hub/actions/follow-up", {
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
            <span className="text-muted text-xs uppercase">Contact date</span>
            <input
              type="date"
              value={v.contactDate ?? ""}
              onChange={(e) => update({ contactDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Method</span>
            <select
              value={v.contactMethod ?? ""}
              onChange={(e) =>
                update({ contactMethod: e.target.value as Payload["contactMethod"] })
              }
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
              <option value="portal">Portal</option>
              <option value="in_person">In person</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">What was said</span>
            <textarea
              value={v.whatWasSaid ?? ""}
              onChange={(e) => update({ whatWasSaid: e.target.value })}
              rows={2}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Next follow-up</span>
            <input
              type="date"
              value={v.nextFollowUpDate ?? ""}
              onChange={(e) => update({ nextFollowUpDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
        </div>
      )}
    </FormShell>
  );
}
