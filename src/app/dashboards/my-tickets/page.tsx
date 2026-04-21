"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import {
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
  type FreshserviceTicket,
} from "@/lib/freshservice";

interface ListResponse {
  tickets: FreshserviceTicket[];
  lastUpdated: string;
  requesterFound: boolean;
}

const STATUS_PILL: Record<number, string> = {
  2: "bg-red-500/15 text-red-400 border-red-500/20",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  4: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  5: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

const PRIORITY_PILL: Record<number, string> = {
  1: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  2: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  4: "bg-red-500/15 text-red-400 border-red-500/20",
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusPill({ status }: { status: number }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${STATUS_PILL[status] ?? ""}`}>
      {FRESHSERVICE_STATUS_LABELS[status] ?? String(status)}
    </span>
  );
}

function PriorityPill({ priority }: { priority: number }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${PRIORITY_PILL[priority] ?? ""}`}>
      {FRESHSERVICE_PRIORITY_LABELS[priority] ?? String(priority)}
    </span>
  );
}

type StatusKey = "all" | "open" | "pending" | "resolved" | "closed";

const FILTERS: { key: StatusKey; label: string; matches: (s: number) => boolean }[] = [
  { key: "all", label: "All", matches: () => true },
  { key: "open", label: "Open", matches: (s) => s === 2 },
  { key: "pending", label: "Pending", matches: (s) => s === 3 },
  { key: "resolved", label: "Resolved", matches: (s) => s === 4 },
  { key: "closed", label: "Closed", matches: (s) => s === 5 },
];

export default function MyTicketsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusKey>("open");
  const [selected, setSelected] = useState<FreshserviceTicket | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.freshservice.tickets(),
    queryFn: async (): Promise<ListResponse> => {
      const r = await fetch("/api/freshservice/my-tickets");
      if (!r.ok) throw new Error(`failed: ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const tickets = data?.tickets ?? [];
  const counts: Record<StatusKey, number> = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 2).length,
    pending: tickets.filter((t) => t.status === 3).length,
    resolved: tickets.filter((t) => t.status === 4).length,
    closed: tickets.filter((t) => t.status === 5).length,
  };
  const active = FILTERS.find((f) => f.key === statusFilter) ?? FILTERS[0];
  const filtered = tickets.filter((t) => active.matches(t.status));

  return (
    <DashboardShell
      title="My Tickets"
      accentColor="orange"
      lastUpdated={data?.lastUpdated}
      headerRight={
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.freshservice.root })}
          className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      }
    >
      {isError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center">
          <p className="text-sm font-medium text-red-400">Couldn&apos;t load Freshservice tickets.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-t-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
          Loading…
        </div>
      ) : data && !data.requesterFound ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-foreground">No Freshservice account linked</p>
          <p className="mt-1 text-xs text-muted">
            We couldn&apos;t find a Freshservice requester record for your email. File a ticket from{" "}
            <a
              href="https://photonbrothers.freshservice.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300"
            >
              the Freshservice portal
            </a>{" "}
            and your account will be created automatically.
          </p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-foreground">No tickets you&apos;ve filed 🎉</p>
          <p className="mt-1 text-xs text-muted">
            File a new one at{" "}
            <a
              href="https://photonbrothers.freshservice.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:text-orange-300"
            >
              photonbrothers.freshservice.com
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-t-border/60 bg-surface p-3">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                aria-pressed={statusFilter === f.key}
                className={`rounded-md border border-t-border/60 px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? "bg-surface-elevated text-foreground"
                    : "bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                {f.label} ({counts[f.key]})
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-t-border/60 bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-t-border/60 bg-surface-2 text-left text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Priority</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border/60">
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted">#{t.id}</td>
                    <td className="px-3 py-2 text-foreground">{t.subject}</td>
                    <td className="px-3 py-2"><StatusPill status={t.status} /></td>
                    <td className="px-3 py-2"><PriorityPill priority={t.priority} /></td>
                    <td className="px-3 py-2 text-muted">{relative(t.created_at)}</td>
                    <td className="px-3 py-2 text-muted">{relative(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex"
          onClick={() => setSelected(null)}
        >
          <div className="ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-t-border bg-surface-elevated p-6 shadow-card-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">{selected.subject}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <StatusPill status={selected.status} />
                  <PriorityPill priority={selected.priority} />
                  <span className="text-muted">#{selected.id}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md border border-t-border bg-surface-2 px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-xs uppercase tracking-wider text-muted">Created</dt>
              <dd className="text-foreground">{relative(selected.created_at)}</dd>
              <dt className="text-xs uppercase tracking-wider text-muted">Updated</dt>
              <dd className="text-foreground">{relative(selected.updated_at)}</dd>
              <dt className="text-xs uppercase tracking-wider text-muted">Type</dt>
              <dd className="text-foreground">{selected.type ?? "—"}</dd>
              <dt className="text-xs uppercase tracking-wider text-muted">Category</dt>
              <dd className="text-foreground">{selected.category ?? "—"}</dd>
            </dl>
            {selected.description_text && (
              <div className="mt-4 whitespace-pre-wrap rounded-lg border border-t-border bg-surface p-4 text-sm text-foreground">
                {selected.description_text}
              </div>
            )}
            <a
              href={`https://photonbrothers.freshservice.com/support/tickets/${selected.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block text-sm text-orange-400 hover:text-orange-300"
            >
              View in Freshservice →
            </a>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
