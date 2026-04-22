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
  title = "Where should we send your estimate?",
  subtitle = "We'll email your results and follow up to schedule a consult.",
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
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        footer={
          <>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : submitLabel ?? "Get my estimate"}
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
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Project notes (optional)</span>
            <textarea
              rows={3}
              value={contact.notes}
              onChange={(e) => setContact({ notes: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
          </label>
          {showMessageField && (
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-sm font-medium">
                {messageLabel ?? "Anything we should know? (optional)"}
              </span>
              <textarea
                rows={3}
                value={messageValue ?? ""}
                onChange={(e) => onMessageChange?.(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              />
            </label>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">
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
