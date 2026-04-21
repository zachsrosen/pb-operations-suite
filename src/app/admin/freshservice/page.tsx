"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, FilterChip } from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import { queryKeys } from "@/lib/query-keys";
import {
  FRESHSERVICE_STATUS_LABELS,
  FRESHSERVICE_PRIORITY_LABELS,
  type FreshserviceTicket,
} from "@/lib/freshservice";

interface ListResponse {
  tickets: FreshserviceTicket[];
  lastUpdated: string;
  agentFound: boolean;
}

const STATUS_PILL: Record<number, string> = {
  2: "bg-red-500/15 text-red-400 border-red-500/20",
  3: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  4: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
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

function dueRelative(iso: string | null): { text: string; overdue: boolean } {
  if (!iso) return { text: "", overdue: false };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { text: "", overdue: false };
  const diffMins = Math.floor((d.getTime() - Date.now()) / 60_000);
  const overdue = diffMins < 0;
  const absMins = Math.abs(diffMins);
  if (absMins < 60) return { text: `${absMins}m ${overdue ? "overdue" : "left"}`, overdue };
  const hrs = Math.floor(absMins / 60);
  if (hrs < 24) return { text: `${hrs}h ${overdue ? "overdue" : "left"}`, overdue };
  const days = Math.floor(hrs / 24);
  return { text: `${days}d ${overdue ? "overdue" : "left"}`, overdue };
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

export default function FreshserviceTicketsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "pending" | "resolved">("all");
  const [selected, setSelected] = useState<FreshserviceTicket | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.freshservice.tickets(),
    queryFn: async (): Promise<ListResponse> => {
      const r = await fetch("/api/admin/freshservice/tickets");
      if (!r.ok) throw new Error(`failed: ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const tickets = data?.tickets ?? [];
  const counts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 2).length,
    pending: tickets.filter((t) => t.status === 3).length,
    resolved: tickets.filter((t) => t.status === 4).length,
  };
  const filtered = tickets.filter((t) => {
    if (statusFilter === "open") return t.status === 2;
    if (statusFilter === "pending") return t.status === 3;
    if (statusFilter === "resolved") return t.status === 4;
    return true;
  });

  const columns: AdminTableColumn<FreshserviceTicket>[] = [
    { key: "id", label: "ID", render: (t) => <span className="font-mono text-xs text-muted">#{t.id}</span>, width: "w-20" },
    { key: "subject", label: "Subject", render: (t) => <span className="truncate">{t.subject}</span> },
    { key: "status", label: "Status", render: (t) => <StatusPill status={t.status} />, width: "w-28" },
    { key: "priority", label: "Priority", render: (t) => <PriorityPill priority={t.priority} />, width: "w-24" },
    { key: "created", label: "Created", render: (t) => relative(t.created_at), width: "w-24" },
    {
      key: "due",
      label: "Due",
      render: (t) => {
        const d = dueRelative(t.due_by);
        return <span className={d.overdue ? "text-red-400" : ""}>{d.text}</span>;
      },
      width: "w-28",
    },
  ];

  const refreshBtn = (
    <button
      type="button"
      onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.freshservice.root })}
      className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
    >
      Refresh
    </button>
  );

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Freshservice Tickets"
        breadcrumb={["Admin", "Freshservice"]}
        subtitle="Your open tickets on photonbrothers.freshservice.com."
        actions={refreshBtn}
      />

      {isError ? (
        <AdminError error="Couldn't load Freshservice tickets." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">Loading…</div>
      ) : data && !data.agentFound ? (
        <AdminEmpty
          label="No Freshservice agent linked"
          description="We couldn't find a Freshservice agent record for your email. Ask an admin to check your Freshservice account."
        />
      ) : tickets.length === 0 ? (
        <AdminEmpty
          label="No open tickets 🎉"
          description="Nothing pending on photonbrothers.freshservice.com."
        />
      ) : (
        <>
          <AdminFilterBar>
            <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All ({counts.all})</FilterChip>
            <FilterChip active={statusFilter === "open"} onClick={() => setStatusFilter("open")}>Open ({counts.open})</FilterChip>
            <FilterChip active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>Pending ({counts.pending})</FilterChip>
            <FilterChip active={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")}>Resolved ({counts.resolved})</FilterChip>
          </AdminFilterBar>

          <AdminTable
            rows={filtered}
            rowKey={(t) => String(t.id)}
            columns={columns}
            caption="Your Freshservice tickets"
            onRowClick={setSelected}
          />
        </>
      )}

      <AdminDetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? selected.subject : ""}
      >
        {selected && (
          <div className="space-y-4">
            <AdminDetailHeader
              title={selected.subject}
              subtitle={
                <span className="flex items-center gap-2">
                  <StatusPill status={selected.status} />
                  <PriorityPill priority={selected.priority} />
                  <span className="text-muted">#{selected.id}</span>
                </span>
              }
            />
            <AdminKeyValueGrid
              items={[
                { label: "Status", value: FRESHSERVICE_STATUS_LABELS[selected.status] ?? String(selected.status) },
                { label: "Priority", value: FRESHSERVICE_PRIORITY_LABELS[selected.priority] ?? String(selected.priority) },
                { label: "Created", value: relative(selected.created_at) },
                { label: "Updated", value: relative(selected.updated_at) },
                { label: "Due", value: dueRelative(selected.due_by).text || "—" },
                { label: "Type", value: selected.type ?? "—" },
                { label: "Category", value: selected.category ?? "—" },
              ]}
            />
            {selected.description_text && (
              <div className="whitespace-pre-wrap rounded-lg border border-t-border bg-surface p-4 text-sm text-foreground">
                {selected.description_text}
              </div>
            )}
            <a
              href={`https://photonbrothers.freshservice.com/a/tickets/${selected.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-orange-400 hover:text-orange-300"
            >
              View in Freshservice →
            </a>
          </div>
        )}
      </AdminDetailDrawer>
    </div>
  );
}
