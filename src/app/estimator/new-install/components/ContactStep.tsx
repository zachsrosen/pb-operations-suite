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
        eyebrow="Almost there"
        title="Where should we send it?"
        subtitle="We'll email your estimate in seconds and a Photon Brothers advisor will follow up to refine the numbers."
        onBack={onBack}
        footer={
          <>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {submitting ? "Building your estimate…" : "See my estimate"}
              {!submitting && <span aria-hidden>→</span>}
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
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">
              Project notes <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              rows={3}
              placeholder="Anything we should know? Garage roof, specific panel count, timing…"
              value={contact.notes}
              onChange={(e) => setContact({ notes: e.target.value })}
              className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
            />
          </label>
        </div>
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-t-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold">No spam, ever.</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              We&apos;ll use your info only to build and deliver your estimate. You control any
              future contact.
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted">
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
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
      />
    </label>
  );
}
