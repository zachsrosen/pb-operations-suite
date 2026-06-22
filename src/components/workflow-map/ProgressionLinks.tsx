"use client";

import type { FlowEntry, ProgressionLink } from "@/lib/flow-map/types";
import { cloneBaseName } from "./flow-map-utils";

/** A status hand-off group: a status label and the flow base-names under it. */
export type ProgressionGroup = { label: string; names: string[] };

/**
 * Pure derivation of a flow's cross-flow progression links, keyed by clone-base
 * name. Used by the component and unit-tested directly.
 *
 * - `triggers` (downstream): links where `baseName` is a setter — the
 *   `firesFlows` (minus self) are flows this flow triggers via that status.
 * - `fedBy` (upstream): links where `baseName` is in `firesFlows` — the `setBy`
 *   (minus self) are flows that feed this one by setting the status it waits on.
 *
 * Groups with no remaining flow names after self-exclusion are dropped.
 */
export function deriveProgression(
  baseName: string,
  links: ProgressionLink[],
): { triggers: ProgressionGroup[]; fedBy: ProgressionGroup[] } {
  const triggers: ProgressionGroup[] = [];
  const fedBy: ProgressionGroup[] = [];

  for (const link of links) {
    if (link.setBy.includes(baseName)) {
      const names = link.firesFlows.filter((n) => n !== baseName);
      if (names.length > 0) triggers.push({ label: link.label, names });
    }
    if (link.firesFlows.includes(baseName)) {
      const names = link.setBy.filter((n) => n !== baseName);
      if (names.length > 0) fedBy.push({ label: link.label, names });
    }
  }

  return { triggers, fedBy };
}

function ChipGroup({
  groups,
  onOpenFlowByName,
}: {
  groups: ProgressionGroup[];
  onOpenFlowByName: (name: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {groups.map((group, i) => (
        <li key={`${group.label}-${i}`} className="space-y-1">
          <div className="text-xs text-muted">{group.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {group.names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onOpenFlowByName(name)}
                className="rounded-full border border-t-border bg-surface px-2.5 py-1 text-xs text-foreground/90 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
              >
                {name}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ProgressionLinks({
  flow,
  links,
  onOpenFlowByName,
}: {
  flow: FlowEntry;
  links: ProgressionLink[];
  onOpenFlowByName: (name: string) => void;
}) {
  const { triggers, fedBy } = deriveProgression(cloneBaseName(flow.name), links);

  if (triggers.length === 0 && fedBy.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Hand-offs
        </h3>
        <p className="text-sm text-muted">No status hand-offs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {triggers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Triggers
          </h3>
          <ChipGroup groups={triggers} onOpenFlowByName={onOpenFlowByName} />
        </div>
      )}
      {fedBy.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Fed by
          </h3>
          <ChipGroup groups={fedBy} onOpenFlowByName={onOpenFlowByName} />
        </div>
      )}
    </div>
  );
}
