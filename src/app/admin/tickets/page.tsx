"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, FilterChip, FilterSearch } from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";
import { FormTextarea } from "@/components/admin-shell/AdminForm";
import { FormSelect } from "@/components/admin-shell/AdminForm";

// ── Types ─────────────────────────────────────────────────────────────────

interface BugReport {
  id: string;
  type: "BUG" | "FEATURE_REQUEST";
  title: string;
  description: string;
  pageUrl: string | null;
  reporterEmail: string;
  reporterName: string | null;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  adminNotes: string | null;
  emailSent: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  OPEN: { label: "Open", bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/20" },
  IN_PROGRESS: { label: "In Progress", bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/20" },
  RESOLVED: { label: "Resolved", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/20" },
  CLOSED: { label: "Closed", bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/20" },
};

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
] as const;

const TYPE_TABS = [
  { key: "", label: "All types" },
  { key: "BUG", label: "Bugs" },
  { key: "FEATURE_REQUEST", label: "Features" },
] as const;

const TYPE_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  BUG: { label: "Bug", bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/20" },
  FEATURE_REQUEST: { label: "Feature", bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/20" },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtRelative(ds: string): string {
  const diff = Date.now() - new Date(ds).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ds).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(ds: string): string {
  return new Date(ds).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function StatusPill({ status }: { status: string }) {
  const sc = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase border ${sc.bg} ${sc.text} ${sc.border}`}>
      {sc.label}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const tc = TYPE_CONFIG[type] ?? TYPE_CONFIG.BUG;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase border ${tc.bg} ${tc.text} ${tc.border}`}>
      {tc.label}
    </span>
  );
}

// ── Table columns ─────────────────────────────────────────────────────────

const COLUMNS: AdminTableColumn<BugReport>[] = [
  {
    key: "type", label: "Type", width: "w-24",
    render: (r) => <TypePill type={r.type} />,
  },
  {
    key: "status", label: "Status", width: "w-28",
    render: (r) => <StatusPill status={r.status} />,
  },
  {
    key: "title", label: "Title",
    render: (r) => (
      <div>
        <div className="text-xs font-medium text-foreground truncate max-w-xs">{r.title}</div>
        <div className="text-[10px] text-muted truncate max-w-xs">
          {r.reporterName || r.reporterEmail}
          {r.pageUrl && <span className="ml-1 opacity-60">{new URL(r.pageUrl).pathname}</span>}
        </div>
      </div>
    ),
  },
  {
    key: "reporter", label: "Reporter", width: "w-44",
    render: (r) => <span className="text-xs text-muted truncate block max-w-[168px]">{r.reporterEmail}</span>,
  },
  {
    key: "createdAt", label: "Created", width: "w-28",
    render: (r) => <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.createdAt)}</span>,
  },
];

// ── Drawer body ───────────────────────────────────────────────────────────

function TicketDrawerBody({
  ticket,
  onStatusChange,
  onNotesSave,
  updating,
}: {
  ticket: BugReport;
  onStatusChange: (id: string, status: string) => Promise<void>;
  onNotesSave: (id: string, notes: string) => Promise<void>;
  updating: boolean;
}) {
  const [editNotes, setEditNotes] = useState(ticket.adminNotes ?? "");
  const [editStatus, setEditStatus] = useState(ticket.status);

  // Sync when ticket prop changes (different ticket selected)
  const prevIdRef = useRef(ticket.id);
  if (prevIdRef.current !== ticket.id) {
    prevIdRef.current = ticket.id;
    setEditNotes(ticket.adminNotes ?? "");
    setEditStatus(ticket.status);
  }

  const kvItems = [
    { label: "Type", value: <TypePill type={ticket.type} /> },
    { label: "Reporter", value: ticket.reporterName ? `${ticket.reporterName} (${ticket.reporterEmail})` : ticket.reporterEmail },
    { label: "Page URL", value: ticket.pageUrl
      ? <a href={ticket.pageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all">{ticket.pageUrl}</a>
      : "—"
    },
    { label: "Email sent", value: ticket.emailSent ? "Yes" : "No" },
    { label: "Created", value: fmtDateTime(ticket.createdAt) },
    { label: "Updated", value: fmtDateTime(ticket.updatedAt) },
    { label: "ID", value: ticket.id, mono: true },
  ];

  const notesChanged = editNotes !== (ticket.adminNotes ?? "");

  return (
    <div className="space-y-5">
      <AdminDetailHeader
        title={ticket.title}
        subtitle={`Submitted ${fmtDateTime(ticket.createdAt)}`}
      />

      <AdminKeyValueGrid items={kvItems} />

      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Description</p>
        <pre className="rounded-md bg-surface-2 p-3 text-xs text-foreground whitespace-pre-wrap overflow-x-auto">{ticket.description}</pre>
      </div>

      <FormSelect
        label="Status"
        value={editStatus}
        options={STATUS_OPTIONS}
        onChange={async (v) => {
          setEditStatus(v as BugReport["status"]);
          await onStatusChange(ticket.id, v);
        }}
      />

      <FormTextarea
        label="Admin Notes"
        value={editNotes}
        onChange={setEditNotes}
        placeholder="Internal notes (not visible to reporter)"
        rows={3}
        help="Only visible to admins"
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onNotesSave(ticket.id, editNotes)}
          disabled={updating || !notesChanged}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg transition-colors"
        >
          {updating ? "Saving…" : "Save Notes"}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();

  const [tickets, setTickets] = useState<BugReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<BugReport | null>(null);
  const [updating, setUpdating] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      params.set("limit", "100");
      const res = await fetch(`/api/admin/tickets?${params}`);
      if (res.status === 403) { router.push("/"); return; }
      const data = await res.json();
      setTickets(data.tickets || []);
      setTotal(data.total || 0);
    } catch {
      addToast({ type: "error", title: "Failed to load tickets" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, router, addToast]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Deep-link: ?ticketId=<id> opens drawer on load
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !tickets.length) return;
    const id = searchParams.get("ticketId");
    if (id) { deepLinked.current = true; const t = tickets.find((x) => x.id === id); if (t) setSelected(t); }
  }, [tickets, searchParams]);

