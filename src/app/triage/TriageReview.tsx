"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatMoney } from "@/lib/format";
import type { SerializedAdder } from "@/app/dashboards/adders/types";
import type { TriageDraft } from "./useOfflineDraft";
import TriagePhotoCapture, { type TriagePhoto } from "./TriagePhotoCapture";

type Recommendation = {
  code: string;
  name: string;
  category: string;
  type: string;
  direction: "ADD" | "DISCOUNT";
  unit: string;
  unitPrice: number;
  qty: number;
  amount: number;
};

type Props = {
  runId: string;
  dealId: string;
  dealName?: string | null;
  shop: string;
  adders: SerializedAdder[];
  draft: TriageDraft;
  setDraft: (next: TriageDraft | ((prev: TriageDraft) => TriageDraft)) => void;
  onBack: () => void;
  onSubmitted: () => void;
};

export default function TriageReview({
  runId,
  dealId,
  dealName,
  shop,
  adders,
  draft,
  setDraft,
  onBack,
  onSubmitted,
}: Props) {
  // Translate answers from `adderId` keys to the shape the recommend engine
  // expects — it's the same shape today (keyed by adder ID), so pass through.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["triage", "recommend", runId, draft.answers, shop],
    queryFn: async (): Promise<Recommendation[]> => {
      const res = await fetch("/api/triage/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, answers: draft.answers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { recommendations: Recommendation[] };
      return body.recommendations ?? [];
    },
    enabled: Boolean(shop),
    staleTime: 15_000,
  });

  const recs = data ?? [];
  const byCode = useMemo(() => {
    const m = new Map<string, SerializedAdder>();
    for (const a of adders) m.set(a.code, a);
    return m;
  }, [adders]);

  const [photos, setPhotos] = useState<Record<string, TriagePhoto | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydrate any photos already stored server-side on this run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/triage/runs/${runId}`);
        if (!res.ok) return;
        const { run } = await res.json();
        const ps: TriagePhoto[] = Array.isArray(run?.photos) ? run.photos : [];
        if (cancelled) return;
        const map: Record<string, TriagePhoto | null> = {};
        for (const p of ps) if (p?.code) map[p.code] = p;
        setPhotos(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const uncheckedCodes = new Set(draft.uncheckedCodes);

  const selected = recs.filter((r) => !uncheckedCodes.has(r.code));
  const totalSigned = selected.reduce((sum, r) => sum + r.amount, 0);

  const missingPhotos = selected.filter((r) => {
    const a = byCode.get(r.code);
    return a?.photosRequired && !photos[r.code];
  });

  const missingReasons = Array.from(uncheckedCodes).filter(
    (code) => !(draft.uncheckedReasons[code] ?? "").trim()
  );

  const canSubmit =
    !submitting &&
    selected.length > 0 &&
    missingPhotos.length === 0 &&
    missingReasons.length === 0;

  function toggleCheck(code: string, checked: boolean) {
    setDraft((prev) => {
      if (checked) {
        const nextCodes = prev.uncheckedCodes.filter((c) => c !== code);
        const nextReasons = { ...prev.uncheckedReasons };
        delete nextReasons[code];
        return {
          ...prev,
          uncheckedCodes: nextCodes,
          uncheckedReasons: nextReasons,
        };
      }
      return {
        ...prev,
        uncheckedCodes: Array.from(new Set([...prev.uncheckedCodes, code])),
      };
    });
  }

  function setReason(code: string, reason: string) {
    setDraft((prev) => ({
      ...prev,
      uncheckedReasons: { ...prev.uncheckedReasons, [code]: reason },
    }));
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Build the selectedAdders payload the server will snapshot to HubSpot.
      const selectedAdders = selected.map((r) => {
        const a = byCode.get(r.code);
        return {
          code: r.code,
          name: r.name,
          qty: r.qty,
          unitPrice: r.unitPrice,
          amount: r.amount,
          photosRequired: Boolean(a?.photosRequired),
        };
      });

      // Combine rep notes with per-adder reasons for audit.
      const reasonsNote = Object.entries(draft.uncheckedReasons)
        .filter(([, v]) => v.trim().length > 0)
        .map(([code, reason]) => `[${code}] ${reason.trim()}`)
        .join("\n");

      const patchRes = await fetch(`/api/triage/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedAdders,
          recommendedAdders: recs,
          dealId,
          notes: reasonsNote || undefined,
        }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Patch failed (${patchRes.status})`);
      }

      const subRes = await fetch(`/api/triage/runs/${runId}/submit`, {
        method: "POST",
      });
      if (!subRes.ok) {
        const body = await subRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Submit failed (${subRes.status})`);
      }
      onSubmitted();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-t-border border-t-orange-500" />
        <p className="text-sm text-muted">Calculating recommendations…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-red-500">Failed to load recommendations.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-t-border bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            ← Back
          </button>
          <div className="text-xs font-medium text-muted">Review</div>
        </div>
        {dealName && (
          <div className="truncate px-4 pb-2 text-xs text-muted">
            {dealName}
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4">
        {recs.length === 0 ? (
          <div className="rounded-lg border border-t-border bg-surface p-4 text-sm text-muted">
            No adders recommended based on your answers.
          </div>
        ) : (
          recs.map((r) => {
            const adder = byCode.get(r.code);
            const unchecked = uncheckedCodes.has(r.code);
            const photo = photos[r.code] ?? null;
            const needsPhoto = Boolean(adder?.photosRequired) && !unchecked;
            return (
              <div
                key={r.code}
                className={`rounded-lg border-2 bg-surface p-3 transition-colors ${
                  unchecked ? "border-t-border opacity-60" : "border-orange-500/40"
                }`}
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!unchecked}
                    onChange={(e) => toggleCheck(r.code, e.target.checked)}
                    className="mt-1 h-5 w-5 flex-shrink-0 accent-orange-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">
                          {r.name}
                        </div>
                        <div className="text-xs text-muted">
                          {r.category} · qty {r.qty} × {formatMoney(r.unitPrice)}
                        </div>
                      </div>
                      <div
                        className={`flex-shrink-0 text-sm font-semibold ${
                          r.direction === "DISCOUNT"
                            ? "text-red-500"
                            : "text-foreground"
                        }`}
                      >
                        {formatMoney(r.amount)}
                      </div>
                    </div>
                  </div>
                </label>

                {unchecked && (
                  <div className="mt-3 flex flex-col gap-1 border-t border-t-border pt-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted">
                      Reason for unchecking (required)
                    </label>
                    <textarea
                      value={draft.uncheckedReasons[r.code] ?? ""}
                      onChange={(e) => setReason(r.code, e.target.value)}
                      rows={2}
                      placeholder="Why doesn't this apply?"
                      className="rounded-lg border border-t-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                )}

                {needsPhoto && (
                  <div className="mt-3 border-t border-t-border pt-3">
                    <TriagePhotoCapture
                      runId={runId}
                      code={r.code}
                      label="Photo required"
                      value={photo}
                      onChange={(next) =>
                        setPhotos((p) => ({ ...p, [r.code]: next }))
                      }
                    />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Summary */}
        {recs.length > 0 && (
          <div className="sticky bottom-0 -mx-4 mt-2 border-t border-t-border bg-surface-elevated p-4 shadow-card">
            <div className="flex items-center justify-between pb-3 text-sm">
              <span className="text-muted">Selected</span>
              <span className="font-semibold text-foreground">
                {selected.length} of {recs.length}
              </span>
            </div>
            <div className="flex items-center justify-between pb-4 text-base">
              <span className="font-medium text-foreground">Total</span>
              <span className="font-semibold text-foreground">
                {formatMoney(totalSigned)}
              </span>
            </div>

            {missingPhotos.length > 0 && (
              <p className="mb-2 text-xs text-red-500">
                Missing photo for: {missingPhotos.map((r) => r.code).join(", ")}
              </p>
            )}
            {missingReasons.length > 0 && (
              <p className="mb-2 text-xs text-red-500">
                Reason required for: {missingReasons.join(", ")}
              </p>
            )}
            {submitError && (
              <p className="mb-2 text-xs text-red-500">{submitError}</p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-orange-500 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit triage"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
