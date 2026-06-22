"use client";

import type { FlowEntry, ProgressionLink } from "@/lib/flow-map/types";
import { FlowStatusPill } from "./FlowStatusPill";
import ProgressionLinks from "./ProgressionLinks";
import { cloneBaseName } from "./flow-map-utils";

type ViewMode = "plain" | "technical";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

const ENROLLMENT_LABELS: Record<FlowEntry["enrollmentType"], string> = {
  LIST_BASED: "List-based",
  EVENT_BASED: "Event-based",
  MANUAL: "Manual",
  DATASET: "Dataset",
};

export default function FlowDetail({
  flow,
  on,
  view,
  links,
  onOpenFlowByName,
}: {
  flow: FlowEntry;
  /**
   * Family-aggregate enabled state for the header pill: true if any clone in
   * this flow's family is enabled. The body still reflects the representative
   * `flow`'s trigger/actions.
   */
  on: boolean;
  view: ViewMode;
  /** All progression links from the snapshot; ProgressionLinks filters them. */
  links: ProgressionLink[];
  /** Opens another flow by its clone-base name (cross-flow navigation). */
  onOpenFlowByName: (name: string) => void;
}) {
  const technical = view === "technical";
  const trigger = technical ? flow.triggerTechnical : flow.trigger;
  const actions = technical ? flow.actionsTechnical : flow.actions;

  return (
    <div className="space-y-5 rounded-xl border border-t-border bg-surface-2 p-5 shadow-card">
      {/* Header — name, status, enrollment. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {cloneBaseName(flow.name)}
          </h2>
          <FlowStatusPill on={on} />
        </div>
        <div className="text-xs text-muted">
          {ENROLLMENT_LABELS[flow.enrollmentType] ?? flow.enrollmentType}{" "}
          enrollment
        </div>
      </div>

      <Section title="When it runs">
        <p className="text-sm text-foreground/90">
          {trigger || (
            <span className="text-muted">No trigger description.</span>
          )}
        </p>
      </Section>

      <Section title="What it does">
        {actions.length > 0 ? (
          <ol className="space-y-1.5">
            {actions.map((step, i) => (
              <li
                key={i}
                className="flex gap-2.5 text-sm text-foreground/90"
              >
                <span className="mt-0.5 shrink-0 text-xs text-muted tabular-nums">
                  {i + 1}.
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No actions recorded.</p>
        )}
      </Section>

      {/* Technical-only metadata + HubSpot deep link. */}
      {technical && (
        <Section title="Technical">
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2">
              <dt className="text-muted">Flow id</dt>
              <dd className="font-mono text-foreground/90 break-all">
                {flow.id}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Revision</dt>
              <dd className="font-mono text-foreground/90 break-all">
                {flow.revisionId}
              </dd>
            </div>
          </dl>
          {flow.hubspotUrl && (
            <a
              href={flow.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
            >
              View in HubSpot ↗
            </a>
          )}
        </Section>
      )}

      {/* Cross-flow progression links — status hand-offs in/out of this flow. */}
      <ProgressionLinks
        flow={flow}
        links={links}
        onOpenFlowByName={onOpenFlowByName}
      />
    </div>
  );
}
