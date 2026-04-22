"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import { useState, type Dispatch } from "react";

import type { QuoteRequest } from "@/lib/estimator";

import { clearDraft, type WizardAction, type WizardState } from "../state";
import StepLayout from "./StepLayout";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onBack: () => void;
};

type Grecaptcha = {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
};

export default function ContactStep({ state, dispatch, onBack }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const embedSuffix = searchParams?.get("embed") === "1" ? "?embed=1" : "";
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { contact } = state;
  const setContact = (patch: Partial<typeof contact>) =>
    dispatch({ type: "setContact", value: { ...contact, ...patch } });

  function buildQuoteRequest(): QuoteRequest | null {
    if (!state.normalizedAddress || !state.location || !state.utilityId) return null;
    if (!state.usage || !state.roofType || !state.shade || state.heatPump === null) return null;
    return {
      address: state.normalizedAddress,
      location: state.location,
      utilityId: state.utilityId,
      usage: state.usage,
      home: {
        roofType: state.roofType,
        shade: state.shade,
        heatPump: state.heatPump,
      },
      considerations: state.considerations,
      addOns: { evCharger: false, panelUpgrade: false },
    };
  }

  async function getRecaptchaToken(): Promise<string | undefined> {
    if (!siteKey) return undefined;
    const g = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
    if (!g) return undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        g.ready(() => {
          g.execute(siteKey, { action: "estimator_submit" })
            .then(resolve)
            .catch(reject);
        });
      });
    } catch (err) {
      console.warn("recaptcha failed", err);
      return undefined;
    }
  }

  async function submit(): Promise<void> {
    if (!contact.firstName || !contact.lastName || !contact.email || !contact.phone) {
      setError("Please fill in your name, email, and phone.");
      return;
    }
    const quote = buildQuoteRequest();
    if (!quote) {
      setError("Something went wrong. Please start over.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const recaptchaToken = await getRecaptchaToken();
      const res = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "quote",
          quote,
          contact: {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            referredBy: contact.referredBy || undefined,
            notes: contact.notes || undefined,
          },
          recaptchaToken,
        }),
      });
      if (res.status === 429) {
        setError("Too many submissions. Please try again later.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not build your estimate. Please try again.");
        return;
      }
      const data = (await res.json()) as { token: string };
      clearDraft();
      router.push(`/estimator/results/${data.token}${embedSuffix}`);
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {siteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${siteKey}`}
          strategy="afterInteractive"
        />
      )}
      <StepLayout
        title="Where should we send your estimate?"
        subtitle="We'll email your results and follow up to schedule a consult."
        onBack={onBack}
        footer={
          <>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? "Building your estimate…" : "See my estimate"}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="First name"
            value={contact.firstName}
            onChange={(v) => setContact({ firstName: v })}
          />
          <Field
            label="Last name"
            value={contact.lastName}
            onChange={(v) => setContact({ lastName: v })}
          />
          <Field
            label="Email"
            type="email"
            value={contact.email}
            onChange={(v) => setContact({ email: v })}
          />
          <Field
            label="Phone"
            type="tel"
            value={contact.phone}
            onChange={(v) => setContact({ phone: v })}
          />
          <Field
            label="Referred by (optional)"
            value={contact.referredBy}
            onChange={(v) => setContact({ referredBy: v })}
          />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Project notes (optional)</span>
            <textarea
              rows={3}
              value={contact.notes}
              onChange={(e) => setContact({ notes: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
          </label>
        </div>
        <p className="mt-4 text-xs text-muted">
          By submitting, you agree to be contacted by Photon Brothers about your estimate. This site
          is protected by reCAPTCHA and the Google{" "}
          <a
            href="https://policies.google.com/privacy"
            className="underline hover:text-foreground"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="https://policies.google.com/terms"
            className="underline hover:text-foreground"
          >
            Terms of Service
          </a>{" "}
          apply.
        </p>
      </StepLayout>
    </>
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
