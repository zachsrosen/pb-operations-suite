"use client";

import { useState } from "react";

import type { AddressParts, Location } from "@/lib/estimator";

import StepLayout from "./StepLayout";

type Props = {
  address: AddressParts;
  location: Location;
  onBack: () => void;
};

export default function UtilityFallback({ address, location, onBack }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!firstName || !lastName || !email || !phone) {
      setError("Please fill in your name, email, and phone.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "manual_quote_request",
          address,
          location,
          contact: {
            firstName,
            lastName,
            email,
            phone,
            notes: message || undefined,
          },
          message: message || undefined,
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

  if (submitted) {
    return (
      <StepLayout title="Thanks — we'll be in touch" subtitle="A solar advisor will reach out within one business day with a custom quote.">
        <p className="text-sm text-muted">
          In the meantime, you can explore more at{" "}
          <a
            href="https://www.photonbrothers.com"
            className="underline hover:text-foreground"
          >
            photonbrothers.com
          </a>
          .
        </p>
      </StepLayout>
    );
  }

  return (
    <StepLayout
      title="Request a custom quote"
      subtitle="Your utility isn't in our quick-quote list yet, but we can still help. Drop your info and a solar advisor will reach out."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600 disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Request quote"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name" value={firstName} onChange={setFirstName} />
        <Field label="Last name" value={lastName} onChange={setLastName} />
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Phone" type="tel" value={phone} onChange={setPhone} />
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm font-medium">Anything else we should know? (optional)</span>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
          />
        </label>
      </div>
    </StepLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
      />
    </label>
  );
}
