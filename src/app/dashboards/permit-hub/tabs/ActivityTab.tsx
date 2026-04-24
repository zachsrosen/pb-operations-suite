import type { PermitProjectDetail } from "@/lib/permit-hub";

export function ActivityTab({
  activity,
}: {
  activity: PermitProjectDetail["activity"];
}) {
  if (!activity.length) {
    return (
      <div className="text-muted text-sm">
        No permit-related activity on this deal.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {activity.map((a) => (
        <li key={a.id} className="rounded-lg border border-t-border p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="bg-surface-2 rounded-full px-2 py-0.5 text-xs font-medium uppercase">
              {a.type}
            </span>
            <span className="text-muted text-xs">
              {new Date(a.timestamp).toLocaleString()}
            </span>
          </div>
          {a.subject && <div className="text-sm font-medium">{a.subject}</div>}
          {a.body && (
            <div className="text-muted mt-1 line-clamp-3 text-xs">{a.body}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
