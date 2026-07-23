"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail as Detail, Tab } from "@/lib/design-hub/types";
import { ACCENTS, type Accent } from "./accents";
import { AssignDialog } from "./AssignDialog";
import { StatusDropdown } from "./StatusDropdown";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ProjectDetail({
  tab,
  dealId,
  accent,
}: {
  tab: Tab;
  dealId: string;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  const [assigning, setAssigning] = useState(false);

  const query = useQuery<Detail>({
    queryKey: queryKeys.designHub.project(tab, dealId),
    queryFn: async () => {
      const r = await fetch(`/api/design-hub/project/${dealId}?tab=${tab}`);
      if (!r.ok) throw new Error("Failed to load project");
      return r.json();
    },
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return <div className="text-muted p-4 text-sm">Loading project…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400">
        Could not load this project.
      </div>
    );
  }

  const { deal, revisions, assignment, statusHistory, activity } = query.data;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-t-border p-4">
        <div className="min-w-0">
          <h2 className="text-foreground truncate text-base font-semibold">
            {deal.name}
          </h2>
          {deal.address && (
            <p className="text-muted truncate text-sm">{deal.address}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${a.primaryButton}`}
          >
            Assign
          </button>
          <a
            href={deal.hubspotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium hover:bg-surface-elevated"
          >
            HubSpot
          </a>
        </div>
      </div>

      {assignment && (
        <div className="border-b border-t-border bg-surface-2 px-4 py-2.5 text-xs">
          <span className="text-foreground font-medium">
            Assigned to {assignment.assigneeName}
          </span>
          <span className="text-muted"> by {assignment.assignedBy}</span>
          {assignment.note && (
            <p className="text-foreground mt-1 italic">“{assignment.note}”</p>
          )}
          {assignment.statusMoved && (
            <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">
              Status moved since assigned (was{" "}
              {assignment.statusAtAssignmentLabel})
            </p>
          )}
        </div>
      )}

      <Section title="Overview">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field label="Status">
            <StatusDropdown
              tab={tab}
              dealId={dealId}
              current={deal.status}
              currentLabel={deal.statusLabel}
              accent={accent}
            />
          </Field>
          <Field label={tab === "design" ? "Design Approval" : "Design"}>
            {deal.otherStatusLabel ?? "—"}
          </Field>
          <Field label="Stage">{deal.dealStage ?? "—"}</Field>
          <Field label="Location">{deal.pbLocation ?? "—"}</Field>
          <Field label="Design Lead">{deal.lead ?? "Unassigned"}</Field>
          <Field label="PM">{deal.pm ?? "—"}</Field>
          <Field label="System">
            {deal.systemSizeKw !== null ? `${deal.systemSizeKw} kW` : "—"}
          </Field>
          <Field label="Amount">
            {deal.amount !== null
              ? `$${deal.amount.toLocaleString()}`
              : "—"}
          </Field>
        </dl>
        {(deal.designFolderUrl ||
          deal.driveFolderUrl ||
          deal.openSolarUrl ||
          deal.vishtikUrl ||
          deal.trueDesignUrl) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {deal.designFolderUrl && (
              <FolderLink href={deal.designFolderUrl} label="Design Files" />
            )}
            {deal.driveFolderUrl && (
              <FolderLink href={deal.driveFolderUrl} label="Project Folder" />
            )}
            {deal.openSolarUrl && (
              <FolderLink href={deal.openSolarUrl} label="OpenSolar" />
            )}
            {deal.vishtikUrl && (
              <FolderLink href={deal.vishtikUrl} label="Vishtik" />
            )}
            {deal.trueDesignUrl && (
              <FolderLink href={deal.trueDesignUrl} label="TrueDesign PDF" />
            )}
          </div>
        )}
      </Section>

      <Section title="Revisions">
        <div className="flex flex-wrap gap-3 text-xs">
          <Counter label="Total" value={revisions.total} />
          <Counter label="Counter" value={revisions.counter} />
          <Counter label="DA" value={revisions.da} />
          <Counter label="Permit" value={revisions.permit} />
          <Counter label="Utility" value={revisions.interconnection} />
          <Counter label="As-Built" value={revisions.asBuilt} />
        </div>
        {revisions.mismatch && (
          // This is the condition that blocks design closeout — the hub is
          // where a coordinator first meets the deal, so it is surfaced rather
          // than left to be discovered at closeout time.
          <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
            Counters disagree — closeout will be blocked until the sub-counters
            are reattributed.
          </p>
        )}
      </Section>

      <Section title="Status History">
        {statusHistory.length === 0 ? (
          <p className="text-muted text-xs">No history available.</p>
        ) : (
          <ul className="space-y-1.5">
            {statusHistory.slice(0, 25).map((h, i) => (
              <li
                key={`${h.property}-${h.timestamp}-${i}`}
                className="flex items-baseline gap-2 text-xs"
              >
                <span className="text-muted w-28 shrink-0">
                  {formatDateTime(h.timestamp)}
                </span>
                <span className="text-muted w-32 shrink-0 truncate">
                  {h.propertyLabel}
                </span>
                <span className="text-foreground truncate">
                  {h.valueLabel ?? h.value ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activity">
        {activity.length === 0 ? (
          <p className="text-muted text-xs">No recent activity.</p>
        ) : (
          <ul className="space-y-2">
            {activity.slice(0, 20).map((e) => (
              <li key={e.id} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted w-28 shrink-0">
                    {formatDateTime(e.timestamp)}
                  </span>
                  <span className="text-foreground truncate font-medium">
                    {e.subject || e.type}
                  </span>
                </div>
                {e.body && (
                  <p className="text-muted mt-0.5 line-clamp-2 pl-30">
                    {e.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {assigning && (
        <AssignDialog
          tab={tab}
          dealId={dealId}
          currentStatus={deal.status}
          accent={accent}
          onClose={() => setAssigning(false)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-t-border p-4">
      <h3 className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-foreground mt-0.5">{children}</dd>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
      <div className="text-muted text-[10px] uppercase">{label}</div>
      <div className="text-foreground text-sm font-semibold">
        {value ?? "—"}
      </div>
    </div>
  );
}

function FolderLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-surface-elevated"
    >
      {label}
    </a>
  );
}
