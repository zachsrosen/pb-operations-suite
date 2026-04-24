"use client";

import { FormShell } from "./FormShell";

interface Payload extends Record<string, unknown> {
  rejectionDate: string;
  category: "design" | "non_design" | "paperwork";
  reason: string;
  route: "design_revision" | "non_design_fix" | "paperwork_fix";
  notes?: string;
}

export function ReviewRejectionForm({ dealId }: { dealId: string }) {
  return (
    <FormShell<Payload>
      dealId={dealId}
      actionKind="REVIEW_REJECTION"
      title="Review rejection"
      validate={(v) => {
        if (!v.rejectionDate) return "Rejection date required";
        if (!v.category) return "Category required";
        if (!v.reason) return "Reason required";
        if (!v.route) return "Route required";
        return null;
      }}
      onSubmit={async (payload) => {
        const r = await fetch("/api/permit-hub/actions/review-rejection", {
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
            <span className="text-muted text-xs uppercase">Rejection date</span>
            <input
              type="date"
              value={v.rejectionDate ?? ""}
              onChange={(e) => update({ rejectionDate: e.target.value })}
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Category</span>
            <select
              value={v.category ?? ""}
              onChange={(e) =>
                update({ category: e.target.value as Payload["category"] })
              }
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="design">Design</option>
              <option value="non_design">Non-design</option>
              <option value="paperwork">Paperwork</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Reason</span>
            <textarea
              value={v.reason ?? ""}
              onChange={(e) => update({ reason: e.target.value })}
              rows={3}
              placeholder="What did the AHJ call out?"
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs uppercase">Route to</span>
            <select
              value={v.route ?? ""}
              onChange={(e) =>
                update({ route: e.target.value as Payload["route"] })
              }
              className="border-t-border bg-surface-2 rounded-md border px-2 py-1.5"
            >
              <option value="">—</option>
              <option value="design_revision">Design revision</option>
              <option value="non_design_fix">Non-design fix</option>
              <option value="paperwork_fix">Paperwork fix</option>
            </select>
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
