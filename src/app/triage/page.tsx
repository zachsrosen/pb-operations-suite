"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getHubSpotDealUrl } from "@/lib/external-links";
import type { SerializedAdder } from "@/app/dashboards/adders/types";
import TriageDealLookup from "./TriageDealLookup";
import TriageStepper from "./TriageStepper";
import TriageReview from "./TriageReview";
import { useOfflineDraft, clearDraft } from "./useOfflineDraft";

type Phase = "lookup" | "questions" | "review" | "submitted";

type DealCtx = { id: string; name: string; shop: string };

/**
 * Mobile-first triage entry point. Full-bleed (no DashboardShell).
 *
 *   step 1: pick a deal (lookup)
 *     ↓ POST /api/triage/runs → runId
 *   step 2: questionnaire (TriageStepper)
 *     ↓
 *   step 3: review + submit (TriageReview)
 *     ↓ POST /api/triage/runs/[id]/submit
 *   step 4: done screen
 *
 * Deal can be pre-populated via `?dealId=…` — in that case we skip the
 * lookup step and fetch the deal to resolve the shop.
 */
export default function TriagePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefilledDealId = searchParams.get("dealId");

  const [phase, setPhase] = useState<Phase>("lookup");
  const [deal, setDeal] = useState<DealCtx | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [shopPromptOpen, setShopPromptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adders, setAdders] = useState<SerializedAdder[]>([]);

  const { draft, setDraft, clear: clearLocalDraft, hydrated } =
    useOfflineDraft(runId);

  const startRun = useCallback(async (ctx: DealCtx) => {
    setError(null);
    try {
      const res = await fetch("/api/triage/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: ctx.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to start run (${res.status})`);
      }
      const { run } = await res.json();
      setRunId(run.id);
      setDeal(ctx);
      setPhase("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
  }, []);

  // Handle ?dealId=X by auto-fetching the deal and starting a run.
  useEffect(() => {
    if (!prefilledDealId || deal) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(prefilledDealId)}`
        );
        if (!res.ok) throw new Error(`Deal ${prefilledDealId} not found`);
        const { project } = await res.json();
        if (!project) throw new Error("Deal not found");
        const ctx: DealCtx = {
          id: String(project.id),
          name: project.name ?? "Deal",
          shop: project.pbLocation ?? "",
        };
        if (!ctx.shop) {
          // Prompt for shop before starting the run; review needs a valid
          // shop to price recs.
          setDeal(ctx);
          setShopPromptOpen(true);
          return;
        }
        await startRun(ctx);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lookup failed");
      }
    })();
  }, [prefilledDealId, deal, startRun]);

  function handleDealPicked(picked: DealCtx) {
    if (!picked.shop) {
      setDeal(picked);
      setShopPromptOpen(true);
      return;
    }
    void startRun(picked);
  }

  function onQuestionsComplete(adderList: SerializedAdder[]) {
    setAdders(adderList);
    setPhase("review");
  }

  function onSubmitted() {
    if (runId) clearDraft(runId);
    clearLocalDraft();
    setPhase("submitted");
  }

  function resetToLookup() {
    setPhase("lookup");
    setDeal(null);
    setRunId(null);
    setAdders([]);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {error && (
        <div className="sticky top-0 z-20 border-b border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          <div className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs font-medium text-red-600"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {shopPromptOpen && deal && (
        <ShopPromptModal
          dealName={deal.name}
          onCancel={() => {
            setShopPromptOpen(false);
            resetToLookup();
          }}
          onPicked={(shop) => {
            setShopPromptOpen(false);
            void startRun({ ...deal, shop });
          }}
        />
      )}

      {phase === "lookup" && !shopPromptOpen && (
        <TriageDealLookup onSelect={handleDealPicked} />
      )}

      {phase === "questions" && runId && hydrated && (
        <TriageStepper
          runId={runId}
          draft={draft}
          setDraft={setDraft}
          onComplete={onQuestionsComplete}
          onBackToLookup={resetToLookup}
          dealName={deal?.name ?? null}
        />
      )}

      {phase === "review" && runId && deal && (
        <TriageReview
          runId={runId}
          dealId={deal.id}
          dealName={deal.name}
          shop={deal.shop}
          adders={adders}
          draft={draft}
          setDraft={setDraft}
          onBack={() => setPhase("questions")}
          onSubmitted={onSubmitted}
        />
      )}

      {phase === "submitted" && deal && (
        <SubmittedScreen
          dealId={deal.id}
          dealName={deal.name}
          onNew={() => {
            router.replace("/triage");
            resetToLookup();
          }}
        />
      )}
    </div>
  );
}

const SHOPS = [
  "Westminster",
  "DTC",
  "Colorado Springs",
  "SLO",
  "Camarillo",
] as const;

function ShopPromptModal({
  dealName,
  onPicked,
  onCancel,
}: {
  dealName: string;
  onPicked: (shop: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-surface-elevated p-4 shadow-card sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-foreground">Which shop?</h2>
        <p className="mt-1 text-sm text-muted">
          {dealName} doesn&apos;t have a PB location set. Pricing depends on
          shop — pick one to continue.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {SHOPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPicked(s)}
              className="rounded-lg border border-t-border bg-surface px-4 py-3 text-left text-base font-medium text-foreground transition-colors hover:border-orange-500 hover:text-orange-500"
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-lg bg-surface-2 px-4 py-3 text-sm font-medium text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubmittedScreen({
  dealId,
  dealName,
  onNew,
}: {
  dealId: string;
  dealName: string;
  onNew: () => void;
}) {
  const hubspotUrl = getHubSpotDealUrl(dealId);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/15 text-3xl text-orange-500">
        ✓
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Triage submitted
        </h1>
        <p className="mt-1 text-sm text-muted">{dealName}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <a
          href={hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-orange-500 px-4 py-3 text-center text-base font-medium text-white transition-colors hover:bg-orange-600"
        >
          Open deal in HubSpot
        </a>
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg bg-surface-2 px-4 py-3 text-sm font-medium text-foreground"
        >
          Triage another deal
        </button>
      </div>
    </div>
  );
}
