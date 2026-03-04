"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";

type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";
type MatchDecisionStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED";
type ReviewDecision = Exclude<MatchDecisionStatus, "PENDING">;

interface MemberSource {
  source: string;
  externalId: string;
  rawName: string;
}

interface MatchGroup {
  id: string;
  matchGroupKey: string;
  confidence: MatchConfidence;
  score: number;
  canonicalBrand: string | null;
  canonicalModel: string | null;
  category: string | null;
  memberSources: unknown;
  reviewReason: string | null;
  decision: MatchDecisionStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

interface ReviewResponse {
  groups: MatchGroup[];
  total: number;
  limit: number;
  offset: number;
}

function parseMemberSources(value: unknown): MemberSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const source = String(candidate.source || "").trim();
      const externalId = String(candidate.externalId || "").trim();
      const rawName = String(candidate.rawName || "").trim();
      if (!source || !externalId) return null;
      return { source, externalId, rawName };
    })
    .filter((entry): entry is MemberSource => Boolean(entry));
}

function confidenceClass(confidence: MatchConfidence): string {
  if (confidence === "HIGH") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (confidence === "MEDIUM") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

function sourceClass(source: string): string {
  if (source === "internal") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  if (source === "hubspot") return "border-orange-500/40 bg-orange-500/10 text-orange-300";
  if (source === "zuper") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  if (source === "zoho") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  return "border-teal-500/40 bg-teal-500/10 text-teal-300";
}

export default function CatalogMatchReviewPage() {
  const [status, setStatus] = useState<MatchDecisionStatus>("PENDING");
  const [confidence, setConfidence] = useState<"" | MatchConfidence>("");
  const [groups, setGroups] = useState<MatchGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusyByKey, setActionBusyByKey] = useState<Record<string, boolean>>({});
  const [noteByKey, setNoteByKey] = useState<Record<string, string>>({});

  const limit = 40;

  const loadGroups = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          status,
          limit: String(limit),
          offset: String(nextOffset),
        });
        if (confidence) params.set("confidence", confidence);

        const response = await fetch(`/api/catalog/review?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ReviewResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `Failed to load review queue (${response.status})`);
        }

        setGroups((prev) => (append ? [...prev, ...payload.groups] : payload.groups));
        setTotal(payload.total || 0);
        setOffset(nextOffset + (payload.groups?.length || 0));
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load review queue");
      } finally {
        setLoading(false);
      }
    },
    [status, confidence]
  );

  useEffect(() => {
    void loadGroups(0, false);
  }, [loadGroups]);

  const runDecision = useCallback(
    async (matchGroupKey: string, decision: ReviewDecision) => {
      const note = (noteByKey[matchGroupKey] || "").trim();
      setActionBusyByKey((prev) => ({ ...prev, [matchGroupKey]: true }));
      setActionMessage(null);
      try {
        const response = await fetch("/api/catalog/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchGroupKey,
            decision,
            note: note.length > 0 ? note : undefined,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `Failed to ${decision.toLowerCase()} group (${response.status})`);
        }
        setActionMessage(`${decision} saved for group ${matchGroupKey}.`);
        await loadGroups(0, false);
      } catch (actionError) {
        setActionMessage(actionError instanceof Error ? actionError.message : "Failed to update group");
      } finally {
        setActionBusyByKey((prev) => {
          const next = { ...prev };
          delete next[matchGroupKey];
          return next;
        });
      }
    },
    [loadGroups, noteByKey]
  );

  const hasMore = groups.length < total;

  const summary = useMemo(() => {
    return {
      high: groups.filter((group) => group.confidence === "HIGH").length,
      medium: groups.filter((group) => group.confidence === "MEDIUM").length,
      low: groups.filter((group) => group.confidence === "LOW").length,
    };
  }, [groups]);

  return (
    <DashboardShell
      title="Catalog Match Review"
      subtitle="Review medium/low confidence cross-source match groups"
      accentColor="cyan"
      breadcrumbs={[
        { label: "Operations", href: "/suites/operations" },
        { label: "Product Comparison", href: "/dashboards/product-comparison" },
      ]}
    >
      <div className="space-y-4">
        <div className="bg-surface border border-t-border rounded-xl p-4 flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">Status</label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as MatchDecisionStatus)}
            className="px-2 py-1 rounded border border-t-border bg-background text-xs text-foreground"
          >
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="MERGED">Merged</option>
          </select>

          <label className="text-xs text-muted ml-2">Confidence</label>
          <select
            value={confidence}
            onChange={(event) => setConfidence(event.target.value as "" | MatchConfidence)}
            className="px-2 py-1 rounded border border-t-border bg-background text-xs text-foreground"
          >
            <option value="">All</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          <button
            type="button"
            onClick={() => void loadGroups(0, false)}
            className="ml-auto px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs hover:bg-cyan-500/20"
          >
            Refresh
          </button>
          <Link
            href="/dashboards/product-comparison"
            className="px-3 py-1.5 rounded border border-t-border bg-background text-xs text-muted hover:text-foreground"
          >
            Back to comparison
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface border border-t-border rounded-xl p-3">
            <div className="text-xs text-muted">Loaded groups</div>
            <div className="text-xl font-semibold mt-1">{groups.length}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-xl p-3">
            <div className="text-xs text-muted">High</div>
            <div className="text-xl font-semibold text-green-300 mt-1">{summary.high}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-xl p-3">
            <div className="text-xs text-muted">Medium</div>
            <div className="text-xl font-semibold text-amber-300 mt-1">{summary.medium}</div>
          </div>
          <div className="bg-surface border border-t-border rounded-xl p-3">
            <div className="text-xs text-muted">Low</div>
            <div className="text-xl font-semibold text-red-300 mt-1">{summary.low}</div>
          </div>
        </div>

        {actionMessage && (
          <div className="bg-surface border border-cyan-500/30 rounded-xl p-3 text-sm text-cyan-200">
            {actionMessage}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!loading && groups.length === 0 && (
          <div className="bg-surface border border-t-border rounded-xl p-6 text-sm text-muted">
            No groups found for current filters.
          </div>
        )}

        <div className="space-y-3">
          {groups.map((group) => {
            const members = parseMemberSources(group.memberSources);
            const isBusy = Boolean(actionBusyByKey[group.matchGroupKey]);
            const canMutate = group.decision === "PENDING";
            return (
              <article
                key={group.id}
                className="bg-surface border border-t-border rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {(group.canonicalBrand || "Unknown brand")} {(group.canonicalModel || "Unknown model")}
                    </div>
                    <div className="text-xs text-muted mt-1 break-all">
                      Group: {group.matchGroupKey} · Category: {group.category || "—"} · Score {Math.round(group.score)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-1 rounded border ${confidenceClass(group.confidence)}`}>
                      {group.confidence}
                    </span>
                    <span className="text-[11px] px-2 py-1 rounded border border-t-border bg-background text-muted">
                      {group.decision}
                    </span>
                  </div>
                </div>

                {group.reviewReason && (
                  <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    {group.reviewReason}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {members.map((member) => (
                    <div
                      key={`${group.matchGroupKey}-${member.source}-${member.externalId}`}
                      className="rounded border border-t-border bg-background/70 px-2 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded border ${sourceClass(member.source)}`}>
                          {member.source}
                        </span>
                        <span className="text-[11px] text-muted break-all">{member.externalId}</span>
                      </div>
                      <div className="text-xs text-foreground mt-1 break-words">
                        {member.rawName || "Unnamed product"}
                      </div>
                    </div>
                  ))}
                </div>

                {group.decision !== "PENDING" && (
                  <div className="text-xs text-muted">
                    Decision by {group.decidedBy || "unknown"} at {group.decidedAt || "—"}
                    {group.decisionNote ? ` · Note: ${group.decisionNote}` : ""}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={noteByKey[group.matchGroupKey] || ""}
                    onChange={(event) =>
                      setNoteByKey((prev) => ({
                        ...prev,
                        [group.matchGroupKey]: event.target.value,
                      }))
                    }
                    placeholder="Optional review note"
                    className="flex-1 min-w-[200px] px-2 py-1.5 rounded border border-t-border bg-background text-xs text-foreground"
                    disabled={isBusy || !canMutate}
                  />
                  <button
                    type="button"
                    onClick={() => void runDecision(group.matchGroupKey, "APPROVED")}
                    disabled={isBusy || !canMutate}
                    className="px-2.5 py-1.5 rounded border border-green-500/40 bg-green-500/10 text-green-300 text-xs hover:bg-green-500/20 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void runDecision(group.matchGroupKey, "REJECTED")}
                    disabled={isBusy || !canMutate}
                    className="px-2.5 py-1.5 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-xs hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void runDecision(group.matchGroupKey, "MERGED")}
                    disabled={isBusy || !canMutate}
                    className="px-2.5 py-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 text-xs hover:bg-fuchsia-500/20 disabled:opacity-50"
                  >
                    Mark merged
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadGroups(offset, true)}
              disabled={loading}
              className="px-4 py-2 rounded border border-t-border bg-background text-sm text-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? "Loading..." : `Load more (${groups.length}/${total})`}
            </button>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
