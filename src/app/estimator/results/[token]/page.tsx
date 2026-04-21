import { headers } from "next/headers";

import type { EstimatorInput, EstimatorResult } from "@/lib/estimator";

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
        <section className="rounded-2xl border border-t-border bg-surface p-8 shadow-card">
          <h1 className="text-2xl font-semibold tracking-tight">
            {errorStatus === 410 ? "This link has expired" : "We couldn't find that estimate"}
          </h1>
          <p className="mt-3 text-sm text-muted">
            Estimate links are valid for a limited time. Please start a new estimate.
          </p>
          <a
            href="/estimator"
            className="mt-6 inline-flex rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-orange-600"
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
        <section className="rounded-2xl border border-t-border bg-surface p-8 shadow-card">
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
            className="mt-6 inline-flex rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-orange-600"
          >
            Back to photonbrothers.com
          </a>
        </section>
      </div>
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
