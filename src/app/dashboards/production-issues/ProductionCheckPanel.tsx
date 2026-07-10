"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";
import { getHubSpotDealUrl } from "@/lib/external-links";

/**
 * Production-check ("Photon Advantage" production-guarantee fix) workflow panel.
 *
 * Flow: kickoff → designer verifies/proposes the fix → service lead presses
 * Yes (creates the Send Plans / Vishtik task) or No (back to design, reason
 * required). Buttons render from the server-computed `viewer` capability
 * flags; the API enforces the real gates.
 *
 * See docs/superpowers/specs/2026-07-10-production-check-guarantee-design.md
 */

type ProductionCheckRow = {
  id: string;
  hubspotDealId: string;
  dealName: string | null;
  status: "DESIGN_REVIEW" | "PENDING_APPROVAL" | "APPROVED" | "CANCELLED";
  issueSummary: string;
  proposedSolution: string | null;
  designerEmail: string | null;
  rejectionReason: string | null;
  designCycles: number;
  estimatedCostCents: number | null;
  createdByEmail: string;
  createdAt: string;
};

type PanelResponse = {
  requests: ProductionCheckRow[];
  viewer: { canCreate: boolean; canSubmitSolution: boolean; canDecide: boolean };
  lastUpdated: string;
};

const STATUS_CHIP: Record<ProductionCheckRow["status"], { label: string; cls: string }> = {
  DESIGN_REVIEW: { label: "Design Review", cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  PENDING_APPROVAL: { label: "Awaiting Approval", cls: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  APPROVED: { label: "Approved", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
  CANCELLED: { label: "Cancelled", cls: "bg-zinc-500/20 text-muted border-zinc-500/30" },
};

function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (Number.isNaN(days) || days < 0) return "—";
  if (days === 0) return "today";
  return `${days}d ago`;
}

const QUERY_KEY = ["service", "production-check"];

export default function ProductionCheckPanel() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/service/production-check");
      if (!res.ok) throw new Error(`Failed to load production checks (${res.status})`);
      return (await res.json()) as PanelResponse;
    },
    staleTime: 60 * 1000,
  });

  const [busy, setBusy] = useState(false);

  async function post(path: string, body?: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        addToast({ type: "error", title: "Production check", message: err?.error ?? `Request failed (${res.status})` });
        return false;
      }
      const payload = (await res.json().catch(() => null)) as { warning?: string } | null;
      if (payload?.warning) {
        addToast({
          type: "warning",
          title: "Saved, but no HubSpot task was created",
          message: `Reason: ${payload.warning}. Check the design lead / approver configuration.`,
        });
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      return true;
    } finally {
      setBusy(false);
    }
  }

  const viewer = data?.viewer;
  const rows = (data?.requests ?? []).filter((r) => r.status !== "CANCELLED");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Production Checks</h2>
          <p className="text-sm text-muted">
            Guarantee-fix verification: design confirms the solution, service approves before it goes to Vishtik.
          </p>
        </div>
        {viewer?.canCreate && <KickoffButton busy={busy} onSubmit={post} />}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-t-border bg-surface p-6 text-sm text-muted">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">
          Couldn&apos;t load production checks. {error instanceof Error ? error.message : ""}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-t-border bg-surface p-6 text-sm text-muted">
          No production checks yet. Start one when a production issue is confirmed on a completed system.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <RequestCard key={row.id} row={row} viewer={viewer} busy={busy} onPost={post} />
          ))}
        </div>
      )}
    </div>
  );
}

