"use client";

/**
 * SOP Proposals admin review UI.
 *
 * - Tab toggle: Pending / Approved / Rejected / All
 * - Table of proposals (one row each)
 * - Click row → side panel with full content + reviewer actions
 * - Approve / Reject from the panel; admin can override target tab/group
 *
 * **Security note:** the content rendered in the side panel is HTML
 * that was already sanitized server-side at submit (`sanitizeSopContent`
 * in /api/sop/proposals POST). We re-sanitize here client-side as a
 * second defense-in-depth pass before injection — the function is
 * universal (sanitize-html works in browser bundles).
 */

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { sanitizeSopContent } from "@/lib/sop-sanitize";

interface ProposalRow {
  id: string;
  title: string;
  suggestedTabId: string;
  suggestedGroup: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedBy: string;
  submittedByName: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNotes: string | null;
  promotedSectionId: string | null;
  promotedSectionTab: string | null;
  createdAt: string;
}

interface TabOption {
  id: string;
  label: string;
}

interface Props {
  initialProposals: ProposalRow[];
  tabs: TabOption[];
  currentFilter: "PENDING" | "APPROVED" | "REJECTED" | "all";
  counts: { pending: number; approved: number; rejected: number };
}

interface FullProposal extends ProposalRow {
  content: string;
  updatedAt: string;
}

