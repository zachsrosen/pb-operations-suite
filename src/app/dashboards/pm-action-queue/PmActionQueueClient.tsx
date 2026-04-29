"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import DashboardShell from "@/components/DashboardShell";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

type Tab = "mine" | "all" | "unassigned";

interface UserRef { id: string; email: string; name: string | null }

interface FlagEvent {
  id: string;
  eventType: string;
  actorUserId: string | null;
  notes: string | null;
  metadata: unknown;
  createdAt: string;
}

interface Flag {
  id: string;
  hubspotDealId: string;
  dealName: string | null;
  type: string;
  severity: string;
  status: string;
  reason: string;
  source: string;
  raisedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolvedNotes: string | null;
  assignedToUser: UserRef | null;
  raisedByUser: UserRef | null;
  resolvedByUser: UserRef | null;
  events: FlagEvent[];
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_OPTIONS = [
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH",     label: "High" },
  { value: "MEDIUM",   label: "Medium" },
  { value: "LOW",      label: "Low" },
];
const STATUS_OPTIONS = [
  { value: "OPEN",         label: "Open" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "RESOLVED",     label: "Resolved" },
  { value: "CANCELLED",    label: "Cancelled" },
];
const TYPE_OPTIONS = [
  "STAGE_STUCK",
  "MILESTONE_OVERDUE",
  "CUSTOMER_COMPLAINT",
  "MISSING_DATA",
  "CHANGE_ORDER",
  "INSTALL_BLOCKED",
  "PERMIT_ISSUE",
  "INTERCONNECT_ISSUE",
  "DESIGN_ISSUE",
  "PAYMENT_ISSUE",
  "OTHER",
].map(v => ({ value: v, label: humanize(v) }));

function humanize(v: string): string {
  return v.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function severityBadge(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "bg-red-500/20 text-red-300 border-red-500/40";
    case "HIGH":     return "bg-orange-500/20 text-orange-300 border-orange-500/40";
    case "MEDIUM":   return "bg-yellow-500/20 text-yellow-300 border-yellow-500/40";
    case "LOW":      return "bg-sky-500/20 text-sky-300 border-sky-500/40";
    default:         return "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "OPEN":         return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "ACKNOWLEDGED": return "bg-blue-500/15 text-blue-300 border-blue-500/30";
    case "RESOLVED":     return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "CANCELLED":    return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:             return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

function hubspotDealUrl(dealId: string): string {
  const portal = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21710069";
  return `https://app.hubspot.com/contacts/${portal}/record/0-3/${dealId}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function PmActionQueueClient({ isAdminLike }: { isAdminLike: boolean }) {
  const search = useSearchParams();
  const initialFlagId = search?.get("flag") ?? null;

  const [tab, setTab] = useState<Tab>("mine");
  const [statusFilter, setStatusFilter] = useState<string[]>(["OPEN", "ACKNOWLEDGED"]);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialFlagId);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("scope", tab);
      for (const s of statusFilter) params.append("status", s);
      for (const s of severityFilter) params.append("severity", s);
      for (const t of typeFilter) params.append("type", t);
      const res = await fetch(`/api/pm-flags?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { flags: Flag[] };
      setFlags(data.flags);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter, severityFilter, typeFilter]);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const sortedFlags = useMemo(() => {
    return [...flags].sort((a, b) => {
      const sevA = SEVERITY_ORDER[a.severity] ?? 99;
      const sevB = SEVERITY_ORDER[b.severity] ?? 99;
      if (sevA !== sevB) return sevA - sevB;
      return new Date(b.raisedAt).getTime() - new Date(a.raisedAt).getTime();
    });
  }, [flags]);

  const selected = useMemo(
    () => flags.find(f => f.id === selectedId) ?? null,
    [flags, selectedId]
  );

  const counts = useMemo(() => {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, OPEN: 0, ACKNOWLEDGED: 0 };
    for (const f of flags) {
      if (f.severity in c) (c as Record<string, number>)[f.severity]++;
      if (f.status in c) (c as Record<string, number>)[f.status]++;
    }
    return c;
  }, [flags]);

