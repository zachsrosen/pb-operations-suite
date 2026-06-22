"use client";

import { useMemo, useState } from "react";
import { detectDrift } from "@/lib/flow-map/drift";

type BadgeKey = "off" | "missing" | "undoc";

const BADGE_LABEL: Record<BadgeKey, (n: number) => string> = {
  off: (n) => `${n} documented · now off`,
  missing: (n) => `${n} documented · missing`,
  undoc: (n) => `${n} live · undocumented`,
};

const PANEL_TITLE: Record<BadgeKey, string> = {
  off: "Documented in the SOP but the live flow is OFF",
  missing: "Documented in the SOP but no matching live flow",
  undoc: "Live (enabled) flow with no SOP coverage",
};

/**
 * Drift badges for a stage. Diffs the stage's SOP section HTML against the
 * live flows enrolled at that stage (client-side, memoized) and surfaces up to
 * three warning badges. Clicking a badge expands its name list.
 *
 * `htmls` come from the same SOP fetch the Process pane uses (lifted into
 * StagePanes), so no extra request is made here. Only Project stages pass
 * non-empty `htmls`; other stages render nothing.
 */
export default function DriftBadges({
  htmls,
  liveStageFlows,
}: {
  htmls: string[];
  liveStageFlows: { name: string; isEnabled: boolean }[];
}) {
  const [open, setOpen] = useState<BadgeKey | null>(null);

  const drift = useMemo(
    () => detectDrift(htmls, liveStageFlows),
    [htmls, liveStageFlows],
  );

  const buckets: { key: BadgeKey; names: string[] }[] = [
    { key: "off", names: drift.documentedButOff },
    { key: "missing", names: drift.documentedButMissing },
    { key: "undoc", names: drift.liveButUndocumented },
  ];

  const active = buckets.filter((b) => b.names.length > 0);
  if (active.length === 0) return null;

  const openBucket = open ? active.find((b) => b.key === open) : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {active.map(({ key, names }) => {
          const selected = open === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setOpen(selected ? null : key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}
              aria-expanded={selected}
            >
              {BADGE_LABEL[key](names.length)}
            </button>
          );
        })}
      </div>

      {openBucket && (
        <div className="rounded-lg border border-amber-500/30 bg-surface-2/60 p-3">
          <p className="text-xs font-semibold text-muted">
            {PANEL_TITLE[openBucket.key]}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {openBucket.names.map((name) => (
              <li key={name} className="text-sm text-foreground">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
