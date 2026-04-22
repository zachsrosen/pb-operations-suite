"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

interface Props {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Renders the estimator with or without Photon Brothers chrome based on the
 * `?embed=1` query param. When embedded inside the photonbrothers.com iframe,
 * the parent site provides its own nav + footer; we strip ours so the
 * customer doesn't see PB branding twice.
 *
 * A `?embed=1` flag set on ANY step propagates to sibling routes because the
 * wizard always re-reads it from the current URL via useSearchParams.
 */
export default function EstimatorEmbedBody(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background text-foreground flex flex-col">
          <main className="flex-1">{props.children}</main>
        </div>
      }
    >
      <EmbedAwareShell {...props} />
    </Suspense>
  );
}

function EmbedAwareShell({ header, footer, children }: Props) {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams?.get("embed") === "1";

  if (isEmbedded) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main>{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {header}
      <main className="flex-1">{children}</main>
      {footer}
    </div>
  );
}