  return (
    <DashboardShell
      title="PM Action Queue"
      accentColor="orange"
      lastUpdated={lastUpdated}
    >
      {/* Counters row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Counter label="Critical"     value={counts.CRITICAL}     accent="red" />
        <Counter label="High"         value={counts.HIGH}         accent="orange" />
        <Counter label="Medium"       value={counts.MEDIUM}       accent="yellow" />
        <Counter label="Low"          value={counts.LOW}          accent="sky" />
        <Counter label="Open"         value={counts.OPEN}         accent="amber" />
        <Counter label="Acknowledged" value={counts.ACKNOWLEDGED} accent="blue" />
      </div>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-t-border bg-surface p-1">
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>Mine</TabButton>
          {isAdminLike && <TabButton active={tab === "unassigned"} onClick={() => setTab("unassigned")}>Unassigned</TabButton>}
          {isAdminLike && <TabButton active={tab === "all"} onClick={() => setTab("all")}>All</TabButton>}
        </div>

        <MultiSelectFilter
          label="Status"
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
        />
        <MultiSelectFilter
          label="Severity"
          options={SEVERITY_OPTIONS}
          selected={severityFilter}
          onChange={setSeverityFilter}
          placeholder="All severities"
        />
        <MultiSelectFilter
          label="Type"
          options={TYPE_OPTIONS}
          selected={typeFilter}
          onChange={setTypeFilter}
          placeholder="All types"
        />

        <button
          onClick={() => void fetchFlags()}
          className="ml-auto px-3 py-1.5 text-sm rounded-md bg-surface hover:bg-surface-2 border border-t-border text-foreground"
        >
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-muted">Loading flags…</div>
      ) : sortedFlags.length === 0 ? (
        <div className="p-12 text-center bg-surface rounded-lg border border-t-border">
          <p className="text-foreground text-lg mb-1">All clear</p>
          <p className="text-muted text-sm">
            {tab === "mine" ? "You have no flags assigned." : "No flags match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedFlags.map(f => (
            <FlagCard key={f.id} flag={f} onClick={() => setSelectedId(f.id)} />
          ))}
        </div>
      )}

      {/* Drawer */}
      {selected && (
        <FlagDrawer
          flag={selected}
          isAdminLike={isAdminLike}
          onClose={() => setSelectedId(null)}
          onMutated={async () => {
            await fetchFlags();
          }}
        />
      )}
    </DashboardShell>
  );
}

