import { headers } from "next/headers";

import type { EstimatorInput, EstimatorResult } from "@/lib/estimator";

import OtherQuoteResultsView, { type OtherQuoteResult } from "./OtherQuoteResultsView";
import ResultsView from "./ResultsView";

type ResultPayload = {
  token: string;
  quoteType: string;
  input: EstimatorInput | { zip: string } | { address: unknown; location: string; message?: string } | null;
  result: EstimatorResult | null;
  location: string | null;
  outOfArea: boolean;
  manualQuoteRequest: boolean;
  firstName: string | null;
  address: string | null;
  createdAt: string;
};

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const base = await getBaseUrl();

  let payload: ResultPayload | null = null;
  let errorStatus: number | null = null;
  try {
    const res = await fetch(`${base}/api/estimator/result/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (res.ok) {
      payload = (await res.json()) as ResultPayload;
    } else {
      errorStatus = res.status;
    }
  } catch (err) {
    console.error("[estimator results] fetch failed", err);
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <section className="rounded-3xl border border-t-border bg-surface p-8 shadow-card">
          <h1 className="text-2xl font-semibold tracking-tight">
            {errorStatus === 410 ? "This link has expired" : "We couldn't find that estimate"}
          </h1>
          <p className="mt-3 text-sm text-muted">
            Estimate links are valid for a limited time. Please start a new estimate.
          </p>
          <a
            href="/estimator"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
          >
            Start a new estimate
          </a>
        </section>
      </div>
    );
  }

  if (payload.outOfArea || payload.manualQuoteRequest || !payload.result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <section className="rounded-3xl border border-t-border bg-surface p-8 shadow-card">
          <h1 className="text-2xl font-semibold tracking-tight">
            Thanks{payload.firstName ? `, ${payload.firstName}` : ""} — we&apos;ll be in touch
          </h1>
          <p className="mt-3 text-sm text-muted">
            {payload.outOfArea
              ? "You're on our waitlist. We'll reach out the moment Photon Brothers arrives in your area."
              : "A solar advisor will reach out within one business day with a custom quote."}
          </p>
          <a
            href="https://www.photonbrothers.com"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
          >
            Back to photonbrothers.com
          </a>
        </section>
      </div>
    );
  }

  // Dispatch to simpler view for EV charger / battery / system expansion.
  if (
    payload.quoteType === "ev_charger" ||
    payload.quoteType === "battery" ||
    payload.quoteType === "system_expansion"
  ) {
    const result = (payload.result ?? {}) as OtherQuoteResult;
    return (
      <OtherQuoteResultsView
        firstName={payload.firstName}
        quoteType={payload.quoteType}
        result={result}
      />
    );
  }

  // Narrow: input must be EstimatorInput when we have a result + quote path.
  const input = payload.input as EstimatorInput;

  return (
    <ResultsView
      token={payload.token}
      firstName={payload.firstName}
      initialInput={input}
      initialResult={payload.result}
    />
  );
}
