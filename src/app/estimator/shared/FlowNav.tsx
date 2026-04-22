"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Flow = {
  href: string;
  label: string;
  icon: string;
  match: RegExp;
};

const FLOWS: Flow[] = [
  { href: "/estimator/new-install?step=address", label: "New install", icon: "☀", match: /^\/estimator\/new-install/ },
  { href: "/estimator/ev-charger?step=address", label: "EV charger", icon: "⚡", match: /^\/estimator\/ev-charger/ },
  { href: "/estimator/battery?step=address", label: "Battery", icon: "🔋", match: /^\/estimator\/battery/ },
  { href: "/estimator/system-expansion?step=address", label: "Expansion", icon: "＋", match: /^\/estimator\/system-expansion/ },
  { href: "/estimator/detach-reset?step=from-address", label: "Detach & reset", icon: "↔", match: /^\/estimator\/detach-reset/ },
];

/**
 * Thin tab strip that lets customers switch between quote types without
 * bouncing back to `/estimator`. Hidden on results pages (they're specific
 * to a submitted quote) and in embed mode (parent iframe can't spare the
 * vertical real estate, and the parent already provides its own nav).
 */
export default function FlowNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEmbedded = searchParams?.get("embed") === "1";
  const embedSuffix = isEmbedded ? "&embed=1" : "";

  // Hide inside embed (parent iframe owns chrome) and on results pages.
  if (isEmbedded) return null;
  if (!pathname || pathname.startsWith("/estimator/results")) return null;
  if (pathname.startsWith("/estimator/out-of-area")) return null;

  return (
    <nav aria-label="Quote types" className="border-b border-t-border bg-surface-2">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {FLOWS.map((flow) => {
          const active = flow.match.test(pathname);
          return (
            <Link
              key={flow.href}
              href={`${flow.href}${embedSuffix}`}
              aria-current={active ? "page" : undefined}
              className={
                "group inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition " +
                (active
                  ? "bg-orange-500/10 text-orange-500"
                  : "text-muted hover:bg-surface-elevated hover:text-foreground")
              }
            >
              <span aria-hidden className="text-base leading-none">
                {flow.icon}
              </span>
              <span className="whitespace-nowrap">{flow.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
