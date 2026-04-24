"use client";

import { useQuery } from "@tanstack/react-query";
import type { MergedRequestRow } from "@/lib/product-requests/types";

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "APPROVED" || status === "ADDED"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : status === "REJECTED" || status === "DECLINED"
        ? "bg-red-500/15 text-red-300 border-red-500/40"
        : "bg-amber-500/15 text-amber-300 border-amber-500/40";
  const label =
    status === "APPROVED" || status === "ADDED"
      ? "Added"
      : status === "REJECTED" || status === "DECLINED"
        ? "Declined"
        : "Pending";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${color}`}>
      {label}
    </span>
  );
}

export default function MyRequestsTable({ userEmail: _userEmail }: { userEmail: string }) {
  const { data, isLoading, isError } = useQuery<{ rows: MergedRequestRow[] }>({
    queryKey: ["product-requests", "mine"],
    queryFn: async () => {
      const res = await fetch("/api/product-requests/mine");
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="rounded-xl border border-t-border bg-surface p-6">
      <h3 className="text-base font-semibold text-foreground mb-4">My requests</h3>

      {isLoading && <div className="text-sm text-muted">Loading…</div>}
      {isError && <div className="text-sm text-red-300">Couldn&apos;t load your requests.</div>}
      {!isLoading && !isError && (!data?.rows || data.rows.length === 0) && (
        <div className="text-sm text-muted">No requests yet.</div>
      )}

      {data?.rows && data.rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-t-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="text-left text-xs font-medium text-muted uppercase tracking-wide">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Deal</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/50">
                  <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full border border-t-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {r.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.title}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.dealId || "—"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
