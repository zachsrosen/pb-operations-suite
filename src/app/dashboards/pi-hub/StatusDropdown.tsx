"use client";

import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import type { Team } from "@/lib/pi-hub/types";

interface StatusOption {
  value: string;
  label: string;
}

interface OptionsResponse {
  options: StatusOption[];
  terminalStatuses: string[];
}

interface Props {
  team: Team;
  dealId: string;
  /** HubSpot internal VALUE of the current status (routing, not display). */
  currentStatus: string;
  /** Human label for the current status — shown on the trigger. */
  currentStatusLabel: string;
  /** Compact trigger for a queue row; the default trigger shows the label. */
  compact?: boolean;
}

/**
 * Status-change control shared by the queue rows (compact) and the detail
 * header. Options come from the shared React Query cache
 * (queryKeys.piHub.options(team)) so every row on a team reuses one fetch. A
 * terminal status routes through ConfirmDialog first; everything else POSTs on
 * click. The write is honest — a spinner shows until the POST resolves, then
 * the queue / project / today-count caches are invalidated. Post-write
 * warnings (a note or activity-log failure that did NOT block the status
 * write) surface inline as a non-error notice.
 */
export function StatusDropdown({
  team,
  dealId,
  currentStatus,
  currentStatusLabel,
  compact,
}: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingTerminal, setPendingTerminal] = useState<StatusOption | null>(
    null,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click — same idiom as MultiSelectFilter.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const optionsQuery = useQuery<OptionsResponse>({
    queryKey: queryKeys.piHub.options(team),
    queryFn: async () => {
      const r = await fetch(`/api/pi-hub/options?team=${team}`, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error("Failed to load status options");
      return r.json();
    },
    // Fetch lazily — the first row a user opens warms the shared cache for the
    // rest. Options rarely change within a session.
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const terminalSet = new Set(optionsQuery.data?.terminalStatuses ?? []);

  const mutation = useMutation({
    mutationFn: async (value: string) => {
      const r = await fetch("/api/pi-hub/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, dealId, status: value }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        warnings?: string[];
        error?: string;
      };
      if (!r.ok) throw new Error(data.error ?? "Failed to update status");
      return data;
    },
    onSuccess: (data) => {
      setWarnings(data.warnings ?? []);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.piHub.queue(team) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.piHub.project(team, dealId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.piHub.todayCount() });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to update status");
    },
  });

  function handleSelect(opt: StatusOption) {
    setError(null);
    setWarnings([]);
    if (terminalSet.has(opt.value)) {
      // Terminal write — confirm first. Close the popover so the dialog is the
      // only thing in front.
      setPendingTerminal(opt);
      setOpen(false);
    } else {
      mutation.mutate(opt.value);
    }
  }

  const triggerClass = compact
    ? "inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-foreground hover:bg-surface-elevated transition-colors"
    : "inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated transition-colors";

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={(e) => {
          // In a queue row the trigger sits inside the row's own click target;
          // stop the row's onSelect from firing when opening the dropdown.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={mutation.isPending}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClass}
      >
        <span className="truncate">
          {compact ? "Set status" : currentStatusLabel || currentStatus || "—"}
        </span>
        {mutation.isPending ? (
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
            aria-label="Saving"
          />
        ) : (
          <span aria-hidden>▾</span>
        )}
      </button>

      {open && (
        // Right-anchored so the compact trigger in the 420px queue column
        // cannot overflow the panel (matches MultiSelectFilter align="right").
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-t-border bg-surface shadow-card-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {optionsQuery.isLoading ? (
            <div className="text-muted px-3 py-2 text-xs">Loading options…</div>
          ) : optionsQuery.error ? (
            <div className="px-3 py-2 text-xs text-red-500">
              Could not load status options.
            </div>
          ) : (
            <ul className="p-1">
              {(optionsQuery.data?.options ?? []).map((opt) => {
                const isCurrent = opt.value === currentStatus;
                const isTerminal = terminalSet.has(opt.value);
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      aria-current={isCurrent}
                      onClick={() => handleSelect(opt)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${
                        isCurrent ? "font-semibold" : "text-foreground/90"
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isTerminal && (
                        <span
                          aria-hidden
                          className="text-muted shrink-0 text-[10px] uppercase tracking-wide"
                        >
                          Terminal
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
          Status saved, with warnings:
          <ul className="mt-0.5 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={pendingTerminal !== null}
        title="Set terminal status?"
        message={
          pendingTerminal
            ? `Set status to "${pendingTerminal.label}"? This marks the ${team.toUpperCase()} work complete for this project.`
            : ""
        }
        confirmLabel="Set status"
        onConfirm={() => {
          const p = pendingTerminal;
          setPendingTerminal(null);
          if (p) mutation.mutate(p.value);
        }}
        onCancel={() => setPendingTerminal(null)}
      />
    </div>
  );
}
