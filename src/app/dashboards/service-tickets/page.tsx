"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketItem {
  id: string;
  type: "ticket";
  title: string;
  stage: string;
  lastModified: string;
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  priority?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
}

interface TimelineEntry {
  type: "note" | "email" | "call" | "meeting" | "task";
  timestamp: string;
  body: string;
  createdBy?: string | null;
}

interface TicketDetail {
  id: string;
  subject: string;
  content: string;
  priority: string;
  stage: string;
  stageName: string;
  pipeline: string;
  createDate: string;
  lastModified: string;
  lastContactDate: string | null;
  ownerId: string | null;
  location: string | null;
  url: string;
  associations: {
    contacts: Array<{ id: string; name: string; email: string }>;
    deals: Array<{ id: string; name: string; amount: string | null; location: string | null; url: string }>;
    companies: Array<{ id: string; name: string }>;
  };
  timeline: TimelineEntry[];
}

interface TicketListResponse {
  tickets: TicketItem[];
  total: number;
  locations: string[];
  stages: string[];
  stageMap: Record<string, string>;
  owners: Array<{ id: string; name: string }>;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Priority badge config
// ---------------------------------------------------------------------------

const PRIORITY_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  HIGH: { bg: "bg-red-500/20", text: "text-red-400", label: "High" },
  MEDIUM: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Medium" },
  LOW: { bg: "bg-green-500/20", text: "text-green-400", label: "Low" },
  NONE: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "None" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(dateStr: string): number {
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function ageLabel(dateStr: string): string {
  const days = Math.floor(daysSince(dateStr));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ServiceTicketBoardPage() {
  const [data, setData] = useState<TicketListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLocations, setFilterLocations] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [noteText, setNoteText] = useState("");

  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // ---- Data fetching --------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/service/tickets?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: TicketListResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // SSE real-time
  const { connected } = useSSE(fetchData, {
    url: "/api/stream",
    cacheKeyFilter: "service-tickets",
  });

  // Activity tracking
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service-tickets");
    }
  }, [loading, data?.total, trackDashboardView]);

  // ---- Ticket detail --------------------------------------------------------

  const openDetail = useCallback(async (ticketId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`);
      if (!res.ok) throw new Error("Failed to load ticket");
      const json = await res.json();
      setSelectedTicket(json.ticket);
    } catch {
      console.error("[TicketBoard] Failed to load ticket detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ---- Ticket actions -------------------------------------------------------

  const handleStatusChange = useCallback(async (ticketId: string, stageId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) throw new Error("Failed to update ticket");
      await fetchData();
      if (selectedTicket?.id === ticketId) {
        await openDetail(ticketId);
      }
    } catch (err) {
      console.error("[TicketBoard] Status change failed:", err);
    } finally {
      setActionLoading(false);
    }
  }, [fetchData, openDetail, selectedTicket?.id]);

  const handleAddNote = useCallback(async (ticketId: string) => {
    if (!noteText.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      setNoteText("");
      if (selectedTicket?.id === ticketId) {
        await openDetail(ticketId);
      }
    } catch (err) {
      console.error("[TicketBoard] Add note failed:", err);
    } finally {
      setActionLoading(false);
    }
  }, [noteText, openDetail, selectedTicket?.id]);

  const handleAssign = useCallback(async (ticketId: string, ownerId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId }),
      });
      if (!res.ok) throw new Error("Failed to assign ticket");
      await fetchData();
      if (selectedTicket?.id === ticketId) {
        await openDetail(ticketId);
      }
    } catch (err) {
      console.error("[TicketBoard] Assign failed:", err);
    } finally {
      setActionLoading(false);
    }
  }, [fetchData, openDetail, selectedTicket?.id]);

  // ---- Derived data ---------------------------------------------------------

  // All filtering is client-side
  const filteredTickets = useMemo(() => {
    if (!data?.tickets) return [];
    return data.tickets.filter(t => {
      if (filterLocations.length > 0 && (!t.location || !filterLocations.includes(t.location))) return false;
      if (filterStages.length > 0 && !filterStages.includes(t.stage)) return false;
      if (filterPriorities.length > 0 && (!t.priority || !filterPriorities.includes(t.priority))) return false;
      if (filterOwners.length > 0) {
        if (filterOwners.includes("__unassigned__") && !t.ownerId) return true;
        if (t.ownerId && filterOwners.includes(t.ownerId)) return true;
        return false;
      }
      return true;
    });
  }, [data?.tickets, filterLocations, filterStages, filterPriorities, filterOwners]);

  // Unique priorities for filter
  const priorities = [...new Set(
    (data?.tickets ?? []).map(t => t.priority).filter((p): p is string => !!p)
  )];

  // Build filter options
  const locationOptions: FilterOption[] = useMemo(
    () => (data?.locations ?? []).map(l => ({ value: l, label: l })),
    [data?.locations]
  );
  const stageOptions: FilterOption[] = useMemo(
    () => (data?.stages ?? []).map(s => ({ value: s, label: s })),
    [data?.stages]
  );
  const priorityOptions: FilterOption[] = useMemo(
    () => priorities.map(p => ({ value: p, label: PRIORITY_CONFIG[p]?.label ?? p })),
    [priorities]
  );
  const ownerOptions: FilterOption[] = useMemo(
    () => [
      { value: "__unassigned__", label: "Unassigned" },
      ...(data?.owners ?? []).map(o => ({ value: o.id, label: o.name })),
    ],
    [data?.owners]
  );

  // Group tickets by stage for kanban columns
  const stageOrder = data?.stages ?? [];
  const ticketsByStage = new Map<string, TicketItem[]>();
  for (const stage of stageOrder) {
    ticketsByStage.set(stage, []);
  }
  for (const ticket of filteredTickets) {
    const list = ticketsByStage.get(ticket.stage);
    if (list) {
      list.push(ticket);
    } else {
      ticketsByStage.set(ticket.stage, [ticket]);
    }
  }

  // ---- Loading / error states -----------------------------------------------

  if (loading && !data) {
    return (
      <DashboardShell title="Ticket Board" accentColor="cyan">
        <LoadingSpinner color="cyan" message="Loading tickets..." />
      </DashboardShell>
    );
  }

  if (error && !data) {
    return (
      <DashboardShell title="Ticket Board" accentColor="cyan">
        <ErrorState message={error} onRetry={fetchData} color="cyan" />
      </DashboardShell>
    );
  }

  // ---- Header controls ------------------------------------------------------

  const headerRight = (
    <div className="flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-zinc-500"}`}
        title={connected ? "Live" : "Disconnected"}
      />
      <button
        onClick={() => { setLoading(true); fetchData(); }}
        className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
      >
        Refresh
      </button>
    </div>
  );

  // ---- Render ---------------------------------------------------------------

  return (
    <DashboardShell
      title="Ticket Board"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated ?? null}
      headerRight={headerRight}
      fullWidth
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          label="Open Tickets"
          value={data?.total ?? 0}
          color="cyan"
        />
        <StatCard
          label="Filtered"
          value={filteredTickets.length}
          color="blue"
        />
        <StatCard
          label="Locations"
          value={data?.locations.length ?? 0}
          color="purple"
        />
        <StatCard
          label="Stages"
          value={stageOrder.length}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search tickets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted w-64"
        />
        <MultiSelectFilter
          label="Location"
          options={locationOptions}
          selected={filterLocations}
          onChange={setFilterLocations}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Priority"
          options={priorityOptions}
          selected={filterPriorities}
          onChange={setFilterPriorities}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Stage"
          options={stageOptions}
          selected={filterStages}
          onChange={setFilterStages}
          accentColor="cyan"
        />
        <MultiSelectFilter
          label="Owner"
          options={ownerOptions}
          selected={filterOwners}
          onChange={setFilterOwners}
          accentColor="cyan"
        />
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stageOrder
          .filter(stage => filterStages.length === 0 || filterStages.includes(stage))
          .map(stage => {
            const tickets = ticketsByStage.get(stage) ?? [];
            return (
              <div
                key={stage}
                className="flex-shrink-0 w-72 bg-surface rounded-xl border border-t-border"
              >
                {/* Column header */}
                <div className="px-3 py-3 border-b border-t-border">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {stage}
                    </h3>
                    <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">
                      {tickets.length}
                    </span>
                  </div>
                </div>

                {/* Ticket cards */}
                <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                  {tickets.length === 0 ? (
                    <div className="text-xs text-muted text-center py-4">
                      No tickets
                    </div>
                  ) : (
                    tickets.map(ticket => (
                      <button
                        key={ticket.id}
                        onClick={() => openDetail(ticket.id)}
                        className="w-full text-left bg-surface-2 hover:bg-surface-elevated rounded-lg p-3 border border-t-border transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-foreground line-clamp-2 flex-1">
                            {ticket.title}
                          </p>
                          {ticket.priority && PRIORITY_CONFIG[ticket.priority] && (
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_CONFIG[ticket.priority].bg} ${PRIORITY_CONFIG[ticket.priority].text}`}>
                              {PRIORITY_CONFIG[ticket.priority].label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          {ticket.location && (
                            <span>{ticket.location}</span>
                          )}
                          <span>{ageLabel(ticket.createDate)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Detail Panel (slide-over) */}
      {(selectedTicket || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { setSelectedTicket(null); setNoteText(""); }}
          />

          {/* Panel */}
          <div className="relative w-full max-w-lg bg-surface border-l border-t-border overflow-y-auto">
            {detailLoading && !selectedTicket ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner color="cyan" message="Loading ticket..." />
              </div>
            ) : selectedTicket ? (
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-foreground mb-1">
                      {selectedTicket.subject}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>{selectedTicket.stageName}</span>
                      <span className="opacity-40">·</span>
                      <span>{ageLabel(selectedTicket.createDate)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedTicket(null); setNoteText(""); }}
                    className="text-muted hover:text-foreground p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Content */}
                {selectedTicket.content && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Description</h3>
                    <p className="text-sm text-muted whitespace-pre-wrap">
                      {selectedTicket.content}
                    </p>
                  </div>
                )}

                {/* Status change */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Change Status</h3>
                  <select
                    value={selectedTicket.stage}
                    onChange={(e) => handleStatusChange(selectedTicket.id, e.target.value)}
                    disabled={actionLoading}
                    className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground w-full disabled:opacity-50"
                  >
                    {Object.entries(data?.stageMap ?? {}).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Assign to */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Assign To</h3>
                  <select
                    value={selectedTicket.ownerId || ""}
                    onChange={(e) => handleAssign(selectedTicket.id, e.target.value)}
                    disabled={actionLoading}
                    className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground w-full disabled:opacity-50"
                  >
                    <option value="">Unassigned</option>
                    {(data?.owners ?? []).map(owner => (
                      <option key={owner.id} value={owner.id}>{owner.name}</option>
                    ))}
                  </select>
                </div>

                {/* Associations */}
                {selectedTicket.associations.contacts.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Contacts</h3>
                    <div className="space-y-1">
                      {selectedTicket.associations.contacts.map(c => (
                        <div key={c.id} className="text-sm text-muted">
                          {c.name} {c.email && <span className="opacity-60">({c.email})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.associations.deals.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Linked Deals</h3>
                    <div className="space-y-2">
                      {selectedTicket.associations.deals.map(d => (
                        <a
                          key={d.id}
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block bg-surface-2 rounded-lg p-2 text-sm hover:bg-surface-elevated transition-colors"
                        >
                          <span className="text-foreground font-medium">{d.name}</span>
                          {d.amount && <span className="text-muted ml-2">${Number(d.amount).toLocaleString()}</span>}
                          {d.location && <span className="text-muted ml-2">· {d.location}</span>}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.associations.companies.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Companies</h3>
                    <div className="space-y-1">
                      {selectedTicket.associations.companies.map(co => (
                        <div key={co.id} className="text-sm text-muted">{co.name}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                {selectedTicket.timeline.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">
                      Activity Timeline ({selectedTicket.timeline.length})
                    </h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {selectedTicket.timeline.map((entry, idx) => {
                        const typeIcon: Record<string, string> = {
                          note: "\u{1F4DD}", email: "\u{1F4E7}", call: "\u{1F4DE}", meeting: "\u{1F4C5}", task: "\u{2705}",
                        };
                        return (
                          <div key={idx} className="border-l-2 border-t-border pl-3">
                            <div className="flex items-center gap-2 text-xs text-muted mb-1">
                              <span>{typeIcon[entry.type] || "\u{2022}"}</span>
                              <span className="capitalize font-medium">{entry.type}</span>
                              <span className="opacity-40">·</span>
                              <span>{ageLabel(entry.timestamp)}</span>
                            </div>
                            <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap">
                              {entry.body.replace(/<[^>]*>/g, "")}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Add note */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Add Note</h3>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Type a note..."
                    rows={3}
                    className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none"
                  />
                  <button
                    onClick={() => handleAddNote(selectedTicket.id)}
                    disabled={actionLoading || !noteText.trim()}
                    className="mt-2 bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  >
                    {actionLoading ? "Saving..." : "Add Note"}
                  </button>
                </div>

                {/* HubSpot link */}
                <a
                  href={selectedTicket.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300"
                >
                  Open in HubSpot
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