function Counter({ label, value, accent }: { label: string; value: number; accent: string }) {
  const ring: Record<string, string> = {
    red: "ring-red-500/30",
    orange: "ring-orange-500/30",
    yellow: "ring-yellow-500/30",
    sky: "ring-sky-500/30",
    amber: "ring-amber-500/30",
    blue: "ring-blue-500/30",
  };
  return (
    <div className={`bg-surface rounded-lg p-3 ring-1 ${ring[accent] ?? "ring-zinc-500/30"} border border-t-border`}>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        active ? "bg-orange-500 text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FlagCard({ flag, onClick }: { flag: Flag; onClick: () => void }) {
  const dealLabel = flag.dealName ?? `Deal ${flag.hubspotDealId}`;
  // Outer container is a div (not button) so we can nest a link without
  // violating HTML interactive-element rules. Click anywhere except the
  // HubSpot link opens the drawer.
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full text-left bg-surface hover:bg-surface-2 transition-colors rounded-lg border border-t-border p-4 flex items-start gap-4 cursor-pointer"
    >
      <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${severityBadge(flag.severity)} shrink-0 mt-0.5`}>
        {flag.severity}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-foreground truncate">{dealLabel}</span>
          <a
            href={hubspotDealUrl(flag.hubspotDealId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline"
            title="Open in HubSpot"
          >
            ↗ HubSpot
          </a>
          <span className="text-xs text-muted">{humanize(flag.type)}</span>
        </div>
        <p className="text-sm text-muted mt-1 line-clamp-2">{flag.reason}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted">
          <span className={`px-2 py-0.5 rounded border ${statusBadge(flag.status)}`}>{flag.status}</span>
          <span>{timeAgo(flag.raisedAt)}</span>
          {flag.assignedToUser && <span>→ {flag.assignedToUser.name ?? flag.assignedToUser.email}</span>}
          {flag.raisedByUser && <span>by {flag.raisedByUser.name ?? flag.raisedByUser.email}</span>}
        </div>
      </div>
    </div>
  );
}

function FlagDrawer({
  flag,
  isAdminLike,
  onClose,
  onMutated,
}: {
  flag: Flag;
  isAdminLike: boolean;
  onClose: () => void;
  onMutated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [noteText, setNoteText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const isOpen = flag.status === "OPEN";
  const isAcknowledged = flag.status === "ACKNOWLEDGED";
  const isClosed = flag.status === "RESOLVED" || flag.status === "CANCELLED";

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status}`);
      }
      await onMutated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative ml-auto h-full w-full max-w-xl bg-surface-elevated border-l border-t-border overflow-y-auto">
        <div className="p-5 border-b border-t-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${severityBadge(flag.severity)}`}>{flag.severity}</span>
              <span className={`px-2 py-0.5 text-xs rounded border ${statusBadge(flag.status)}`}>{flag.status}</span>
              <span className="text-xs text-muted">{flag.source}</span>
            </div>
            <h2 className="text-lg font-semibold text-foreground truncate">
              {flag.dealName ?? `Deal ${flag.hubspotDealId}`}
            </h2>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-sm text-muted">{humanize(flag.type)}</p>
              <a
                href={hubspotDealUrl(flag.hubspotDealId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline inline-flex items-center gap-1"
                title="Open deal in HubSpot"
              >
                Open in HubSpot ↗
              </a>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          <section>
            <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Reason</h3>
            <p className="text-sm text-foreground whitespace-pre-line bg-surface rounded-md border border-t-border p-3">
              {flag.reason}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Deal" value={flag.dealName ?? `Deal ${flag.hubspotDealId}`} />
            <Field
              label="HubSpot ID"
              value={flag.hubspotDealId}
              href={hubspotDealUrl(flag.hubspotDealId)}
            />
            <Field label="Type" value={humanize(flag.type)} />
            <Field label="Assigned to" value={flag.assignedToUser?.name ?? flag.assignedToUser?.email ?? "Unassigned"} />
            <Field label="Raised by" value={flag.raisedByUser?.name ?? flag.raisedByUser?.email ?? "(system)"} />
            <Field label="Raised" value={new Date(flag.raisedAt).toLocaleString()} />
            {flag.acknowledgedAt && <Field label="Acknowledged" value={new Date(flag.acknowledgedAt).toLocaleString()} />}
            {flag.resolvedAt && <Field label="Resolved" value={new Date(flag.resolvedAt).toLocaleString()} />}
          </section>

          {flag.resolvedNotes && (
            <section>
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Resolution notes</h3>
              <p className="text-sm text-foreground whitespace-pre-line bg-surface rounded-md border border-t-border p-3">
                {flag.resolvedNotes}
              </p>
            </section>
          )}

          {actionError && (
            <div className="p-3 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm">{actionError}</div>
          )}

          {!isClosed && (
            <section className="space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-muted">Actions</h3>
              {isOpen && (
                <button
                  disabled={busy}
                  onClick={() => call(`/api/pm-flags/${flag.id}/acknowledge`)}
                  className="w-full px-3 py-2 rounded-md bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium"
                >
                  Acknowledge
                </button>
              )}
              {(isOpen || isAcknowledged) && (
                <div className="space-y-2 bg-surface rounded-md border border-t-border p-3">
                  <label className="text-xs text-muted uppercase tracking-wide">Resolve with notes</label>
                  <textarea
                    value={resolveNotes}
                    onChange={e => setResolveNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-background border border-t-border rounded-md p-2 text-sm text-foreground"
                    placeholder="What was done to resolve this?"
                  />
                  <button
                    disabled={busy || resolveNotes.trim().length === 0}
                    onClick={() => call(`/api/pm-flags/${flag.id}/resolve`, { notes: resolveNotes })}
                    className="w-full px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium"
                  >
                    Resolve
                  </button>
                </div>
              )}
              {isAdminLike && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Reason for cancelling this flag?");
                    if (!reason) return;
                    void call(`/api/pm-flags/${flag.id}/cancel`, { reason });
                  }}
                  className="w-full px-3 py-2 rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 font-medium"
                >
                  Cancel flag (admin)
                </button>
              )}
            </section>
          )}

          {!isClosed && (
            <section className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted">Add note</label>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={2}
                className="w-full bg-background border border-t-border rounded-md p-2 text-sm text-foreground"
                placeholder="Visible in the timeline"
              />
              <button
                disabled={busy || noteText.trim().length === 0}
                onClick={async () => {
                  await call(`/api/pm-flags/${flag.id}/note`, { notes: noteText });
                  setNoteText("");
                }}
                className="px-3 py-2 rounded-md bg-surface hover:bg-surface-2 border border-t-border text-foreground text-sm"
              >
                Add note
              </button>
            </section>
          )}

          <section>
            <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Timeline</h3>
            <ol className="space-y-2 border-l border-t-border pl-4">
              {flag.events.map(ev => (
                <li key={ev.id} className="text-sm">
                  <div className="text-foreground">
                    <span className="font-medium">{humanize(ev.eventType)}</span>
                    {ev.notes && <span className="text-muted"> — {ev.notes}</span>}
                  </div>
                  <div className="text-xs text-muted">{new Date(ev.createdAt).toLocaleString()}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-orange-300 hover:underline underline-offset-2 mt-0.5 break-words inline-block"
        >
          {value} ↗
        </a>
      ) : (
        <div className="text-foreground mt-0.5 break-words">{value}</div>
      )}
    </div>
  );
}
