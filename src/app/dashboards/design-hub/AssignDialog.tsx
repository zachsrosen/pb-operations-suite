"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { DESIGN_LEAD_OPTIONS } from "@/lib/design-hub/roster";
import type { Tab } from "@/lib/design-hub/types";
import { ACCENTS, type Accent } from "./accents";

/**
 * Push an ask at a designer. Targets come from the static DESIGN_LEADS roster
 * rather than a free-text field — misassigning real work to a typo'd address
 * is worse than a constrained list.
 */
export function AssignDialog({
  tab,
  dealId,
  currentStatus,
  accent,
  onClose,
}: {
  tab: Tab;
  dealId: string;
  /** Live status VALUE, stored so the row can later show a "moved" hint. */
  currentStatus: string;
  accent: Accent;
  onClose: () => void;
}) {
  const a = ACCENTS[accent];
  const queryClient = useQueryClient();
  const [assigneeEmail, setAssigneeEmail] = useState(
    DESIGN_LEAD_OPTIONS[0]?.email ?? "",
  );
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/design-hub/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab,
          dealId,
          assigneeEmail,
          statusAtAssignment: currentStatus,
          note: note.trim() || undefined,
          // A date input gives YYYY-MM-DD; the API wants a datetime. Noon UTC
          // avoids the off-by-one-day that midnight produces west of GMT.
          dueDate: dueDate ? `${dueDate}T12:00:00.000Z` : undefined,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to assign");
      }
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.queue(tab),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.assignments(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.project(tab, dealId),
      });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-t-border bg-surface-elevated p-4 shadow-card">
        <h2 className="text-foreground mb-3 text-sm font-semibold">
          Assign this project
        </h2>

        <label className="text-muted mb-1 block text-xs font-medium">
          Designer
        </label>
        <select
          value={assigneeEmail}
          onChange={(e) => setAssigneeEmail(e.target.value)}
          className={`mb-3 w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
        >
          {DESIGN_LEAD_OPTIONS.map((l) => (
            <option key={l.email} value={l.email}>
              {l.name}
            </option>
          ))}
        </select>

        <label className="text-muted mb-1 block text-xs font-medium">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What needs to happen?"
          className={`mb-3 w-full resize-none rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
        />

        <label className="text-muted mb-1 block text-xs font-medium">
          Due (optional)
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={`mb-4 w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
        />

        {mutation.isError && (
          <p className="mb-3 text-xs text-red-600 dark:text-red-400">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Failed to assign"}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-muted rounded-lg bg-surface-2 px-3 py-2 text-sm hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !assigneeEmail}
            className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${a.primaryButton}`}
          >
            {mutation.isPending ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
