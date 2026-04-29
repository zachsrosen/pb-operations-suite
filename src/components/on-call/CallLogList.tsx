"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { ISSUE_TYPES } from "@/lib/on-call-call-log";

type CallLog = {
  id: string;
  poolId: string;
  callReceivedAt: string;
  customerName: string;
  issueType: string;
  issueTypeOther: string | null;
  safetyRisk: boolean;
  homeHasPower: boolean | null;
  troubleshootingAttempted: string | null;
  resolvedRemotely: boolean;
  dispatched: boolean;
  arrivalAt: string | null;
  completedAt: string | null;
  hoursWorked: string | number | null; // Prisma Decimal serializes as string
  escalatedTo: string | null;
  notes: string | null;
  reporterCrewMember: { id: string; name: string };
  pool: { id: string; name: string };
};

const ISSUE_LABEL = new Map<string, string>(ISSUE_TYPES.map((t) => [t.value, t.label]));

/**
 * Recent call logs across all active pools (or a single pool if filtered).
 * Default window = last 7 days. Visible to whole pool — handoff context.
 */
export function CallLogList({ poolId }: { poolId?: string }) {
  const from = useMemo7DayFrom();
  const q = useQuery<{ logs: CallLog[] }>({
    queryKey: queryKeys.onCall.callLogs(poolId, from, undefined),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (poolId) params.set("poolId", poolId);
      params.set("from", from);
      const res = await fetch(`/api/on-call/call-logs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load call logs");
      return res.json();
    },
  });

  if (q.isLoading) {
    return <div className="text-xs text-muted">Loading recent calls…</div>;
  }
  if (q.error) {
    return <div className="text-xs text-rose-400">Failed to load call logs.</div>;
  }
  const logs = q.data?.logs ?? [];

  if (logs.length === 0) {
    return (
      <div className="text-xs text-muted italic">
        No calls logged in the last 7 days.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="bg-surface-2 border border-t-border rounded-lg p-3 text-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <strong className="text-foreground">{log.customerName}</strong>
                <span className="text-xs text-muted">
                  {ISSUE_LABEL.get(log.issueType) ?? log.issueType}
                  {log.issueTypeOther && ` — ${log.issueTypeOther}`}
                </span>
                {log.safetyRisk && (
                  <span className="text-xs rounded bg-rose-500/20 text-rose-300 px-1.5 py-0.5">
                    SAFETY
                  </span>
                )}
                {log.dispatched && (
                  <span className="text-xs rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5">
                    Dispatched
                  </span>
                )}
                {log.resolvedRemotely && (
                  <span className="text-xs rounded bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5">
                    Remote fix
                  </span>
                )}
                {log.escalatedTo && (
                  <span className="text-xs rounded bg-purple-500/20 text-purple-300 px-1.5 py-0.5">
                    → {log.escalatedTo}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {fmtDateTime(log.callReceivedAt)} · {log.pool.name} · logged by{" "}
                {log.reporterCrewMember.name}
                {log.hoursWorked != null && (
                  <> · {Number(log.hoursWorked).toFixed(2)}h on-site</>
                )}
              </div>
              {log.notes && (
                <div className="text-xs text-muted mt-1 italic">&ldquo;{log.notes}&rdquo;</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Returns YYYY-MM-DD for 7 days ago (UTC). Stable across renders within a day. */
function useMemo7DayFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
