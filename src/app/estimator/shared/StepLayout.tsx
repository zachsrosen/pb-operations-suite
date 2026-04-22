"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
};

export default function StepLayout({ title, subtitle, onBack, footer, children }: Props) {
  return (
    <section className="rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
      <div className="flex flex-col gap-1">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="self-start text-xs text-muted hover:text-foreground"
          >
            ← Back
          </button>
        )}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-8 flex flex-wrap items-center gap-3">{footer}</div>}
    </section>
  );
}
