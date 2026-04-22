"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  footer?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
};

export default function StepLayout({
  title,
  subtitle,
  onBack,
  footer,
  eyebrow,
  children,
}: Props) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-t-border bg-surface shadow-card">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-orange-500/60 to-transparent"
      />
      <div className="p-6 sm:p-10">
        <div className="flex flex-col gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="group -ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted transition hover:text-foreground"
            >
              <span className="transition-transform group-hover:-translate-x-0.5">←</span> Back
            </button>
          )}
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-orange-500">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && (
            <p className="max-w-xl text-sm leading-relaxed text-muted sm:text-[15px]">{subtitle}</p>
          )}
        </div>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-10 flex flex-wrap items-center gap-3">{footer}</div>}
      </div>
    </section>
  );
}
