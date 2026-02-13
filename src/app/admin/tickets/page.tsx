"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/contexts/ToastContext";

interface BugReport {
  id: string;
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

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  OPEN: { label: "Open", bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/20" },
  IN_PROGRESS: { label: "In Progress", bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/20" },
  RESOLVED: { label: "Resolved", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/20" },
  CLOSED: { label: "Closed", bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/20" },
};

export default function AdminTicketsPage() {
  const router = useRouter();
  const { addToast } = useToast();

  const [tickets, setTickets] = useState<BugReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedTicket, setSelectedTicket] = useState<BugReport | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "100");

      const res = await fetch(`/api/admin/tickets?${params}`);
      if (res.status === 403) {
        router.push("/");
        return;
      }
      const data = await res.json();
      setTickets(data.tickets || []);
      setTotal(data.total || 0);
    } catch {
      addToast({ type: "error", title: "Failed to load tickets" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, router, addToast]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleStatusUpdate = async (ticketId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, status: newStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast({ type: "success", title: "Status updated", message: `Ticket set to ${STATUS_CONFIG[newStatus]?.label || newStatus}` });
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus as BugReport["status"] } : t))
        );
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket((prev) => prev ? { ...prev, status: newStatus as BugReport["status"] } : null);
        }
      } else {
        addToast({ type: "error", title: "Update failed", message: data.error });
      }
    } catch {
      addToast({ type: "error", title: "Network error" });
    } finally {
      setUpdating(false);
    }
  };

  const handleNotesUpdate = async () => {
    if (!selectedTicket) return;
    setUpdating(true);
    try {
      const res = await fetch("/api/admin/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: selectedTicket.id, adminNotes: editNotes }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        addToast({ type: "success", title: "Notes saved" });
        setTickets((prev) =>
          prev.map((t) => (t.id === selectedTicket.id ? { ...t, adminNotes: editNotes } : t))
        );
        setSelectedTicket((prev) => prev ? { ...prev, adminNotes: editNotes } : null);
      } else {
        addToast({ type: "error", title: "Save failed", message: data.error });
      }
    } catch {
      addToast({ type: "error", title: "Network error" });
    } finally {
      setUpdating(false);
    }
  };

  const openDetail = (ticket: BugReport) => {
    setSelectedTicket(ticket);
    setEditNotes(ticket.adminNotes || "");
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const statusCounts = {
    all: total,
    OPEN: tickets.filter((t) => t.status === "OPEN").length,
    IN_PROGRESS: tickets.filter((t) => t.status === "IN_PROGRESS").length,
    RESOLVED: tickets.filter((t) => t.status === "RESOLVED").length,
    CLOSED: tickets.filter((t) => t.status === "CLOSED").length,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-t-border bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => router.push("/suites/admin")}
              className="text-muted hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-foreground">Bug Reports</h1>
              <p className="text-xs text-muted">User-submitted bug reports and feature issues</p>
            </div>
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-1">
            {[
              { key: "", label: "All", count: statusCounts.all },
              { key: "OPEN", label: "Open", count: statusCounts.OPEN },
              { key: "IN_PROGRESS", label: "In Progress", count: statusCounts.IN_PROGRESS },
              { key: "RESOLVED", label: "Resolved", count: statusCounts.RESOLVED },
              { key: "CLOSED", label: "Closed", count: statusCounts.CLOSED },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  statusFilter === tab.key
                    ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                    : "text-muted hover:text-foreground hover:bg-surface-2 border border-transparent"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-[0.6rem] opacity-60">({tab.count})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-xl bg-surface-2 border border-t-border flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-muted">No bug reports {statusFilter ? `with status "${STATUS_CONFIG[statusFilter]?.label}"` : "yet"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((ticket) => {
              const sc = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
              return (
                <div
                  key={ticket.id}
                  onClick={() => openDetail(ticket)}
                  className="group flex items-center gap-4 px-4 py-3 bg-surface border border-t-border rounded-lg hover:border-orange-500/30 transition-colors cursor-pointer"
                >
                  {/* Status badge */}
                  <span className={`shrink-0 px-2 py-0.5 text-[0.6rem] font-semibold uppercase rounded ${sc.bg} ${sc.text} ${sc.border} border`}>
                    {sc.label}
                  </span>

                  {/* Title + reporter */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-orange-400 transition-colors">
                      {ticket.title}
                    </div>
                    <div className="text-[0.65rem] text-muted truncate">
                      {ticket.reporterName || ticket.reporterEmail} &middot; {formatDate(ticket.createdAt)}
                      {ticket.pageUrl && (
                        <span className="ml-2 text-muted/50">{new URL(ticket.pageUrl).pathname}</span>
                      )}
                    </div>
                  </div>

                  {/* Email status */}
                  <div className="shrink-0">
                    {ticket.emailSent ? (
                      <span className="text-[0.6rem] text-emerald-400/60" title="Email sent to techops">
                        Emailed
                      </span>
                    ) : (
                      <span className="text-[0.6rem] text-red-400/60" title="Email not sent">
                        No email
                      </span>
                    )}
                  </div>

                  {/* Arrow */}
                  <svg className="w-3.5 h-3.5 text-muted/40 group-hover:text-orange-400/60 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedTicket && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedTicket(null);
          }}
        >
          <div className="bg-surface border border-t-border rounded-xl shadow-card-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-t-border">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-2">
                  {(() => {
                    const sc = STATUS_CONFIG[selectedTicket.status] || STATUS_CONFIG.OPEN;
                    return (
                      <span className={`px-2 py-0.5 text-[0.6rem] font-semibold uppercase rounded ${sc.bg} ${sc.text} ${sc.border} border`}>
                        {sc.label}
                      </span>
                    );
                  })()}
                  <span className="text-[0.6rem] text-muted font-mono">{selectedTicket.id}</span>
                </div>
                <h2 className="text-base font-bold text-foreground">{selectedTicket.title}</h2>
                <p className="text-xs text-muted mt-1">
                  {selectedTicket.reporterName || selectedTicket.reporterEmail} &middot; {formatDateTime(selectedTicket.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                className="text-muted hover:text-foreground transition-colors p-1 shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Description</h4>
                <div className="bg-background border border-t-border rounded-lg p-4 text-sm text-foreground whitespace-pre-wrap">
                  {selectedTicket.description}
                </div>
              </div>

              {/* Page URL */}
              {selectedTicket.pageUrl && (
                <div>
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Page</h4>
                  <a
                    href={selectedTicket.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
                  >
                    {selectedTicket.pageUrl}
                  </a>
                </div>
              )}

              {/* Status actions */}
              <div>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Update Status</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const).map((s) => {
                    const sc = STATUS_CONFIG[s];
                    const isActive = selectedTicket.status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => !isActive && handleStatusUpdate(selectedTicket.id, s)}
                        disabled={isActive || updating}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          isActive
                            ? `${sc.bg} ${sc.text} ${sc.border} cursor-default`
                            : "text-muted border-t-border hover:text-foreground hover:bg-surface-2"
                        }`}
                      >
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin notes */}
              <div>
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Admin Notes</h4>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal notes about this bug (not visible to reporter)"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-t-border rounded-lg text-foreground placeholder:text-muted/50 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-colors resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleNotesUpdate}
                    disabled={updating || editNotes === (selectedTicket.adminNotes || "")}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800 disabled:text-white/50 rounded-lg transition-colors"
                  >
                    {updating ? "Saving..." : "Save Notes"}
                  </button>
                </div>
              </div>

              {/* Meta info */}
              <div className="flex items-center gap-4 text-[0.6rem] text-muted/60 pt-2 border-t border-t-border">
                <span>Reporter: {selectedTicket.reporterEmail}</span>
                <span>Email: {selectedTicket.emailSent ? "Sent" : "Not sent"}</span>
                <span>Updated: {formatDateTime(selectedTicket.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
