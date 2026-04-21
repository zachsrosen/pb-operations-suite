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
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6 sm:py-16">
      <section className="rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
        {submitted ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">You&apos;re on the list</h1>
            <p className="mt-3 text-sm text-muted">
              Thanks — we&apos;ll let you know the moment Photon Brothers expands into {zip || "your area"}.
            </p>
            <a
              href="https://www.photonbrothers.com"
              className="mt-6 inline-flex rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-orange-600"
            >
              Back to photonbrothers.com
            </a>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">We&apos;re not there yet</h1>
            <p className="mt-2 text-sm text-muted">
              Photon Brothers doesn&apos;t currently serve {zip ? `ZIP ${zip}` : "your area"} — but we
              expand regularly. Join our waitlist and we&apos;ll notify you when we arrive.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="First name" value={firstName} onChange={setFirstName} />
              <Field label="Last name" value={lastName} onChange={setLastName} />
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-sm font-medium">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-orange-600 disabled:opacity-50"
              >
                {submitting ? "Joining…" : "Join the waitlist"}
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
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
      />
    </label>
  );
}
