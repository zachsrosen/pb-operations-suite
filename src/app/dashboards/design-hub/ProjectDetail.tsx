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

  const { deal, revisions, revisionReasons, assignment, statusHistory, activity } =
    query.data;

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
        <QuickLinks deal={deal} dealId={dealId} />
      </Section>

      <Section title="Revisions">
        <div className="flex flex-wrap gap-3 text-xs">
          <Counter label="Total" value={revisions.total} />
          <Counter label="DA" value={revisions.da} />
          <Counter label="Permit" value={revisions.permit} />
          <Counter label="Utility" value={revisions.interconnection} />
          <Counter label="As-Built" value={revisions.asBuilt} />
          <Counter label="IDR" value={revisions.idr} />
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
        {revisionReasons.length > 0 && (
          <dl className="mt-3 space-y-1.5">
            {revisionReasons.map((r) => (
              <div key={r.label} className="text-xs">
                <dt className="text-muted font-medium">{r.label}</dt>
                <dd className="text-foreground whitespace-pre-wrap">
                  {r.reason}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Status History">
        <div className="grid grid-cols-2 gap-x-4">
          <StatusHistoryColumn
            title="Design"
            entries={statusHistory.filter((h) => h.property === "design_status")}
          />
          <StatusHistoryColumn
            title="Design Approval"
            entries={statusHistory.filter((h) => h.property === "layout_status")}
          />
        </div>
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

/** One status timeline (Design or Design-Approval), newest first. Rendered as
 *  two of these side by side so the two streams read independently rather than
 *  interleaved. */
function StatusHistoryColumn({
  title,
  entries,
}: {
  title: string;
  entries: Detail["statusHistory"];
}) {
  return (
    <div>
      <div className="text-muted mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </div>
      {entries.length === 0 ? (
        <p className="text-muted text-xs">No history.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.slice(0, 25).map((h, i) => (
            <li key={`${h.timestamp}-${i}`} className="text-xs">
              <div className="text-muted">{formatDateTime(h.timestamp)}</div>
              <div className="text-foreground">
                {h.valueLabel ?? h.value ?? "—"}
              </div>
            </li>
          ))}
        </ul>
      )}
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

/**
 * Quick-links row — the same set the IDR meeting hub shows when a project is
 * enlarged (Jacob's request), plus the design-specific tools. Each chip
 * renders only when its URL exists; the DA chip is fetched client-side; the
 * "Open all" button opens every present link in its own tab.
 */
function QuickLinks({
  deal,
  dealId,
}: {
  deal: Detail["deal"];
  dealId: string;
}) {
  // Ordered to match the IDR hub, with the design tools appended.
  const links: Array<{ label: string; href: string }> = [
    { label: "HubSpot", href: deal.hubspotUrl },
    ...(deal.designFolderUrl
      ? [{ label: "Design", href: deal.designFolderUrl }]
      : []),
    ...(deal.surveyFolderUrl
      ? [{ label: "Survey", href: deal.surveyFolderUrl }]
      : []),
    ...(deal.salesFolderUrl
      ? [{ label: "Sales", href: deal.salesFolderUrl }]
      : []),
    ...(deal.driveFolderUrl
      ? [{ label: "Drive", href: deal.driveFolderUrl }]
      : []),
    ...(deal.openSolarUrl
      ? [{ label: "OpenSolar", href: deal.openSolarUrl }]
      : []),
    ...(deal.vishtikUrl ? [{ label: "Vishtik", href: deal.vishtikUrl }] : []),
    ...(deal.trueDesignUrl
      ? [{ label: "TrueDesign", href: deal.trueDesignUrl }]
      : []),
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <QuickLink key={l.label} href={l.href} label={l.label} />
      ))}
      <DaChip dealId={dealId} />
      {links.length > 1 && (
        <button
          type="button"
          onClick={() => {
            for (const l of links) {
              window.open(l.href, "_blank", "noopener,noreferrer");
            }
          }}
          title={`Open all ${links.length} links in new tabs`}
          className="inline-flex items-center gap-0.5 rounded border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-[11px] font-semibold text-orange-600 transition-colors hover:bg-orange-500/20 dark:text-orange-300"
        >
          Open all ({links.length}) ↗
        </button>
      )}
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium hover:bg-surface-elevated"
    >
      {label}
    </a>
  );
}

/** PandaDoc DA chip — reuses the IDR meeting endpoint (in the /api/idr-meeting
 *  allowlist for these roles). Renders nothing when there's no DA or the call
 *  fails, so it's safe for roles without idr-meeting access. */
function DaChip({ dealId }: { dealId: string }) {
  const { data } = useQuery({
    queryKey: [...queryKeys.designHub.root, "da-chip", dealId],
    queryFn: async () => {
      const r = await fetch(`/api/idr-meeting/pandadoc-da/${dealId}`);
      if (!r.ok) return null;
      return (await r.json()) as {
        da: { status: string; url: string } | null;
      };
    },
    staleTime: 5 * 60 * 1000,
  });
  const da = data?.da;
  if (!da) return null;
  return (
    <a
      href={da.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted rounded-lg border border-t-border bg-surface-2 px-2.5 py-1 text-xs font-medium hover:bg-surface-elevated"
    >
      DA: {da.status} ↗
    </a>
  );
}
