"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function OutOfAreaPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-16 sm:px-6" />}>
      <OutOfAreaInner />
    </Suspense>
  );
}

function OutOfAreaInner() {
  const searchParams = useSearchParams();
  const zip = searchParams.get("zip") ?? "";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!firstName || !lastName || !email || !zip) {
      setError("Please fill in all fields.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "out_of_area",
          zip,
          contact: { firstName, lastName, email },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Submission failed. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-20">
      <section className="relative overflow-hidden rounded-3xl border border-t-border bg-surface p-6 shadow-card-lg sm:p-10">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-orange-500/60 to-transparent"
        />
        {submitted ? (
          <>
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l4 4 10-10" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              You&apos;re on the list
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              Thanks — we&apos;ll let you know the moment Photon Brothers expands into{" "}
              {zip || "your area"}.
            </p>
            <a
              href="https://www.photonbrothers.com"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
            >
              Back to photonbrothers.com
              <span aria-hidden>→</span>
            </a>
          </>
        ) : (
          <>
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              We&apos;re not there yet.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
              Photon Brothers doesn&apos;t currently serve {zip ? `ZIP ${zip}` : "your area"} —
              but we expand regularly. Join the waitlist and we&apos;ll notify you the day we
              arrive.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="First name" value={firstName} onChange={setFirstName} />
              <Field label="Last name" value={lastName} onChange={setLastName} />
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {submitting ? "Joining…" : "Join the waitlist"}
                {!submitting && <span aria-hidden>→</span>}
              </button>
              {error && <span className="text-sm text-red-500">{error}</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
      />
    </label>
  );
}