const statusBadge = (status: ProposalRow["status"]) => {
  const map = {
    PENDING: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Pending" },
    APPROVED: { bg: "bg-green-500/15", text: "text-green-400", label: "Approved" },
    REJECTED: { bg: "bg-red-500/15", text: "text-red-400", label: "Rejected" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/**
 * Render trusted-but-double-sanitized SOP HTML inside a div.
 * The content arrives already sanitized server-side; we sanitize again
 * here so the actual `dangerouslySetInnerHTML` call only sees output
 * from `sanitizeSopContent`.
 */
function SafeSopContent({ html }: { html: string }) {
  const sanitized = useMemo(() => sanitizeSopContent(html), [html]);
  return (
    <div
      className="sop-content prose prose-invert max-w-none bg-surface border border-t-border rounded p-4"
      // eslint-disable-next-line react/no-danger -- content sanitized via sanitizeSopContent above
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export default function SopProposalsClient({ initialProposals, tabs, currentFilter, counts }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FullProposal | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [overrideTabId, setOverrideTabId] = useState<string>("");
  const [overrideGroup, setOverrideGroup] = useState<string>("");

  const tabsById = Object.fromEntries(tabs.map((t) => [t.id, t.label]));

  const openProposal = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setActionError(null);
    setReviewerNotes("");
    setOverrideTabId("");
    setOverrideGroup("");
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/sop/proposals/${id}`);
      const data = await res.json();
      if (res.ok && data.proposal) {
        setDetail(data.proposal);
      } else {
        setActionError(data.error || "Failed to load proposal");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const closePanel = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const handleAction = useCallback(
    async (action: "approve" | "reject") => {
      if (!detail) return;
      if (action === "reject" && !reviewerNotes.trim()) {
        setActionError("Reviewer notes are required when rejecting");
        return;
      }
      setActionInFlight(true);
      setActionError(null);

      const body: Record<string, unknown> = { action };
      if (reviewerNotes.trim()) body.reviewerNotes = reviewerNotes.trim();
      if (action === "approve") {
        if (overrideTabId) body.targetTabId = overrideTabId;
        if (overrideGroup.trim()) body.targetGroup = overrideGroup.trim();
      }

      try {
        const res = await fetch(`/api/admin/sop/proposals/${detail.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setActionError(data.error || "Action failed");
          return;
        }
        // Refresh server data
        router.refresh();
        closePanel();
      } catch {
        setActionError("Network error");
      } finally {
        setActionInFlight(false);
      }
    },
    [detail, reviewerNotes, overrideTabId, overrideGroup, router],
  );

  const switchFilter = (f: "PENDING" | "APPROVED" | "REJECTED" | "all") => {
    const params = new URLSearchParams();
    if (f !== "PENDING") params.set("status", f);
    router.push(`/dashboards/admin/sop-proposals?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Filter toggle */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {(
          [
            ["PENDING", `Pending (${counts.pending})`],
            ["APPROVED", `Approved (${counts.approved})`],
            ["REJECTED", `Rejected (${counts.rejected})`],
            ["all", `All (${counts.pending + counts.approved + counts.rejected})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => switchFilter(key as typeof currentFilter)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              currentFilter === key
                ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                : "bg-surface border-t-border text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {initialProposals.length === 0 && (
        <div className="bg-surface border border-t-border rounded-lg p-12 text-center text-muted">
          No proposals in this view.
        </div>
      )}

      {/* Table */}
      {initialProposals.length > 0 && (
        <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Submitter</th>
                <th className="px-4 py-2 text-left font-medium">Tab</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Submitted</th>
                <th className="px-4 py-2 text-right font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {initialProposals.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => openProposal(p.id)}
                  className="border-t border-t-border cursor-pointer hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3 text-foreground font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-muted">
                    {p.submittedByName || p.submittedBy.split("@")[0]}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {tabsById[p.suggestedTabId] || p.suggestedTabId}
                  </td>
                  <td className="px-4 py-3">{statusBadge(p.status)}</td>
                  <td className="px-4 py-3 text-muted">{fmtDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-right text-muted">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Side panel */}
      {selectedId && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={closePanel}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="fixed right-0 top-0 bottom-0 w-full max-w-3xl bg-background border-l border-t-border shadow-2xl overflow-auto z-50"
          >
            {loadingDetail && (
              <div className="p-6 text-muted">Loading proposal…</div>
            )}
            {!loadingDetail && detail && (
              <div className="flex flex-col min-h-full">
                {/* Header */}
                <div className="border-b border-t-border bg-surface px-6 py-4 sticky top-0 z-10">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-foreground truncate">
                        {detail.title}
                      </h2>
                      <div className="text-xs text-muted mt-1">
                        Submitted by {detail.submittedByName || detail.submittedBy} · {fmtDate(detail.createdAt)} · {statusBadge(detail.status)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closePanel}
                      className="text-muted hover:text-foreground text-xl leading-none"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Reason */}
                <div className="px-6 py-4 border-b border-t-border bg-blue-500/5">
                  <div className="text-xs uppercase tracking-wide text-muted mb-1">Why this matters</div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{detail.reason}</p>
                </div>

                {/* Suggested target */}
                <div className="px-6 py-4 border-b border-t-border text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted mb-1">Suggested home</div>
                  <p className="text-foreground">
                    Tab: <strong>{tabsById[detail.suggestedTabId] || detail.suggestedTabId}</strong>
                    {detail.suggestedGroup && (
                      <>
                        {" "}· Group: <strong>{detail.suggestedGroup}</strong>
                      </>
                    )}
                  </p>
                </div>

                {/* Content preview */}
                <div className="px-6 py-4 border-b border-t-border flex-1">
                  <div className="text-xs uppercase tracking-wide text-muted mb-2">Proposed content</div>
                  <SafeSopContent html={detail.content} />
                </div>

                {/* Already-reviewed: show notes */}
                {detail.status !== "PENDING" && (
                  <div className="px-6 py-4 border-b border-t-border bg-surface">
                    <div className="text-xs uppercase tracking-wide text-muted mb-1">
                      Reviewed by {detail.reviewedBy || "—"} · {fmtDate(detail.reviewedAt)}
                    </div>
                    {detail.reviewerNotes && (
                      <p className="text-sm text-foreground whitespace-pre-wrap mt-2">
                        {detail.reviewerNotes}
                      </p>
                    )}
                    {detail.status === "APPROVED" && detail.promotedSectionId && (
                      <div className="mt-3 text-sm text-green-400">
                        ✓ Promoted to{" "}
                        <a
                          href={`/sop?tab=${detail.promotedSectionTab}&s=${detail.promotedSectionId}`}
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {detail.promotedSectionId}
                        </a>{" "}
                        in tab <strong>{tabsById[detail.promotedSectionTab || ""] || detail.promotedSectionTab}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Pending: action panel */}
                {detail.status === "PENDING" && (
                  <div className="px-6 py-5 border-t border-t-border bg-surface space-y-4 sticky bottom-0">
                    {actionError && (
                      <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
                        {actionError}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-muted mb-1">
                        Reviewer notes
                        <span className="text-muted/70 ml-1">— required if rejecting; optional on approve</span>
                      </label>
                      <textarea
                        value={reviewerNotes}
                        onChange={(e) => setReviewerNotes(e.target.value)}
                        rows={2}
                        placeholder="Reason for rejection, or note to attach to the approval"
                        className="w-full px-3 py-2 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted mb-1">
                          Override target tab (optional)
                        </label>
                        <select
                          value={overrideTabId}
                          onChange={(e) => setOverrideTabId(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500"
                        >
                          <option value="">
                            Keep submitter&apos;s choice ({tabsById[detail.suggestedTabId] || detail.suggestedTabId})
                          </option>
                          {tabs.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">
                          Override sidebar group (optional)
                        </label>
                        <input
                          type="text"
                          value={overrideGroup}
                          onChange={(e) => setOverrideGroup(e.target.value)}
                          placeholder={detail.suggestedGroup || "Submitted by team"}
                          className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={actionInFlight}
                        onClick={() => handleAction("reject")}
                        className="px-4 py-2 text-sm font-medium rounded bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                      >
                        {actionInFlight ? "..." : "Reject"}
                      </button>
                      <button
                        type="button"
                        disabled={actionInFlight}
                        onClick={() => handleAction("approve")}
                        className="px-4 py-2 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {actionInFlight ? "..." : "Approve & Promote"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
