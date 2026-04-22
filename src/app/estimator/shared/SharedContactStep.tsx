"use client";

import Script from "next/script";
import { useState } from "react";

import StepLayout from "./StepLayout";

export type SharedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  referredBy: string;
  notes: string;
};

export const INITIAL_CONTACT: SharedContact = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  referredBy: "",
  notes: "",
};

type Grecaptcha = {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
};

export async function getRecaptchaToken(): Promise<string | undefined> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
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

type Props = {
  title?: string;
  subtitle?: string;
  contact: SharedContact;
  setContact: (patch: Partial<SharedContact>) => void;
  onBack?: () => void;
  onSubmit: (recaptchaToken: string | undefined) => Promise<void>;
  submitting: boolean;
  error: string | null;
  submitLabel?: string;
  showMessageField?: boolean;
  messageLabel?: string;
  messageValue?: string;
  onMessageChange?: (v: string) => void;
};

export default function SharedContactStep({
  title = "Where should we send it?",
  subtitle = "We'll email your estimate in seconds and follow up to schedule a consult.",
  contact,
  setContact,
  onBack,
  onSubmit,
  submitting,
  error,
  submitLabel,
  showMessageField,
  messageLabel,
  messageValue,
  onMessageChange,
}: Props) {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!contact.firstName || !contact.lastName || !contact.email || !contact.phone) {
      setLocalError("Please fill in your name, email, and phone.");
      return;
    }
    setLocalError(null);
    const token = await getRecaptchaToken();
    await onSubmit(token);
  }

  const displayError = localError ?? error;

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
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        footer={
          <>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {submitting ? "Submitting…" : submitLabel ?? "Get my estimate"}
              {!submitting && <span aria-hidden>→</span>}
            </button>
            {displayError && <span className="text-sm text-red-500">{displayError}</span>}
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
              placeholder="Anything we should know? Timing, preferences, questions…"
              value={contact.notes}
              onChange={(e) => setContact({ notes: e.target.value })}
              className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
            />
          </label>
          {showMessageField && (
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium">
                {messageLabel ?? "Anything we should know? (optional)"}
              </span>
              <textarea
                rows={3}
                value={messageValue ?? ""}
                onChange={(e) => onMessageChange?.(e.target.value)}
                className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
              />
            </label>
          )}
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
          <a href="https://policies.google.com/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="https://policies.google.com/terms" className="underline hover:text-foreground">
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
