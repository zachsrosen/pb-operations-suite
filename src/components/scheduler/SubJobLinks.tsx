"use client";

import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { SYSTEM_TAGS, SYSTEM_TAG_CLASSES, zuperJobUrl } from "@/lib/scheduler-subjobs";

interface SubJobLinksProps {
  subJobs?: SubJobInfo[];
  zuperJobUid?: string;
  zuperWebBaseUrl: string;
  variant: "button" | "compact";
}

/**
 * Renders one Zuper job link per construction sub-job (PV / ESS / EV) for split
 * deals, falling back to a single "Zuper" link when only a legacy job exists.
 * Used by the construction scheduler's detail panel, list view, and schedule modal.
 */
export function SubJobLinks({
  subJobs,
  zuperJobUid,
  zuperWebBaseUrl,
  variant,
}: SubJobLinksProps) {
  const typed = (subJobs ?? []).filter((sj) => sj.jobUid);

  // No split jobs — preserve the existing single-link behavior.
  if (typed.length === 0) {
    if (!zuperJobUid) return null;
    return (
      <SubJobLinkAnchor
        href={zuperJobUrl(zuperWebBaseUrl, zuperJobUid)}
        label="Zuper"
        variant={variant}
        tagClass={SYSTEM_TAG_CLASSES.legacy}
      />
    );
  }

  return (
    <>
      {typed.map((sj) => (
        <SubJobLinkAnchor
          key={sj.jobUid}
          href={zuperJobUrl(zuperWebBaseUrl, sj.jobUid)}
          label={SYSTEM_TAGS[sj.systemType]}
          variant={variant}
          tagClass={SYSTEM_TAG_CLASSES[sj.systemType]}
        />
      ))}
    </>
  );
}

function SubJobLinkAnchor({
  href,
  label,
  variant,
  tagClass,
}: {
  href: string;
  label: string;
  variant: "button" | "compact";
  tagClass: string;
}) {
  const className =
    variant === "button"
      ? `flex-1 text-center px-3 py-1.5 text-xs rounded-md ${tagClass} hover:brightness-125`
      : `px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide rounded ${tagClass} hover:brightness-125`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`Open ${label} job in Zuper`}
    >
      {label}
    </a>
  );
}