  // ── Mutations ─────────────────────────────────────────────────
  const handleStatusChange = useCallback(async (ticketId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, status: newStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast({ type: "success", title: "Status updated", message: `Set to ${STATUS_CONFIG[newStatus]?.label ?? newStatus}` });
        setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: newStatus as BugReport["status"] } : t));
        setSelected((prev) => prev?.id === ticketId ? { ...prev, status: newStatus as BugReport["status"] } : prev);
      } else {
        addToast({ type: "error", title: "Update failed", message: data.error });
      }
    } catch {
      addToast({ type: "error", title: "Network error" });
    } finally {
      setUpdating(false);
    }
  }, [addToast]);

  const handleNotesSave = useCallback(async (ticketId: string, adminNotes: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, adminNotes }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast({ type: "success", title: "Notes saved" });
        setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, adminNotes } : t));
        setSelected((prev) => prev?.id === ticketId ? { ...prev, adminNotes } : prev);
      } else {
        addToast({ type: "error", title: "Save failed", message: data.error });
      }
    } catch {
      addToast({ type: "error", title: "Network error" });
    } finally {
      setUpdating(false);
    }
  }, [addToast]);

  // ── Derived ───────────────────────────────────────────────────
  const visibleTickets = searchQuery.trim()
    ? tickets.filter((t) => {
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      })
    : tickets;

  const hasActiveFilters = !!statusFilter || !!typeFilter || !!searchQuery;
  const clearAll = () => { setStatusFilter(""); setTypeFilter(""); setSearchQuery(""); };

  return (
    <div>
      <AdminPageHeader
        title="Feedback Tickets"
        breadcrumb={["Admin", "Operations", "Tickets"]}
        subtitle={`${total.toLocaleString()} total submissions`}
      />

      <div className="mb-4 space-y-2">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          {STATUS_TABS.map((tab) => (
            <FilterChip
              key={tab.key}
              active={statusFilter === tab.key}
              onClick={() => setStatusFilter(tab.key)}
              label={tab.label}
            >
              {tab.label}
            </FilterChip>
          ))}
          <FilterSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search title / description…"
            widthClass="w-52"
          />
        </AdminFilterBar>
        <AdminFilterBar>
          {TYPE_TABS.map((tab) => (
            <FilterChip
              key={tab.key}
              active={typeFilter === tab.key}
              onClick={() => setTypeFilter(tab.key)}
              label={tab.label}
            >
              {tab.label}
            </FilterChip>
          ))}
        </AdminFilterBar>
      </div>

      <AdminTable
        caption="Feedback submissions"
        rows={visibleTickets}
        rowKey={(r) => r.id}
        columns={COLUMNS}
        loading={loading}
        empty={
          <AdminEmpty
            label={statusFilter ? `No ${STATUS_CONFIG[statusFilter]?.label ?? statusFilter} tickets` : "No submissions yet"}
            description="Bug reports and feature requests submitted by users will appear here."
          />
        }
        onRowClick={setSelected}
      />

      <AdminDetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <div className="flex items-center gap-2">
              <TypePill type={selected.type} />
              <StatusPill status={selected.status} />
            </div>
          ) : null
        }
        wide
      >
        {selected && (
          <TicketDrawerBody
            key={selected.id}
            ticket={selected}
            onStatusChange={handleStatusChange}
            onNotesSave={handleNotesSave}
            updating={updating}
          />
        )}
      </AdminDetailDrawer>
    </div>
  );
}
