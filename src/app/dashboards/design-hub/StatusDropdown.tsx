"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Tab } from "@/lib/design-hub/types";
import { ACCENTS, type Accent } from "./accents";

interface OptionsPayload {
  options: Array<{ value: string; label: string }>;
  terminalStatuses: string[];
}

/**
 * Write-back for the ACTIVE tab's status property. Every active option is
 * offered — HubSpot enforces no design status machine, and a client-side
 * transition allowlist would block legitimate corrections. Terminal writes
 * confirm first, since they drop the deal out of the queue.
 */
export function StatusDropdown({
  tab,
  dealId,
  current,
  currentLabel,
  accent,
}: {
  tab: Tab;
  dealId: string;
  current: string;
  currentLabel: string;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const optionsQuery = useQuery<OptionsPayload>({
    queryKey: [...queryKeys.designHub.root, "options", tab],
    queryFn: async () => {
      const r = await fetch(`/api/design-hub/options?tab=${tab}`);
      if (!r.ok) throw new Error("Failed to load options");
      return r.json();
    },
    // Property definitions change rarely; no need to refetch per selection.
    staleTime: 10 * 60_000,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async (status: string) => {
      const r = await fetch("/api/design-hub/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab, dealId, status }),
      });
      const body = (await r.json().catch(() => null)) as {
        error?: string;
        warnings?: string[];
      } | null;
      if (!r.ok) throw new Error(body?.error ?? "Failed to set status");
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.queue(tab),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.project(tab, dealId),
      });
      setOpen(false);
    },
  });

  const terminal = new Set(optionsQuery.data?.terminalStatuses ?? []);

  function choose(value: string, label: string) {
    if (value === current) {
      setOpen(false);
      return;
    }
    if (
      terminal.has(value) &&
      !window.confirm(
        `Set status to "${label}"? That removes this project from the queue.`,
      )
    ) {
      return;
    }
    mutation.mutate(value);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        className="text-foreground w-full truncate rounded-md bg-surface-2 px-2 py-1 text-left text-xs hover:bg-surface-elevated disabled:opacity-50"
      >
        {mutation.isPending ? "Saving…" : currentLabel}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-t-border bg-surface-elevated shadow-card">
          {optionsQuery.isLoading ? (
            <div className="text-muted p-2 text-xs">Loading…</div>
          ) : optionsQuery.isError ? (
            <div className="p-2 text-xs text-red-600 dark:text-red-400">
              Could not load options.
            </div>
          ) : (
            (optionsQuery.data?.options ?? []).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value, o.label)}
                className={`block w-full px-2.5 py-1.5 text-left text-xs hover:bg-surface-2 ${
                  o.value === current ? a.tabActiveBadge : "text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}

      {mutation.isError && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to set status"}
        </p>
      )}
    </div>
  );
}
