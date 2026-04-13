import type { ZuperJobInfo } from "./types";

interface ZuperJobCardProps {
  jobs: ZuperJobInfo[];
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-500",
  STARTED: "text-blue-500",
  SCHEDULED: "text-orange-500",
  UNSCHEDULED: "text-zinc-500",
  CANCELLED: "text-red-500",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.split("T")[0] + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function JobEntry({ job }: { job: ZuperJobInfo }) {
  const statusColor = Object.entries(STATUS_COLORS).find(
    ([key]) => job.jobStatus.toUpperCase().includes(key)
  )?.[1] ?? "text-muted";

  const assignees = job.assignedUsers
    .map((u) => u.user_name || "Unassigned")
    .filter(Boolean)
    .join(", ");

  return (
    <div className="border-b border-t-border/50 py-2 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-foreground leading-tight">
          {job.jobCategory}
        </span>
        <span className={`text-[10px] font-medium ${statusColor}`}>
          {job.jobStatus}
        </span>
      </div>
      {job.scheduledStart && (
        <div className="mt-0.5 text-[10px] text-muted">
          {formatDate(job.scheduledStart)}
          {job.completedDate && ` → ${formatDate(job.completedDate)}`}
        </div>
      )}
      {assignees && (
        <div className="mt-0.5 text-[10px] text-muted">{assignees}</div>
      )}
    </div>
  );
}

export default function ZuperJobCard({ jobs }: ZuperJobCardProps) {
  if (jobs.length === 0) return null;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Zuper Jobs
      </h3>
      <div>
        {jobs.map((job) => (
          <JobEntry key={job.jobUid} job={job} />
        ))}
      </div>
      {jobs.length > 0 && jobs[0].jobUid && (
        <a
          href={`https://app.zuper.co/app/job-detail/${jobs[0].jobUid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-center text-[10px] text-orange-500 hover:underline"
        >
          View in Zuper ↗
        </a>
      )}
    </div>
  );
}
