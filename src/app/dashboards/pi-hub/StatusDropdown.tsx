"use client";

import { useEffect, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import type { Team } from "@/lib/pi-hub/types";

/** Menu max-height (max-h-72) — how much room the popover needs below the trigger. */
const MENU_HEIGHT = 288;

/**
 * Nearest scrollable ancestor, or null. The popover is `absolute`, so it is
 * clipped by the queue's `overflow-y-auto` scroller long before it reaches the
 * viewport edge — that container's bottom, not innerHeight, is the real limit.
 */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Should the menu open upward? True when the trigger sits low enough in its
 * clipping container that a downward menu would be cut off, and there is more
 * room above than below. Measured on open — cheap, and avoids a resize
 * listener for a popover that is only briefly on screen.
 */
function shouldDropUp(trigger: HTMLElement): boolean {
  const rect = trigger.getBoundingClientRect();
  const scroller = scrollParentOf(trigger);
  const limitBottom = scroller
    ? Math.min(scroller.getBoundingClientRect().bottom, window.innerHeight)
    : window.innerHeight;
  const limitTop = scroller
    ? Math.max(scroller.getBoundingClientRect().top, 0)
    : 0;
  const spaceBelow = limitBottom - rect.bottom;
  const spaceAbove = rect.top - limitTop;
  return spaceBelow < MENU_HEIGHT && spaceAbove > spaceBelow;
}

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
 * write) go to a toast: in compact mode the invalidation usually re-groups the
 * row out from under this component, so an inline notice would unmount before
 * anyone read it. The stable detail header ALSO renders them inline.
 */
export function StatusDropdown({
  team,
  dealId,
  currentStatus,
  currentStatusLabel,
  compact,
}: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingTerminal, setPendingTerminal] = useState<StatusOption | null>(
    null,
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  // Close on Escape. The queue scroller is long; reaching for the mouse to
  // dismiss a menu you opened by mistake is the wrong ergonomic.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
      const w = data.warnings ?? [];
      setWarnings(w);
      // Compact rows live in the queue: the invalidation below can re-group the
      // row out of the active tab, unmounting this component before an inline
      // notice is read. A toast outlives it. The detail header is stable, so it
      // keeps the inline notice and does not double-report via a toast.
      if (w.length > 0 && compact) {
        addToast({
          type: "warning",
          title: "Status saved, with warnings",
          message: w.join("; "),
        });
      }
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
        ref={triggerRef}
        onClick={(e) => {
          // In a queue row the trigger sits inside the row's own click target;
          // stop the row's onSelect from firing when opening the dropdown.
          e.stopPropagation();
          // Measure only on the open transition — the trigger's position is
          // fixed for as long as the menu stays up.
          if (!open && triggerRef.current) {
            setDropUp(shouldDropUp(triggerRef.current));
          }
          setOpen(!open);
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
        // cannot overflow the panel horizontally (matches MultiSelectFilter
        // align="right"); dropUp handles the vertical clip in the queue's
        // scroller for rows in the lower half.
        <div
          role="menu"
          className={`absolute right-0 z-50 max-h-72 w-64 overflow-auto rounded-lg border border-t-border bg-surface shadow-card-lg ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {optionsQuery.isLoading ? (
            <div className="text-muted px-3 py-2 text-xs">Loading options…</div>
          ) : optionsQuery.error ? (
            <div className="px-3 py-2 text-xs text-red-500">
              Could not load status options.
            </div>
          ) : (
            // role="none" strips the implicit list semantics: a role="menu"
            // may only contain menuitems, so an intervening list/listitem
            // makes screen readers announce an empty menu.
            <ul role="none" className="p-1">
              {(optionsQuery.data?.options ?? []).map((opt) => {
                const isCurrent = opt.value === currentStatus;
                const isTerminal = terminalSet.has(opt.value);
                return (
                  <li key={opt.value} role="none">
                    <button
                      type="button"
                      role="menuitem"
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
      {!compact && warnings.length > 0 && (
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
