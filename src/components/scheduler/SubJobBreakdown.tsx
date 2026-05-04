"use client";

import type { SubJobInfo } from "@/lib/scheduler-subjobs";
import { SYSTEM_TAGS, SYSTEM_TAG_CLASSES, zuperStatusToTone } from "@/lib/scheduler-subjobs";

export function SubJobBreakdown({
  subJobs,
  className,
}: {
  subJobs: SubJobInfo[];
  className?: string;
}) {
  if (subJobs.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {subJobs.map((sj) => (
        <SubJobRow key={sj.jobUid} subJob={sj} />
      ))}
    </div>
  );
}

function SubJobRow({ subJob }: { subJob: SubJobInfo }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold tracking-wide min-w-[2.5rem] ${
          SYSTEM_TAG_CLASSES[subJob.systemType]
        }`}
      >
        {SYSTEM_TAGS[subJob.systemType]}
      </span>
      <ZuperStatusBadge status={subJob.status} />
      <CrewLabel names={subJob.assignedTo} />
      <ScheduleLabel start={subJob.scheduledDate} end={subJob.scheduledEnd} />
    </div>
  );
}

function ZuperStatusBadge({ status }: { status: string }) {
  const tone = zuperStatusToTone(status);
  const label = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.6rem] font-semibold tracking-wide min-w-[5rem] justify-center border ${tone}`}
    >
      {label}
    </span>
  );
}

function CrewLabel({ names }: { names?: string[] }) {
  if (!names || names.length === 0) return <span className="text-muted min-w-[5rem]">—</span>;

  const abbreviated = names.slice(0, 2).map((name) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
  });

  const overflow = names.length > 2 ? ` +${names.length - 2}` : "";
  return (
    <span className="text-muted min-w-[5rem] truncate">
      {abbreviated.join(", ")}
      {overflow}
    </span>
  );
}

function ScheduleLabel({ start, end }: { start?: string; end?: string }) {
  if (!start) return <span className="text-muted text-right min-w-[4rem]">—</span>;

  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso.slice(5, 10);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const startFmt = fmt(start);
  const endFmt = end ? fmt(end) : null;

  const label =
    !endFmt || endFmt === startFmt ? startFmt : `${startFmt}–${endFmt}`;

  return <span className="text-muted text-right min-w-[4rem]">{label}</span>;
}