function KickoffButton({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (path: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [dealId, setDealId] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [zuperJobUid, setZuperJobUid] = useState("");
  const [hubspotTicketId, setHubspotTicketId] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 transition-colors"
      >
        Start production check
      </button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-t-border bg-surface p-4 space-y-2">
      <div className="text-sm font-medium text-foreground">Start production check</div>
      <input
        value={dealId}
        onChange={(e) => setDealId(e.target.value)}
        placeholder="HubSpot deal ID"
        className="w-full rounded-md border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
      />
      <textarea
        value={issueSummary}
        onChange={(e) => setIssueSummary(e.target.value)}
        placeholder="Issue summary — what's underproducing and how it was confirmed"
        rows={3}
        className="w-full rounded-md border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
      />
      <div className="flex gap-2">
        <input
          value={zuperJobUid}
          onChange={(e) => setZuperJobUid(e.target.value)}
          placeholder="Zuper job UID (optional)"
          className="flex-1 rounded-md border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
        />
        <input
          value={hubspotTicketId}
          onChange={(e) => setHubspotTicketId(e.target.value)}
          placeholder="Ticket ID (optional)"
          className="flex-1 rounded-md border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground">
          Cancel
        </button>
        <button
          disabled={busy || !dealId.trim() || !issueSummary.trim()}
          onClick={async () => {
            const ok = await onSubmit("/api/service/production-check", {
              dealId: dealId.trim(),
              issueSummary: issueSummary.trim(),
              zuperJobUid: zuperJobUid.trim() || undefined,
              hubspotTicketId: hubspotTicketId.trim() || undefined,
            });
            if (ok) {
              setOpen(false);
              setDealId("");
              setIssueSummary("");
              setZuperJobUid("");
              setHubspotTicketId("");
            }
          }}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function RequestCard({
  row,
  viewer,
  busy,
  onPost,
}: {
  row: ProductionCheckRow;
  viewer: PanelResponse["viewer"] | undefined;
  busy: boolean;
  onPost: (path: string, body?: Record<string, unknown>) => Promise<boolean>;
}) {
  const chip = STATUS_CHIP[row.status];
  const [solution, setSolution] = useState(row.proposedSolution ?? "");
  const [showNoReason, setShowNoReason] = useState(false);
  const [noReason, setNoReason] = useState("");
  const [confirmYes, setConfirmYes] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const base = `/api/service/production-check/${row.id}`;
  const active = row.status === "DESIGN_REVIEW" || row.status === "PENDING_APPROVAL";

  return (
    <div className="rounded-xl border border-t-border bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${chip.cls}`}>{chip.label}</span>
        <a
          href={getHubSpotDealUrl(row.hubspotDealId)}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-foreground hover:underline"
        >
          {row.dealName ?? `Deal ${row.hubspotDealId}`}
        </a>
        {row.designCycles > 1 && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
            design cycle {row.designCycles}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          started {ageLabel(row.createdAt)} by {row.createdByEmail}
        </span>
      </div>

      <div className="text-sm text-foreground">
        <span className="text-muted">Issue: </span>
        {row.issueSummary}
      </div>

      {row.status === "DESIGN_REVIEW" && row.rejectionReason && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          Sent back: {row.rejectionReason}
        </div>
      )}

      {row.proposedSolution && row.status !== "DESIGN_REVIEW" && (
        <div className="text-sm text-foreground">
          <span className="text-muted">Proposed solution ({row.designerEmail ?? "design"}): </span>
          {row.proposedSolution}
        </div>
      )}

      {/* Designer card — verify/propose the fix */}
      {row.status === "DESIGN_REVIEW" && viewer?.canSubmitSolution && (
        <div className="space-y-2 rounded-lg border border-t-border bg-surface-2 p-3">
          <div className="text-xs font-medium text-muted">Design: verify or find the solution</div>
          <textarea
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            rows={3}
            placeholder="Verified fix — equipment, layout change, scope"
            className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground"
          />
          <div className="flex justify-end">
            <button
              disabled={busy || !solution.trim()}
              onClick={() => onPost(`${base}/solution`, { proposedSolution: solution.trim() })}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              Submit for approval
            </button>
          </div>
        </div>
      )}

      {/* Approval card — the yes/no Jessica step */}
      {row.status === "PENDING_APPROVAL" && viewer?.canDecide && (
        <div className="space-y-2 rounded-lg border border-t-border bg-surface-2 p-3">
          <div className="text-xs font-medium text-muted">Service approval — proceed to Vishtik?</div>
          <div className="text-xs text-muted italic">
            Estimated cost — coming soon (Photon Advantage cost calculator)
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => setConfirmYes(true)}
              className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              Yes, proceed
            </button>
            <button
              disabled={busy}
              onClick={() => setShowNoReason((v) => !v)}
              className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              No, back to design
            </button>
          </div>
          {showNoReason && (
            <div className="space-y-2">
              <textarea
                value={noReason}
                onChange={(e) => setNoReason(e.target.value)}
                rows={2}
                placeholder="Why is this going back to design? (required)"
                className="w-full rounded-md border border-t-border bg-surface px-2 py-1.5 text-sm text-foreground"
              />
              <div className="flex justify-end">
                <button
                  disabled={busy || !noReason.trim()}
                  onClick={async () => {
                    const ok = await onPost(`${base}/decide`, { decision: "no", reason: noReason.trim() });
                    if (ok) {
                      setShowNoReason(false);
                      setNoReason("");
                    }
                  }}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Send back
                </button>
              </div>
            </div>
          )}
          <ConfirmDialog
            open={confirmYes}
            title="Approve production fix?"
            message="Yes creates the Send Plans task — design work (and spend) proceeds to Vishtik."
            confirmLabel="Yes, proceed"
            onConfirm={async () => {
              setConfirmYes(false);
              await onPost(`${base}/decide`, { decision: "yes" });
            }}
            onCancel={() => setConfirmYes(false)}
          />
        </div>
      )}

      {active && viewer?.canCreate && (
        <div className="flex justify-end">
          <button
            disabled={busy}
            onClick={() => setConfirmCancel(true)}
            className="text-xs text-muted hover:text-foreground"
          >
            Cancel request
          </button>
          <ConfirmDialog
            open={confirmCancel}
            title="Cancel production check?"
            message="This withdraws the request and completes any open task. It cannot be reopened."
            confirmLabel="Cancel request"
            variant="danger"
            onConfirm={async () => {
              setConfirmCancel(false);
              await onPost(`${base}/cancel`);
            }}
            onCancel={() => setConfirmCancel(false)}
          />
        </div>
      )}
    </div>
  );
}
