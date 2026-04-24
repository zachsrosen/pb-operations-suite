"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MergedRequestRow } from "@/lib/product-requests/types";
import AdderRequestDrawer from "./AdderRequestDrawer";
import EquipmentRequestDrawer from "./EquipmentRequestDrawer";

type StatusFilter = "PENDING" | "ALL";

function statusLabel(status: string): string {
  if (status === "APPROVED" || status === "ADDED") return "Added";
  if (status === "REJECTED" || status === "DECLINED") return "Declined";
  return "Pending";
}

function statusColor(status: string): string {
  if (status === "APPROVED" || status === "ADDED")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
  if (status === "REJECTED" || status === "DECLINED")
    return "bg-red-500/15 text-red-300 border-red-500/40";
  return "bg-amber-500/15 text-amber-300 border-amber-500/40";
}

export default function ReviewClient() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [selected, setSelected] = useState<MergedRequestRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ rows: MergedRequestRow[] }>({
    queryKey: ["product-requests", "admin", statusFilter],
    queryFn: async () => {
      const url =
        statusFilter === "PENDING"
          ? "/api/admin/product-requests?status=PENDING"
          : "/api/admin/product-requests";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  const handleResolved = () => {
    setSelected(null);
    qc.invalidateQueries({ queryKey: ["product-requests"] });
    refetch();
  };

  const rows = data?.rows ?? [];
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStatusFilter("PENDING")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "PENDING"
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                : "border-t-border bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            Pending only
            {pendingCount > 0 && statusFilter === "PENDING" ? ` (${pendingCount})` : ""}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === "ALL"
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                : "border-t-border bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            All
          </button>
        </div>
        <div className="text-xs text-muted">
          Sales requests for products + adders that need to be added to OpenSolar.
        </div>
      </div>

      <div className="rounded-xl border border-t-border bg-surface p-0 overflow-hidden">
        {isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}
        {isError && (
          <div className="p-6 text-sm text-red-300">Couldn&apos;t load requests.</div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="p-10 text-center text-sm text-muted">
            No {statusFilter === "PENDING" ? "pending " : ""}requests.
          </div>
        )}

        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="text-left text-xs font-medium text-muted uppercase tracking-wide">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Requested by</th>
                <th className="px-4 py-2">Deal</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        r.type === "EQUIPMENT"
                          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                          : "border-orange-500/40 bg-orange-500/10 text-orange-300"
                      }`}
                    >
                      {r.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.title}</td>
                  <td className="px-4 py-3 text-xs text-muted">{r.requestedBy}</td>
                  <td className="px-4 py-3 text-xs text-muted">{r.dealId || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusColor(r.status)}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="rounded-md border border-t-border bg-surface-2 px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-elevated transition-colors"
                    >
                      {r.status === "PENDING" ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && selected.type === "ADDER" && (
        <AdderRequestDrawer
          requestId={selected.id}
          row={selected}
          onClose={() => setSelected(null)}
          onResolved={handleResolved}
        />
      )}
      {selected && selected.type === "EQUIPMENT" && (
        <EquipmentRequestDrawer
          requestId={selected.id}
          onClose={() => setSelected(null)}
          onResolved={handleResolved}
        />
      )}
    </div>
  );
}
