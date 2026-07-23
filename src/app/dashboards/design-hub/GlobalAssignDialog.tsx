"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { DESIGN_LEAD_OPTIONS } from "@/lib/design-hub/roster";
import { ACCENTS } from "./accents";

interface DealResult {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  designStatus: string;
  layoutStatus: string;
  designStatusLabel: string;
  layoutStatusLabel: string;
}

/**
 * Assign ANY deal, including ones not in the queue (no design status yet).
 * Free-text search → pick a deal → pick a designer + note + due. Always
 * creates a design-tab assignment; the baseline status is the deal's current
 * design_status (empty is fine — the "moved" hint stays off with no baseline).
 */
export function GlobalAssignDialog({ onClose }: { onClose: () => void }) {
  const a = ACCENTS.purple;
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<DealResult | null>(null);
  const [assigneeEmail, setAssigneeEmail] = useState(
    DESIGN_LEAD_OPTIONS[0]?.email ?? "",
  );
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Debounce the search so every keystroke doesn't hit HubSpot.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(term.trim()), 300);
    return () => window.clearTimeout(id);
  }, [term]);

  const search = useQuery<{ deals: DealResult[] }>({
    queryKey: [...queryKeys.designHub.root, "deal-search", debounced],
    queryFn: async () => {
      const r = await fetch(
        `/api/design-hub/deal-search?q=${encodeURIComponent(debounced)}`,
      );
      if (!r.ok) throw new Error("Search failed");
      return r.json();
    },
    enabled: debounced.length >= 2 && !selected,
    staleTime: 30_000,
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a project first");
      const r = await fetch("/api/design-hub/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab: "design",
          dealId: selected.dealId,
          assigneeEmail,
          statusAtAssignment: selected.designStatus, // may be "" — allowed
          note: note.trim() || undefined,
          dueDate: dueDate ? `${dueDate}T12:00:00.000Z` : undefined,
        }),
      });
      const body = (await r.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!r.ok) throw new Error(body?.error ?? "Failed to assign");
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.queue("design"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.assignments(),
      });
      onClose();
    },
  });

  const results = useMemo(() => search.data?.deals ?? [], [search.data]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24">
      <div className="w-full max-w-lg rounded-xl border border-t-border bg-surface-elevated p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-foreground text-sm font-semibold">
            Assign a project
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted text-xs hover:text-foreground"
          >
            Close
          </button>
        </div>

        {!selected ? (
          <>
            <input
              type="search"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search by name, address, or PROJ number…"
              className={`w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {debounced.length < 2 ? (
                <p className="text-muted p-2 text-xs">
                  Type at least 2 characters.
                </p>
              ) : search.isLoading ? (
                <p className="text-muted p-2 text-xs">Searching…</p>
              ) : search.isError ? (
                <p className="p-2 text-xs text-red-600 dark:text-red-400">
                  Search failed — try again.
                </p>
              ) : results.length === 0 ? (
                <p className="text-muted p-2 text-xs">No matching projects.</p>
              ) : (
                results.map((d) => (
                  <button
                    key={d.dealId}
                    type="button"
                    onClick={() => setSelected(d)}
                    className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
                  >
                    <div className="text-foreground truncate text-sm font-medium">
                      {d.name}
                    </div>
                    {d.address && (
                      <div className="text-muted truncate text-xs">
                        {d.address}
                      </div>
                    )}
                    <div className="text-muted mt-0.5 text-[11px]">
                      {d.designStatusLabel}
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-foreground truncate text-sm font-medium">
                {selected.name}
              </div>
              {selected.address && (
                <div className="text-muted truncate text-xs">
                  {selected.address}
                </div>
              )}
              <div className="text-muted mt-0.5 text-[11px]">
                {selected.designStatusLabel}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={`mt-1 text-[11px] font-medium ${a.tabActive.split(" ").slice(1).join(" ")}`}
              >
                ← pick a different project
              </button>
            </div>

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

            {assign.isError && (
              <p className="mb-3 text-xs text-red-600 dark:text-red-400">
                {assign.error instanceof Error
                  ? assign.error.message
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
                onClick={() => assign.mutate()}
                disabled={assign.isPending || !assigneeEmail}
                className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${a.primaryButton}`}
              >
                {assign.isPending ? "Assigning…" : "Assign"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
